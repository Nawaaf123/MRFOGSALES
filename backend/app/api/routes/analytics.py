from datetime import datetime, timedelta
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
    AnalyticsOverviewCompare,
    CategorySalesRow,
    DailySalesRow,
    MoneyMixRow,
    ProductSalesRow,
    QuietShopRow,
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


def _delta_pct(current: float, prior: float) -> float | None:
    if prior == 0:
        return None if current == 0 else 100.0
    return ((current - prior) / abs(prior)) * 100


def _build_overview(
    db: Session,
    current_user: User,
    date_from: datetime | None,
    date_to: datetime | None,
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

    outstanding = max(0.0, revenue - collected)

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
        outstanding=outstanding,
        collection_rate=(collected / revenue * 100) if revenue > 0 else 0,
        paid_count=paid_count,
        unpaid_count=unpaid_count,
        partial_count=partial_count,
        unique_shops=int(shops_count),
        units_sold=int(units_sold),
        average_invoice=(revenue / invoice_count) if invoice_count else 0,
    )


def _prior_window(
    date_from: datetime | None, date_to: datetime | None
) -> tuple[datetime | None, datetime | None]:
    if not date_from or not date_to:
        return None, None
    span = date_to - date_from
    prior_to = date_from - timedelta(microseconds=1)
    prior_from = prior_to - span
    return prior_from, prior_to


