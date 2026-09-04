from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import AppRole, Invoice, Order, OrderStatus, PaymentStatus, Product, Shop, User
from app.schemas import DashboardStats

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
def dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DashboardStats:
    role = current_user.role.role if current_user.role else AppRole.sales

    products_count = db.query(func.count(Product.id)).filter(Product.is_active.is_(True)).scalar() or 0
    shops_count = db.query(func.count(Shop.id)).filter(Shop.is_frozen.is_(False)).scalar() or 0

    invoices_query = (
        db.query(Invoice)
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(Shop.is_frozen.is_(False))
    )
    if role != AppRole.admin:
        invoices_query = invoices_query.filter(Invoice.created_by == current_user.id)

    invoices_count = invoices_query.with_entities(func.count(Invoice.id)).scalar() or 0
    unpaid_invoices = (
        invoices_query.filter(Invoice.payment_status != PaymentStatus.paid)
        .with_entities(func.count(Invoice.id))
        .scalar()
        or 0
    )

    totals = invoices_query.with_entities(
        func.coalesce(func.sum(Invoice.total_amount), 0),
        func.coalesce(
            func.sum(
                case((Invoice.payment_status == PaymentStatus.paid, Invoice.total_amount), else_=0)
            ),
            0,
        ),
    ).one()

    total_revenue = float(totals[0] or 0)
    paid_amount = float(totals[1] or 0)
    collection_rate = (paid_amount / total_revenue * 100) if total_revenue > 0 else 0.0

    orders_query = db.query(Order).filter(Order.status == OrderStatus.pending)
    if role != AppRole.admin:
        orders_query = orders_query.filter(Order.created_by == current_user.id)
    pending_orders = orders_query.with_entities(func.count(Order.id)).scalar() or 0

    return DashboardStats(
        products_count=products_count,
        shops_count=shops_count,
        invoices_count=invoices_count,
        total_revenue=total_revenue,
        collection_rate=collection_rate,
        pending_orders=pending_orders,
        unpaid_invoices=unpaid_invoices,
    )
