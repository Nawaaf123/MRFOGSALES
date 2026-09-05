from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import AppRole, Invoice, Order, OrderStatus, PaymentStatus, Product, Shop, User
from app.schemas import DashboardStats, InvoiceListOut, InvoiceOut, LowStockProduct
from app.api.routes.invoices import serialize_invoice

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


@router.get("/low-stock", response_model=list[LowStockProduct])
def low_stock(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[LowStockProduct]:
    products = db.query(Product).filter(Product.is_active.is_(True)).all()
    rows: list[LowStockProduct] = []
    for product in products:
        total = int(product.stock_quantity or 0) + int(product.stock_quantity_b or 0)
        if total <= int(product.low_stock_threshold or 0):
            rows.append(
                LowStockProduct(
                    id=product.id,
                    name=product.name,
                    category=product.category,
                    stock_quantity=int(product.stock_quantity or 0),
                    stock_quantity_b=int(product.stock_quantity_b or 0),
                    low_stock_threshold=int(product.low_stock_threshold or 0),
                    total_stock=total,
                )
            )
    rows.sort(key=lambda item: item.total_stock)
    return rows[:8]


@router.get("/recent-invoices", response_model=list[InvoiceOut])
def recent_invoices(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[InvoiceOut]:
    from sqlalchemy.orm import joinedload

    role = current_user.role.role if current_user.role else AppRole.sales
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
    if role != AppRole.admin:
        query = query.filter(Invoice.created_by == current_user.id)
    query = query.order_by(Invoice.created_at.desc()).limit(5)
    return [serialize_invoice(inv, db) for inv in query.all()]


@router.get("/pending-payments", response_model=list[InvoiceListOut])
def pending_payments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[InvoiceListOut]:
    from sqlalchemy.orm import joinedload
    from app.api.routes.invoices import paid_amounts_for_invoices, serialize_invoice_list_row

    role = current_user.role.role if current_user.role else AppRole.sales
    query = (
        db.query(Invoice)
        .options(joinedload(Invoice.shop))
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(
            Shop.is_frozen.is_(False),
            Invoice.payment_status.in_([PaymentStatus.unpaid, PaymentStatus.partial]),
        )
    )
    if role != AppRole.admin:
        query = query.filter(Invoice.created_by == current_user.id)
    invoices = query.order_by(Invoice.created_at.desc()).limit(8).all()
    paid_map = paid_amounts_for_invoices(db, [inv.id for inv in invoices])
    return [serialize_invoice_list_row(inv, paid_map.get(inv.id, 0.0)) for inv in invoices]
