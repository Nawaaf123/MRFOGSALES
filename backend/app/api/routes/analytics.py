from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func
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
    UserRole,
)
from app.schemas import (
    AnalyticsOverview,
    CategorySalesRow,
    DailySalesRow,
    ProductSalesRow,
    SalesPersonPerformance,
    ShopSalesRow,
)

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _scoped_invoices(db: Session, current_user: User, date_from: datetime | None, date_to: datetime | None):
    query = (
        db.query(Invoice)
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(Shop.is_frozen.is_(False))
    )
    role = current_user.role.role if current_user.role else AppRole.sales
    if role not in (AppRole.admin, AppRole.srour):
        query = query.filter(Invoice.created_by == current_user.id)
    if date_from:
        query = query.filter(Invoice.created_at >= date_from)
    if date_to:
        query = query.filter(Invoice.created_at <= date_to)
    return query


@router.get("/overview", response_model=AnalyticsOverview)
def analytics_overview(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsOverview:
    invoices_q = _scoped_invoices(db, current_user, date_from, date_to)
    invoice_ids = [row.id for row in invoices_q.with_entities(Invoice.id).all()]

    totals = invoices_q.with_entities(
        func.count(Invoice.id),
        func.coalesce(func.sum(Invoice.total_amount), 0),
        func.coalesce(func.sum(Invoice.discount_amount), 0),
        func.coalesce(
            func.sum(case((Invoice.payment_status == PaymentStatus.paid, 1), else_=0)),
            0,
        ),
        func.coalesce(
            func.sum(case((Invoice.payment_status == PaymentStatus.unpaid, 1), else_=0)),
            0,
        ),
        func.coalesce(
            func.sum(case((Invoice.payment_status == PaymentStatus.partial, 1), else_=0)),
            0,
        ),
    ).one()

    invoice_count = int(totals[0] or 0)
    revenue = float(totals[1] or 0)
    discounts = float(totals[2] or 0)
    paid_count = int(totals[3] or 0)
    unpaid_count = int(totals[4] or 0)
    partial_count = int(totals[5] or 0)

    if invoice_ids:
        collected = float(
            db.query(func.coalesce(func.sum(Payment.amount), 0))
            .filter(Payment.invoice_id.in_(invoice_ids))
            .scalar()
            or 0
        )
    else:
        collected = 0.0

    shops_count = (
        invoices_q.with_entities(func.count(func.distinct(Invoice.shop_id))).scalar() or 0
    )

    units_sold = 0
    if invoice_ids:
        units_sold = (
            db.query(func.coalesce(func.sum(InvoiceItem.quantity), 0))
            .filter(InvoiceItem.invoice_id.in_(invoice_ids))
            .scalar()
            or 0
        )

    return AnalyticsOverview(
        invoice_count=invoice_count,
        revenue=revenue,
        discounts=discounts,
        collected=collected,
        collection_rate=(collected / revenue * 100) if revenue > 0 else 0,
        paid_count=paid_count,
        unpaid_count=unpaid_count,
        partial_count=partial_count,
        unique_shops=int(shops_count),
        units_sold=int(units_sold),
        average_invoice=(revenue / invoice_count) if invoice_count else 0,
    )


@router.get("/top-products", response_model=list[ProductSalesRow])
def top_products(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProductSalesRow]:
    invoices_q = _scoped_invoices(db, current_user, date_from, date_to)
    invoice_ids = [row.id for row in invoices_q.with_entities(Invoice.id).all()]
    if not invoice_ids:
        return []

    rows = (
        db.query(
            InvoiceItem.product_name,
            func.sum(InvoiceItem.quantity).label("qty"),
            func.sum(InvoiceItem.subtotal).label("revenue"),
        )
        .filter(InvoiceItem.invoice_id.in_(invoice_ids))
        .group_by(InvoiceItem.product_name)
        .order_by(func.sum(InvoiceItem.quantity).desc())
        .limit(limit)
        .all()
    )
    return [
        ProductSalesRow(
            product_name=row[0],
            total_quantity=int(row[1] or 0),
            total_revenue=float(row[2] or 0),
        )
        for row in rows
    ]


@router.get("/top-shops", response_model=list[ShopSalesRow])
def top_shops(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ShopSalesRow]:
    invoices_q = _scoped_invoices(db, current_user, date_from, date_to)
    rows = (
        invoices_q.with_entities(
            Shop.name,
            func.count(Invoice.id),
            func.coalesce(func.sum(Invoice.total_amount), 0),
        )
        .group_by(Shop.name)
        .order_by(func.coalesce(func.sum(Invoice.total_amount), 0).desc())
        .limit(limit)
        .all()
    )
    return [
        ShopSalesRow(
            shop_name=row[0],
            invoice_count=int(row[1] or 0),
            total_revenue=float(row[2] or 0),
        )
        for row in rows
    ]


@router.get("/by-category", response_model=list[CategorySalesRow])
def sales_by_category(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[CategorySalesRow]:
    invoices_q = _scoped_invoices(db, current_user, date_from, date_to)
    invoice_ids = [row.id for row in invoices_q.with_entities(Invoice.id).all()]
    if not invoice_ids:
        return []

    rows = (
        db.query(
            Product.category,
            func.coalesce(func.sum(InvoiceItem.quantity), 0),
            func.coalesce(func.sum(InvoiceItem.subtotal), 0),
        )
        .join(InvoiceItem, InvoiceItem.product_id == Product.id)
        .filter(InvoiceItem.invoice_id.in_(invoice_ids))
        .group_by(Product.category)
        .order_by(func.coalesce(func.sum(InvoiceItem.subtotal), 0).desc())
        .all()
    )
    return [
        CategorySalesRow(
            category=row[0] or "Uncategorized",
            total_quantity=int(row[1] or 0),
            total_revenue=float(row[2] or 0),
        )
        for row in rows
    ]


@router.get("/daily", response_model=list[DailySalesRow])
def daily_sales(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DailySalesRow]:
    day = func.date_trunc("day", Invoice.created_at)
    invoices_q = _scoped_invoices(db, current_user, date_from, date_to)
    rows = (
        invoices_q.with_entities(
            day.label("day"),
            func.count(Invoice.id),
            func.coalesce(func.sum(Invoice.total_amount), 0),
        )
        .group_by(day)
        .order_by(day.asc())
        .all()
    )
    return [
        DailySalesRow(
            date=row[0].date().isoformat() if row[0] else "",
            invoice_count=int(row[1] or 0),
            revenue=float(row[2] or 0),
        )
        for row in rows
    ]


@router.get("/sales-performance", response_model=list[SalesPersonPerformance])
def sales_performance(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    commission_rate: float = Query(default=10, ge=0, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> list[SalesPersonPerformance]:
    sales_users = (
        db.query(User)
        .options(joinedload(User.role))
        .join(UserRole, UserRole.user_id == User.id)
        .filter(UserRole.role == AppRole.sales, User.is_active.is_(True))
        .all()
    )

    results: list[SalesPersonPerformance] = []
    for sales_user in sales_users:
        q = (
            db.query(Invoice)
            .join(Shop, Invoice.shop_id == Shop.id)
            .filter(
                Shop.is_frozen.is_(False),
                Invoice.created_by == sales_user.id,
            )
        )
        if date_from:
            q = q.filter(Invoice.created_at >= date_from)
        if date_to:
            q = q.filter(Invoice.created_at <= date_to)

        stats = q.with_entities(
            func.count(Invoice.id),
            func.coalesce(func.sum(Invoice.total_amount), 0),
            func.count(func.distinct(Invoice.shop_id)),
        ).one()

        invoice_count = int(stats[0] or 0)
        revenue = float(stats[1] or 0)
        shops = int(stats[2] or 0)
        results.append(
            SalesPersonPerformance(
                user_id=sales_user.id,
                full_name=sales_user.full_name,
                email=sales_user.email,
                invoice_count=invoice_count,
                total_revenue=revenue,
                unique_shops=shops,
                average_invoice=(revenue / invoice_count) if invoice_count else 0,
                commission=revenue * (commission_rate / 100),
            )
        )

    results.sort(key=lambda row: row.total_revenue, reverse=True)
    return results
