from datetime import date, datetime, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.core.config import get_settings
from app.db.session import get_db
from app.models import (
    AppRole,
    Invoice,
    InvoiceItem,
    Payment,
    PaymentStatus,
    Product,
    Shop,
    User,
    WarehouseCode,
)
from app.schemas import (
    DistributePaymentRequest,
    DistributePaymentResult,
    InvoiceCreate,
    InvoiceEmailRequest,
    InvoiceListOut,
    InvoiceListPage,
    InvoiceOut,
    InvoiceUpdate,
    LegacyBalanceCreate,
    PaymentCreate,
    PaymentOut,
    ShopBrief,
)

router = APIRouter(tags=["invoices"])

# Postgres advisory lock key — serializes invoice number allocation across requests
_INVOICE_NUMBER_LOCK = 872_364_101
_BUSINESS_TZ = ZoneInfo("America/Chicago")
_STAFF_ROLES = (AppRole.admin, AppRole.sales, AppRole.srour)


def _user_role(user: User) -> AppRole:
    return user.role.role if user.role else AppRole.sales


def is_same_business_day(created_at: datetime) -> bool:
    dt = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
    now = datetime.now(_BUSINESS_TZ)
    return dt.astimezone(_BUSINESS_TZ).date() == now.date()


def adjust_stock(product: Product, warehouse: str, qty: int, *, restore: bool = False) -> None:
    delta = -qty if not restore else qty
    if warehouse == "B":
        product.stock_quantity_b = max(int(product.stock_quantity_b or 0) + delta, 0)
    else:
        product.stock_quantity = max(int(product.stock_quantity or 0) + delta, 0)


def resolve_create_warehouse(user: User, requested: WarehouseCode | None) -> WarehouseCode:
    """Admin may pick A/B; sales/srour always use their assigned warehouse."""
    role = _user_role(user)
    if role == AppRole.admin:
        return requested or WarehouseCode.A
    return user.assigned_warehouse or WarehouseCode.A


def next_invoice_number(db: Session) -> str:
    """Allocate the next INV-###### under a transaction-scoped advisory lock.

    Uses MAX(invoice_number) so gaps from failed concurrent inserts or deletes
    cannot cause UniqueViolation on count+1.
    """
    db.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": _INVOICE_NUMBER_LOCK})
    last = db.query(func.max(Invoice.invoice_number)).scalar()
    if not last:
        n = 1
    else:
        try:
            n = int(str(last).rsplit("-", 1)[-1]) + 1
        except ValueError:
            n = (db.query(func.count(Invoice.id)).scalar() or 0) + 1
    return f"INV-{n:06d}"


def refresh_payment_status(db: Session, invoice: Invoice) -> None:
    paid = (
        db.query(func.coalesce(func.sum(Payment.amount), 0))
        .filter(Payment.invoice_id == invoice.id)
        .scalar()
    )
    paid_amount = float(paid or 0)
    total = float(invoice.total_amount or 0)
    if paid_amount <= 0:
        invoice.payment_status = PaymentStatus.unpaid
    elif paid_amount + 0.001 >= total:
        invoice.payment_status = PaymentStatus.paid
    else:
        invoice.payment_status = PaymentStatus.partial


def serialize_invoice(invoice: Invoice, db: Session, *, amount_paid: float | None = None) -> InvoiceOut:
    if amount_paid is None:
        paid = (
            db.query(func.coalesce(func.sum(Payment.amount), 0))
            .filter(Payment.invoice_id == invoice.id)
            .scalar()
        )
        amount_paid = float(paid or 0)
    shop = ShopBrief.model_validate(invoice.shop) if invoice.shop else None
    return InvoiceOut(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        shop_id=invoice.shop_id,
        created_by=invoice.created_by,
        total_amount=float(invoice.total_amount or 0),
        discount_amount=float(invoice.discount_amount or 0),
        payment_status=invoice.payment_status,
        notes=invoice.notes,
        warehouse=invoice.warehouse,
        created_at=invoice.created_at,
        updated_at=invoice.updated_at,
        items=invoice.items or [],
        payments=invoice.payments or [],
        shop=shop,
        amount_paid=amount_paid,
    )


def serialize_invoice_list_row(invoice: Invoice, amount_paid: float) -> InvoiceListOut:
    shop = ShopBrief.model_validate(invoice.shop) if invoice.shop else None
    return InvoiceListOut(
        id=invoice.id,
        invoice_number=invoice.invoice_number,
        shop_id=invoice.shop_id,
        created_by=invoice.created_by,
        total_amount=float(invoice.total_amount or 0),
        discount_amount=float(invoice.discount_amount or 0),
        payment_status=invoice.payment_status,
        notes=invoice.notes,
        warehouse=invoice.warehouse,
        created_at=invoice.created_at,
        updated_at=invoice.updated_at,
        shop=shop,
        amount_paid=amount_paid,
    )