@router.get("/overview", response_model=AnalyticsOverview)
def analytics_overview(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsOverview:
    return _build_overview(db, current_user, date_from, date_to)


@router.get("/overview-compare", response_model=AnalyticsOverviewCompare)
def analytics_overview_compare(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AnalyticsOverviewCompare:
    current = _build_overview(db, current_user, date_from, date_to)
    prior_from, prior_to = _prior_window(date_from, date_to)
    prior = (
        _build_overview(db, current_user, prior_from, prior_to)
        if prior_from and prior_to
        else AnalyticsOverview(
            invoice_count=0,
            revenue=0,
            discounts=0,
            collected=0,
            outstanding=0,
            collection_rate=0,
            paid_count=0,
            unpaid_count=0,
            partial_count=0,
            unique_shops=0,
            units_sold=0,
            average_invoice=0,
        )
    )
    return AnalyticsOverviewCompare(
        current=current,
        prior=prior,
        revenue_delta_pct=_delta_pct(current.revenue, prior.revenue),
        collected_delta_pct=_delta_pct(current.collected, prior.collected),
        outstanding_delta_pct=_delta_pct(current.outstanding, prior.outstanding),
        invoice_count_delta_pct=_delta_pct(float(current.invoice_count), float(prior.invoice_count)),
        units_sold_delta_pct=_delta_pct(float(current.units_sold), float(prior.units_sold)),
        collection_rate_delta_pp=current.collection_rate - prior.collection_rate,
    )


@router.get("/money-mix", response_model=MoneyMixRow)
def money_mix(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MoneyMixRow:
    invoices_q = _scoped_invoices(db, current_user, date_from, date_to)
    invoices = invoices_q.with_entities(
        Invoice.id, Invoice.total_amount, Invoice.payment_status
    ).all()
    if not invoices:
        return MoneyMixRow(
            paid_amount=0,
            partial_outstanding=0,
            unpaid_amount=0,
            outstanding=0,
            paid_count=0,
            partial_count=0,
            unpaid_count=0,
        )

    invoice_ids = [row[0] for row in invoices]
    paid_map = dict(
        db.query(Payment.invoice_id, func.coalesce(func.sum(Payment.amount), 0))
        .filter(Payment.invoice_id.in_(invoice_ids))
        .group_by(Payment.invoice_id)
        .all()
    )

    paid_amount = 0.0
    partial_outstanding = 0.0
    unpaid_amount = 0.0
    paid_count = 0
    partial_count = 0
    unpaid_count = 0

    for inv_id, total, status in invoices:
        total_f = float(total or 0)
        collected = float(paid_map.get(inv_id, 0) or 0)
        remaining = max(0.0, total_f - collected)
        if status == PaymentStatus.paid:
            paid_count += 1
            paid_amount += total_f
        elif status == PaymentStatus.partial:
            partial_count += 1
            partial_outstanding += remaining
            paid_amount += collected
        else:
            unpaid_count += 1
            unpaid_amount += remaining

    return MoneyMixRow(
        paid_amount=paid_amount,
        partial_outstanding=partial_outstanding,
        unpaid_amount=unpaid_amount,
        outstanding=partial_outstanding + unpaid_amount,
        paid_count=paid_count,
        partial_count=partial_count,
        unpaid_count=unpaid_count,
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
        .order_by(func.sum(InvoiceItem.subtotal).desc())
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


@router.get("/slow-products", response_model=list[ProductSalesRow])
def slow_products(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ProductSalesRow]:
    """Lowest-revenue products among those that sold in the period."""
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
        .order_by(func.sum(InvoiceItem.subtotal).asc(), func.sum(InvoiceItem.quantity).asc())
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


@router.get("/quiet-shops", response_model=list[QuietShopRow])
def quiet_shops(
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=15, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[QuietShopRow]:
    """Shops that ordered in the prior equal window but not in the current window."""
    prior_from, prior_to = _prior_window(date_from, date_to)
    if not prior_from or not prior_to or not date_from or not date_to:
        return []

    current_shop_ids = {
        row[0]
        for row in _scoped_invoices(db, current_user, date_from, date_to)
        .with_entities(Invoice.shop_id)
        .distinct()
        .all()
        if row[0]
    }

    prior_q = _scoped_invoices(db, current_user, prior_from, prior_to)
    prior_rows = (
        prior_q.with_entities(
            Shop.id,
            Shop.name,
            func.count(Invoice.id),
            func.coalesce(func.sum(Invoice.total_amount), 0),
            func.max(Invoice.created_at),
        )
        .group_by(Shop.id, Shop.name)
        .all()
    )

    quiet: list[QuietShopRow] = []
    for shop_id, shop_name, inv_count, revenue, last_at in prior_rows:
        if shop_id in current_shop_ids:
            continue
        quiet.append(
            QuietShopRow(
                shop_id=shop_id,
                shop_name=shop_name,
                prior_invoice_count=int(inv_count or 0),
                prior_revenue=float(revenue or 0),
                last_invoice_at=last_at.isoformat() if last_at else None,
            )
        )

    quiet.sort(key=lambda r: r.prior_revenue, reverse=True)
    return quiet[:limit]


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
    revenue_rows = (
        invoices_q.with_entities(
            day.label("day"),
            func.count(Invoice.id),
            func.coalesce(func.sum(Invoice.total_amount), 0),
        )
        .group_by(day)
        .order_by(day.asc())
        .all()
    )

    # Collected by payment_date for invoices the user can see (same shop/role scope).
    role = current_user.role.role if current_user.role else AppRole.sales
    pay_q = (
        db.query(
            Payment.payment_date.label("day"),
            func.coalesce(func.sum(Payment.amount), 0),
        )
        .join(Invoice, Payment.invoice_id == Invoice.id)
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(Shop.is_frozen.is_(False))
    )
    if role not in (AppRole.admin, AppRole.srour):
        pay_q = pay_q.filter(Invoice.created_by == current_user.id)
    if date_from:
        pay_q = pay_q.filter(Payment.payment_date >= date_from.date())
    if date_to:
        pay_q = pay_q.filter(Payment.payment_date <= date_to.date())
    collected_rows = pay_q.group_by(Payment.payment_date).all()
    collected_by_day = {
        (row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0])): float(row[1] or 0)
        for row in collected_rows
    }

    by_day: dict[str, DailySalesRow] = {}
    for row in revenue_rows:
        key = row[0].date().isoformat() if row[0] else ""
        if not key:
            continue
        by_day[key] = DailySalesRow(
            date=key,
            invoice_count=int(row[1] or 0),
            revenue=float(row[2] or 0),
            collected=collected_by_day.get(key, 0.0),
        )
    for key, amount in collected_by_day.items():
        if key not in by_day:
            by_day[key] = DailySalesRow(date=key, invoice_count=0, revenue=0.0, collected=amount)

    return [by_day[k] for k in sorted(by_day.keys())]


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
