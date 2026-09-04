from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import AppRole, Invoice, InvoiceItem, Payment, PaymentStatus, Product, Shop, User
from app.schemas import InvoiceCreate, InvoiceOut, PaymentCreate, PaymentOut

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


@router.get("/invoices", response_model=list[InvoiceOut])
def list_invoices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Invoice]:
    query = (
        db.query(Invoice)
        .options(joinedload(Invoice.items), joinedload(Invoice.shop))
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(Shop.is_frozen.is_(False))
        .order_by(Invoice.created_at.desc())
    )
    role = current_user.role.role if current_user.role else AppRole.sales
    if role != AppRole.admin:
        query = query.filter(Invoice.created_by == current_user.id)
    return query.all()


@router.post("/invoices", response_model=InvoiceOut, status_code=status.HTTP_201_CREATED)
def create_invoice(
    payload: InvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales)),
) -> Invoice:
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
            product.stock_quantity_b = max(product.stock_quantity_b - item.quantity, 0)
        else:
            product.stock_quantity = max(product.stock_quantity - item.quantity, 0)

    db.commit()
    return (
        db.query(Invoice)
        .options(joinedload(Invoice.items))
        .filter(Invoice.id == invoice.id)
        .one()
    )


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice(
    invoice_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Invoice:
    invoice = (
        db.query(Invoice)
        .options(joinedload(Invoice.items))
        .filter(Invoice.id == invoice_id)
        .first()
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    role = current_user.role.role if current_user.role else AppRole.sales
    if role != AppRole.admin and invoice.created_by != current_user.id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return invoice


@router.post("/payments", response_model=PaymentOut, status_code=status.HTTP_201_CREATED)
def create_payment(
    payload: PaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales)),
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
