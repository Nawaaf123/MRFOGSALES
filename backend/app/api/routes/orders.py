from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.api.routes.invoices import load_invoice, next_invoice_number, refresh_payment_status, serialize_invoice
from app.db.session import get_db
from app.models import (
    AppRole,
    Invoice,
    InvoiceItem,
    Order,
    OrderItem,
    OrderStatus,
    PaymentStatus,
    Product,
    Shop,
    User,
)
from app.schemas import (
    OrderApproveResponse,
    OrderCreate,
    OrderOut,
    OrderStatusUpdate,
    ShopBrief,
)

router = APIRouter(prefix="/orders", tags=["orders"])


def serialize_order(order: Order) -> OrderOut:
    shop = ShopBrief.model_validate(order.shop) if getattr(order, "shop", None) else None
    return OrderOut(
        id=order.id,
        shop_id=order.shop_id,
        created_by=order.created_by,
        status=order.status,
        total_amount=float(order.total_amount or 0),
        notes=order.notes,
        admin_notes=order.admin_notes,
        invoice_id=order.invoice_id,
        warehouse=order.warehouse,
        created_at=order.created_at,
        updated_at=order.updated_at,
        items=order.items or [],
        shop=shop,
    )


def load_order(db: Session, order_id: UUID) -> Order | None:
    return (
        db.query(Order)
        .options(joinedload(Order.items), joinedload(Order.shop))
        .filter(Order.id == order_id)
        .first()
    )


@router.get("", response_model=list[OrderOut])
def list_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[OrderOut]:
    query = (
        db.query(Order)
        .options(joinedload(Order.items), joinedload(Order.shop))
        .order_by(Order.created_at.desc())
    )
    role = current_user.role.role if current_user.role else AppRole.sales
    if role != AppRole.admin:
        query = query.filter(Order.created_by == current_user.id)
    return [serialize_order(order) for order in query.all()]


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OrderOut:
    shop = db.query(Shop).filter(Shop.id == payload.shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    if not payload.items:
        raise HTTPException(status_code=400, detail="Order requires items")

    total_amount = sum(item.subtotal for item in payload.items)
    order = Order(
        shop_id=payload.shop_id,
        created_by=current_user.id,
        status=OrderStatus.pending,
        total_amount=total_amount,
        notes=payload.notes,
        warehouse=payload.warehouse,
    )
    db.add(order)
    db.flush()
    for item in payload.items:
        db.add(
            OrderItem(
                order_id=order.id,
                product_id=item.product_id,
                product_name=item.product_name,
                quantity=item.quantity,
                unit_price=item.unit_price,
                subtotal=item.subtotal,
            )
        )
    db.commit()
    loaded = load_order(db, order.id)
    assert loaded is not None
    return serialize_order(loaded)


@router.patch("/{order_id}/status", response_model=OrderOut)
def update_order_status(
    order_id: UUID,
    payload: OrderStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin)),
) -> OrderOut:
    order = load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order.status = payload.status
    order.admin_notes = payload.admin_notes
    if payload.warehouse:
        order.warehouse = payload.warehouse
    order.reviewed_by = current_user.id
    order.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    loaded = load_order(db, order_id)
    assert loaded is not None
    return serialize_order(loaded)


@router.post("/{order_id}/approve", response_model=OrderApproveResponse)
def approve_order(
    order_id: UUID,
    payload: OrderStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin)),
) -> OrderApproveResponse:
    order = load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != OrderStatus.pending:
        raise HTTPException(status_code=400, detail="Only pending orders can be approved")
    if not order.items:
        raise HTTPException(status_code=400, detail="Order has no items")

    warehouse = payload.warehouse or order.warehouse
    invoice = Invoice(
        invoice_number=next_invoice_number(db),
        shop_id=order.shop_id,
        created_by=order.created_by,
        total_amount=order.total_amount,
        discount_amount=0,
        notes=order.notes,
        warehouse=warehouse,
        payment_status=PaymentStatus.unpaid,
    )
    db.add(invoice)
    db.flush()

    for item in order.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
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
        if product:
            wh = warehouse.value if warehouse else "A"
            if wh == "B":
                product.stock_quantity_b = max(int(product.stock_quantity_b) - item.quantity, 0)
            else:
                product.stock_quantity = max(int(product.stock_quantity) - item.quantity, 0)

    order.status = OrderStatus.converted
    order.invoice_id = invoice.id
    order.warehouse = warehouse
    order.admin_notes = payload.admin_notes
    order.reviewed_by = current_user.id
    order.reviewed_at = datetime.now(timezone.utc)
    refresh_payment_status(db, invoice)
    db.commit()

    loaded_order = load_order(db, order_id)
    loaded_invoice = load_invoice(db, invoice.id)
    assert loaded_order is not None and loaded_invoice is not None
    return OrderApproveResponse(
        order=serialize_order(loaded_order),
        invoice=serialize_invoice(loaded_invoice, db),
    )
