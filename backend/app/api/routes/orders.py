from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import AppRole, Order, OrderItem, OrderStatus, Shop, User
from app.schemas import OrderCreate, OrderOut

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("", response_model=list[OrderOut])
def list_orders(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Order]:
    query = db.query(Order).order_by(Order.created_at.desc())
    role = current_user.role.role if current_user.role else AppRole.sales
    if role != AppRole.admin:
        query = query.filter(Order.created_by == current_user.id)
    return query.all()


@router.post("", response_model=OrderOut, status_code=status.HTTP_201_CREATED)
def create_order(
    payload: OrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Order:
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
    db.refresh(order)
    return order


@router.patch("/{order_id}/status", response_model=OrderOut)
def update_order_status(
    order_id: UUID,
    status_value: OrderStatus,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin)),
) -> Order:
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order.status = status_value
    order.reviewed_by = current_user.id
    from datetime import datetime, timezone

    order.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(order)
    return order
