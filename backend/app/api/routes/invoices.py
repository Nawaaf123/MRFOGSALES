from datetime import date, datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
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
)
from app.schemas import InvoiceCreate, InvoiceOut, PaymentCreate, PaymentOut, ShopBrief

router = APIRouter(tags=["invoices"])


def next_invoice_number(db: Session) -> str:
    count = db.query(func.count(Invoice.id)).scalar() or 0
    return f"INV-{count + 1:06d}"


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


def serialize_invoice(invoice: Invoice, db: Session) -> InvoiceOut:
    paid = (
        db.query(func.coalesce(func.sum(Payment.amount), 0))
        .filter(Payment.invoice_id == invoice.id)
        .scalar()
    )
    shop = None
    if invoice.shop:
        shop = ShopBrief.model_validate(invoice.shop)
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
        amount_paid=float(paid or 0),
    )


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


@router.get("/invoices", response_model=list[InvoiceOut])
def list_invoices(
    search: str | None = Query(default=None),
    payment_status: PaymentStatus | None = Query(default=None),
    shop_id: UUID | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[InvoiceOut]:
    query = (
        db.query(Invoice)
        .options(
            joinedload(Invoice.items),
            joinedload(Invoice.payments),
            joinedload(Invoice.shop),
        )
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(Shop.is_frozen.is_(False))
    )
    role = current_user.role.role if current_user.role else AppRole.sales
    if role not in (AppRole.admin, AppRole.srour):
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

    invoices = query.order_by(Invoice.created_at.desc()).all()
    return [serialize_invoice(inv, db) for inv in invoices]


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

    items_total = sum(item.subtotal for item in payload.items)
    total_amount = max(items_total - payload.discount_amount, 0)

    invoice = Invoice(
        invoice_number=next_invoice_number(db),
        shop_id=payload.shop_id,
        created_by=current_user.id,
        total_amount=total_amount,
        discount_amount=payload.discount_amount,
        notes=payload.notes,
        warehouse=payload.warehouse,
        payment_status=PaymentStatus.unpaid,
    )
    db.add(invoice)
    db.flush()

    for item in payload.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product not found: {item.product_id}")
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
        warehouse = payload.warehouse.value if payload.warehouse else "A"
        if warehouse == "B":
            product.stock_quantity_b = max(int(product.stock_quantity_b) - item.quantity, 0)
        else:
            product.stock_quantity = max(int(product.stock_quantity) - item.quantity, 0)

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


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> InvoiceOut:
    invoice = load_invoice(db, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    role = current_user.role.role if current_user.role else AppRole.sales
    if role not in (AppRole.admin, AppRole.srour) and invoice.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return serialize_invoice(invoice, db)


@router.post("/payments", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
def create_payment(
    payload: PaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> Payment:
    invoice = db.query(Invoice).filter(Invoice.id == payload.invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

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