def paid_amounts_for_invoices(db: Session, invoice_ids: list[UUID]) -> dict[UUID, float]:
    if not invoice_ids:
        return {}
    rows = (
        db.query(Payment.invoice_id, func.coalesce(func.sum(Payment.amount), 0))
        .filter(Payment.invoice_id.in_(invoice_ids))
        .group_by(Payment.invoice_id)
        .all()
    )
    return {invoice_id: float(total or 0) for invoice_id, total in rows}


def load_invoice(db: Session, invoice_id: UUID) -> Invoice | None:
    return (
        db.query(Invoice)
        .options(
            joinedload(Invoice.items),
            joinedload(Invoice.payments),
            joinedload(Invoice.shop),
        )
        .filter(Invoice.id == invoice_id)
        .first()
    )


@router.get("/invoices", response_model=InvoiceListPage)
def list_invoices(
    search: str | None = Query(default=None),
    payment_status: PaymentStatus | None = Query(default=None),
    shop_id: UUID | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceListPage:
    query = (
        db.query(Invoice)
        .options(joinedload(Invoice.shop))
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(Shop.is_frozen.is_(False))
    )
    role = _user_role(current_user)
    if role not in _STAFF_ROLES:
        query = query.filter(Invoice.created_by == current_user.id)

    if payment_status:
        query = query.filter(Invoice.payment_status == payment_status)
    if shop_id:
        query = query.filter(Invoice.shop_id == shop_id)
    if date_from:
        query = query.filter(Invoice.created_at >= date_from)
    if date_to:
        query = query.filter(Invoice.created_at <= date_to)
    if search:
        like = f"%{search}%"
        query = query.filter(
            or_(
                Invoice.invoice_number.ilike(like),
                Shop.name.ilike(like),
                Shop.city.ilike(like),
                Shop.state.ilike(like),
                Shop.owner_name.ilike(like),
            )
        )

    total = query.order_by(None).count()
    invoices = (
        query.order_by(Invoice.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    paid_map = paid_amounts_for_invoices(db, [inv.id for inv in invoices])
    return InvoiceListPage(
        items=[serialize_invoice_list_row(inv, paid_map.get(inv.id, 0.0)) for inv in invoices],
        total=total,
        page=page,
        page_size=page_size,
    )


def invoice_out_by_client_request_id(db: Session, client_request_id: str) -> InvoiceOut | None:
    existing = db.query(Invoice).filter(Invoice.client_request_id == client_request_id).first()
    if not existing:
        return None
    loaded = load_invoice(db, existing.id)
    assert loaded is not None
    return serialize_invoice(loaded, db)


@router.post("/invoices", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
def create_invoice(
    payload: InvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> InvoiceOut:
    shop = db.query(Shop).filter(Shop.id == payload.shop_id, Shop.is_frozen.is_(False)).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    if not payload.items:
        raise HTTPException(status_code=400, detail="Invoice requires at least one item")

    request_id = (payload.client_request_id or "").strip() or None
    if request_id:
        replay = invoice_out_by_client_request_id(db, request_id)
        if replay is not None:
            return replay

    items_total = sum(item.subtotal for item in payload.items)
    total_amount = max(items_total - payload.discount_amount, 0)

    # Retry a few times if a rare unique-number race still slips through
    last_error: Exception | None = None
    for _attempt in range(5):
        try:
            invoice = Invoice(
                invoice_number=next_invoice_number(db),
                client_request_id=request_id,
                shop_id=payload.shop_id,
                created_by=current_user.id,
                total_amount=total_amount,
                discount_amount=payload.discount_amount,
                notes=payload.notes,
                warehouse=resolve_create_warehouse(current_user, payload.warehouse),
                payment_status=PaymentStatus.unpaid,
            )
            db.add(invoice)
            db.flush()

            product_ids = list({item.product_id for item in payload.items})
            products = (
                db.query(Product)
                .filter(Product.id.in_(product_ids))
                .with_for_update()
                .all()
            )
            product_map = {p.id: p for p in products}
            missing = [pid for pid in product_ids if pid not in product_map]
            if missing:
                raise HTTPException(status_code=404, detail=f"Product not found: {missing[0]}")

            warehouse = (invoice.warehouse.value if invoice.warehouse else "A")
            for item in payload.items:
                product = product_map[item.product_id]
                db.add(
                    InvoiceItem(
                        invoice_id=invoice.id,
                        product_id=item.product_id,
                        product_name=item.product_name,
                        quantity=item.quantity,
                        unit_price=item.unit_price,
                        subtotal=item.subtotal,
                    )
                )
                adjust_stock(product, warehouse, item.quantity, restore=False)

            for payment_in in payload.payments:
                db.add(
                    Payment(
                        invoice_id=invoice.id,
                        amount=payment_in.amount,
                        payment_method=payment_in.payment_method,
                        payment_date=payment_in.payment_date or date.today(),
                        check_number=payment_in.check_number,
                        notes=payment_in.notes,
                        created_by=current_user.id,
                    )
                )

            db.flush()
            refresh_payment_status(db, invoice)
            db.commit()
            loaded = load_invoice(db, invoice.id)
            assert loaded is not None
            return serialize_invoice(loaded, db)
        except IntegrityError as exc:
            db.rollback()
            last_error = exc
            err = str(exc).lower()
            if request_id and (
                "client_request_id" in err or "ix_invoices_client_request_id" in err
            ):
                replay = invoice_out_by_client_request_id(db, request_id)
                if replay is not None:
                    return replay
            if "invoice_number" not in err and "ix_invoices_invoice_number" not in err:
                raise HTTPException(status_code=409, detail="Could not create invoice due to a conflict") from exc
            continue
        except HTTPException:
            db.rollback()
            raise

    raise HTTPException(
        status_code=409,
        detail="Could not allocate a unique invoice number under load",
    ) from last_error


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceOut:
    invoice = load_invoice(db, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    role = _user_role(current_user)
    if role not in _STAFF_ROLES and invoice.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return serialize_invoice(invoice, db)


@router.patch("/invoices/{invoice_id}", response_model=InvoiceOut)
def update_invoice(
    invoice_id: UUID,
    payload: InvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> InvoiceOut:
    invoice = load_invoice(db, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    role = _user_role(current_user)
    if role != AppRole.admin and not is_same_business_day(invoice.created_at):
        raise HTTPException(
            status_code=403,
            detail="Only invoices created today can be edited",
        )
    if not payload.items:
        raise HTTPException(status_code=400, detail="Invoice requires at least one item")

    warehouse = invoice.warehouse.value if invoice.warehouse else "A"
    old_product_ids = [item.product_id for item in (invoice.items or []) if item.product_id]
    new_product_ids = [item.product_id for item in payload.items]
    all_ids = list({*old_product_ids, *new_product_ids})
    products = (
        db.query(Product).filter(Product.id.in_(all_ids)).with_for_update().all() if all_ids else []
    )
    product_map = {p.id: p for p in products}
    for pid in new_product_ids:
        if pid not in product_map:
            raise HTTPException(status_code=404, detail=f"Product not found: {pid}")

    # Restore stock from previous lines, then apply new lines.
    for old in list(invoice.items or []):
        if old.product_id and old.product_id in product_map:
            adjust_stock(product_map[old.product_id], warehouse, int(old.quantity), restore=True)
        db.delete(old)
    db.flush()

    items_total = sum(item.subtotal for item in payload.items)
    invoice.discount_amount = payload.discount_amount
    invoice.notes = payload.notes
    invoice.total_amount = max(items_total - payload.discount_amount, 0)

    for item in payload.items:
        product = product_map[item.product_id]
        db.add(
            InvoiceItem(
                invoice_id=invoice.id,
                product_id=item.product_id,
                product_name=item.product_name,
                quantity=item.quantity,
                unit_price=item.unit_price,
                subtotal=item.subtotal,
            )
        )
        adjust_stock(product, warehouse, item.quantity, restore=False)

    db.flush()
    paid = float(
        db.query(func.coalesce(func.sum(Payment.amount), 0))
        .filter(Payment.invoice_id == invoice.id)
        .scalar()
        or 0
    )
    if paid > float(invoice.total_amount) + 0.01:
        raise HTTPException(
            status_code=400,
            detail="New total is less than payments already recorded on this invoice",
        )
    refresh_payment_status(db, invoice)
    db.commit()
    loaded = load_invoice(db, invoice.id)
    assert loaded is not None
    return serialize_invoice(loaded, db)


@router.delete("/invoices/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_invoice(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin, AppRole.srour)),
) -> None:
    invoice = load_invoice(db, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    db.delete(invoice)
    db.commit()


@router.post("/invoices/legacy-balance", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
def create_legacy_balance(
    payload: LegacyBalanceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> InvoiceOut:
    shop = db.query(Shop).filter(Shop.id == payload.shop_id, Shop.is_frozen.is_(False)).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    note = payload.notes.strip() if payload.notes else "Opening balance from previous records"
    if not note.upper().startswith("[LEGACY BALANCE]"):
        note = f"[LEGACY BALANCE] {note}"

    invoice = Invoice(
        invoice_number=next_invoice_number(db),
        shop_id=payload.shop_id,
        created_by=current_user.id,
        total_amount=payload.amount,
        discount_amount=0,
        notes=note,
        payment_status=PaymentStatus.unpaid,
    )
    db.add(invoice)
    db.commit()
    loaded = load_invoice(db, invoice.id)
    assert loaded is not None
    return serialize_invoice(loaded, db)


@router.post("/invoices/{invoice_id}/email")
def email_invoice(
    invoice_id: UUID,
    payload: InvoiceEmailRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> dict:
    import httpx

    settings = get_settings()
    if not settings.resend_api_key:
        raise HTTPException(
            status_code=503,
            detail="Email is not configured. Set RESEND_API_KEY in the API environment.",
        )

    invoice = load_invoice(db, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    role = _user_role(current_user)
    if role not in _STAFF_ROLES and invoice.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    to_email = payload.to or (invoice.shop.email if invoice.shop else None)
    if not to_email:
        raise HTTPException(status_code=400, detail="No recipient email provided or on shop")

    shop_name = invoice.shop.name if invoice.shop else "Customer"
    html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Invoice {invoice.invoice_number}</h2>
      <p>Dear {shop_name},</p>
      <p>Thank you for your business. Please find your invoice attached.</p>
      <p><strong>Invoice Number:</strong> {invoice.invoice_number}<br/>
      <strong>Total Amount:</strong> ${float(invoice.total_amount):.2f}</p>
      <p>Best regards,<br/>Sales Team</p>
    </div>
    """

    response = httpx.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "from": settings.email_from,
            "to": [str(to_email)],
            "subject": f"Invoice {invoice.invoice_number}",
            "html": html,
            "attachments": [
                {
                    "filename": f"Invoice-{invoice.invoice_number}.pdf",
                    "content": payload.pdf_base64,
                }
            ],
        },
        timeout=30.0,
    )
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Email provider error: {response.text}")
    return {"ok": True, "provider": response.json()}


@router.post("/payments/distribute", response_model=DistributePaymentResult)
def distribute_payment(
    payload: DistributePaymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> DistributePaymentResult:
    shop = db.query(Shop).filter(Shop.id == payload.shop_id, Shop.is_frozen.is_(False)).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    invoices = (
        db.query(Invoice)
        .options(joinedload(Invoice.payments))
        .filter(
            Invoice.shop_id == payload.shop_id,
            Invoice.payment_status.in_([PaymentStatus.unpaid, PaymentStatus.partial]),
        )
        .order_by(
            case((Invoice.payment_status == PaymentStatus.unpaid, 0), else_=1),
            Invoice.created_at.asc(),
        )
        .all()
    )
    if not invoices:
        raise HTTPException(status_code=400, detail="No unpaid invoices for this shop")

    total_pending = 0.0
    pending_by_invoice: list[tuple[Invoice, float]] = []
    for invoice in invoices:
        paid = sum(float(p.amount) for p in (invoice.payments or []))
        pending = max(float(invoice.total_amount or 0) - paid, 0)
        if pending > 0:
            pending_by_invoice.append((invoice, pending))
            total_pending += pending

    if payload.amount > total_pending + 0.01:
        raise HTTPException(status_code=400, detail="Payment exceeds total pending balance")

    remaining = payload.amount
    created = 0
    pay_date = payload.payment_date or date.today()
    for invoice, pending in pending_by_invoice:
        if remaining <= 0:
            break
        apply_amount = min(remaining, pending)
        db.add(
            Payment(
                invoice_id=invoice.id,
                amount=apply_amount,
                payment_method=payload.payment_method,
                payment_date=pay_date,
                check_number=payload.check_number if payload.payment_method.value == "check" else None,
                notes=payload.notes,
                created_by=current_user.id,
            )
        )
        remaining -= apply_amount
        created += 1

    db.flush()
    for invoice, _ in pending_by_invoice:
        refresh_payment_status(db, invoice)
    db.commit()

    return DistributePaymentResult(
        payments_created=created,
        amount_applied=payload.amount - remaining,
    )


@router.post("/payments", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
def create_payment(
    payload: PaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> Payment:
    invoice = db.query(Invoice).filter(Invoice.id == payload.invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    remaining = float(invoice.total_amount or 0) - float(
        db.query(func.coalesce(func.sum(Payment.amount), 0))
        .filter(Payment.invoice_id == invoice.id)
        .scalar()
        or 0
    )
    if payload.amount > remaining + 0.01:
        raise HTTPException(status_code=400, detail="Payment/credit cannot exceed remaining balance")

    payment = Payment(
        invoice_id=payload.invoice_id,
        amount=payload.amount,
        payment_method=payload.payment_method,
        payment_date=payload.payment_date,
        check_number=payload.check_number,
        notes=payload.notes,
        created_by=current_user.id,
    )
    db.add(payment)
    db.flush()
    refresh_payment_status(db, invoice)
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/payments", response_model=list[PaymentOut])
def list_payments(
    invoice_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[Payment]:
    query = db.query(Payment).order_by(Payment.created_at.desc())
    if invoice_id:
        query = query.filter(Payment.invoice_id == invoice_id)
    return query.all()
