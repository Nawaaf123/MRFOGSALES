"""Grounded analytics helpers for the Ask AI chatbot tools."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

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

_BUSINESS_TZ = ZoneInfo("America/Chicago")
_STAFF_ROLES = (AppRole.admin, AppRole.sales, AppRole.srour)


def role_of(user: User) -> AppRole:
    return user.role.role if user.role else AppRole.sales


def scope_invoices(query, user: User):
    if role_of(user) not in _STAFF_ROLES:
        query = query.filter(Invoice.created_by == user.id)
    return query


def business_now() -> datetime:
    return datetime.now(_BUSINESS_TZ)


def parse_ymd(value: str | None) -> date | None:
    if not value:
        return None
    text = str(value).strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    start_local = datetime(day.year, day.month, day.day, 0, 0, 0, tzinfo=_BUSINESS_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def resolve_period(
    *,
    preset: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    days_back: int | None = None,
) -> tuple[date, date, str]:
    today = business_now().date()
    preset_key = (preset or "").strip().lower().replace("-", "_").replace(" ", "_")

    start = parse_ymd(date_from)
    end = parse_ymd(date_to)
    if start or end:
        start = start or end or today
        end = end or start
        if end < start:
            start, end = end, start
        return start, end, f"{start.isoformat()}_to_{end.isoformat()}"

    if days_back is not None:
        days = max(0, min(365, int(days_back)))
        return today - timedelta(days=days), today, f"last_{days}_days"

    if preset_key in ("today",):
        return today, today, "today"
    if preset_key in ("yesterday",):
        d = today - timedelta(days=1)
        return d, d, "yesterday"
    if preset_key in ("this_week", "week"):
        start = today - timedelta(days=today.weekday())
        return start, today, "this_week"
    if preset_key in ("last_week",):
        end = today - timedelta(days=today.weekday() + 1)
        start = end - timedelta(days=6)
        return start, end, "last_week"
    if preset_key in ("this_month", "month", ""):
        return today.replace(day=1), today, "this_month"
    if preset_key in ("last_month",):
        first_this = today.replace(day=1)
        end = first_this - timedelta(days=1)
        return end.replace(day=1), end, "last_month"

    return today.replace(day=1), today, "this_month"


def prior_period(start: date, end: date) -> tuple[date, date]:
    """Same-length window immediately before [start, end]."""
    length = (end - start).days + 1
    prior_end = start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=length - 1)
    return prior_start, prior_end


def invoice_range_filter(start: date, end: date):
    start_utc, _ = day_bounds_utc(start)
    _, end_utc = day_bounds_utc(end)
    return Invoice.created_at >= start_utc, Invoice.created_at < end_utc


def _summarize_invoices(invoices: list[Invoice]) -> dict:
    total = round(sum(float(inv.total_amount or 0) for inv in invoices), 2)
    count = len(invoices)
    by_status: dict[str, int] = {}
    for inv in invoices:
        st = inv.payment_status.value if inv.payment_status else "unknown"
        by_status[st] = by_status.get(st, 0) + 1
    aov = round(total / count, 2) if count else 0.0
    return {
        "invoice_count": count,
        "total_sales": total,
        "average_order_value": aov,
        "by_payment_status": by_status,
    }


def fetch_invoices_in_period(
    db: Session,
    user: User,
    start: date,
    end: date,
    *,
    load_shop: bool = False,
) -> list[Invoice]:
    opts = [joinedload(Invoice.shop)] if load_shop else []
    start_f, end_f = invoice_range_filter(start, end)
    q = db.query(Invoice).options(*opts).filter(start_f, end_f)
    q = scope_invoices(q, user)
    return q.all()


def tool_sales_summary(
    db: Session,
    user: User,
    *,
    preset: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    days_back: int | None = None,
) -> dict:
    start, end, label = resolve_period(
        preset=preset, date_from=date_from, date_to=date_to, days_back=days_back
    )
    invoices = fetch_invoices_in_period(db, user, start, end)
    summary = _summarize_invoices(invoices)
    return {
        "timezone": "America/Chicago",
        "period": label,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        **summary,
    }


def tool_sales_compare(
    db: Session,
    user: User,
    *,
    preset_a: str | None = "this_month",
    preset_b: str | None = "last_month",
    date_from_a: str | None = None,
    date_to_a: str | None = None,
    date_from_b: str | None = None,
    date_to_b: str | None = None,
) -> dict:
    start_a, end_a, label_a = resolve_period(
        preset=preset_a, date_from=date_from_a, date_to=date_to_a
    )
    if date_from_b or date_to_b or (preset_b and preset_b not in ("prior", "previous")):
        start_b, end_b, label_b = resolve_period(
            preset=preset_b, date_from=date_from_b, date_to=date_to_b
        )
    else:
        start_b, end_b = prior_period(start_a, end_a)
        label_b = "prior_period"

    a = _summarize_invoices(fetch_invoices_in_period(db, user, start_a, end_a))
    b = _summarize_invoices(fetch_invoices_in_period(db, user, start_b, end_b))
    delta = round(a["total_sales"] - b["total_sales"], 2)
    pct = round((delta / b["total_sales"]) * 100, 1) if b["total_sales"] else None
    direction = "up" if delta > 0.01 else ("down" if delta < -0.01 else "flat")
    return {
        "timezone": "America/Chicago",
        "period_a": {
            "label": label_a,
            "date_from": start_a.isoformat(),
            "date_to": end_a.isoformat(),
            **a,
        },
        "period_b": {
            "label": label_b,
            "date_from": start_b.isoformat(),
            "date_to": end_b.isoformat(),
            **b,
        },
        "delta_sales": delta,
        "delta_percent": pct,
        "direction": direction,
    }


def tool_sales_by_day(
    db: Session,
    user: User,
    *,
    preset: str | None = "this_month",
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict:
    start, end, label = resolve_period(preset=preset, date_from=date_from, date_to=date_to)
    invoices = fetch_invoices_in_period(db, user, start, end)
    by_day: dict[str, dict] = {}
    for inv in invoices:
        created = inv.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        local_day = created.astimezone(_BUSINESS_TZ).date().isoformat()
        bucket = by_day.setdefault(local_day, {"date": local_day, "total_sales": 0.0, "invoice_count": 0})
        bucket["total_sales"] = round(bucket["total_sales"] + float(inv.total_amount or 0), 2)
        bucket["invoice_count"] += 1

    days = sorted(by_day.values(), key=lambda r: r["date"])
    best = max(days, key=lambda r: r["total_sales"]) if days else None
    worst = min(days, key=lambda r: r["total_sales"]) if days else None
    return {
        "timezone": "America/Chicago",
        "period": label,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "days": days,
        "best_day": best,
        "worst_day": worst,
    }


def _outstanding_for_invoices(db: Session, invoices: list[Invoice]) -> tuple[float, int, int]:
    if not invoices:
        return 0.0, 0, 0
    unpaid = [inv for inv in invoices if inv.payment_status == PaymentStatus.unpaid]
    partial = [inv for inv in invoices if inv.payment_status == PaymentStatus.partial]
    open_invs = unpaid + partial
    if not open_invs:
        return 0.0, len(unpaid), len(partial)

    ids = [inv.id for inv in open_invs]
    paid_map = {
        invoice_id: float(total or 0)
        for invoice_id, total in (
            db.query(Payment.invoice_id, func.coalesce(func.sum(Payment.amount), 0))
            .filter(Payment.invoice_id.in_(ids))
            .group_by(Payment.invoice_id)
            .all()
        )
    }
    outstanding = 0.0
    for inv in open_invs:
        remaining = max(float(inv.total_amount or 0) - paid_map.get(inv.id, 0.0), 0.0)
        outstanding += remaining
    return round(outstanding, 2), len(unpaid), len(partial)


def tool_payments_summary(
    db: Session,
    user: User,
    *,
    preset: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    days_back: int | None = None,
) -> dict:
    start, end, label = resolve_period(
        preset=preset or "today",
        date_from=date_from,
        date_to=date_to,
        days_back=days_back,
    )

    # Collections by payment_date (date column)
    pay_q = db.query(func.coalesce(func.sum(Payment.amount), 0)).filter(
        Payment.payment_date >= start,
        Payment.payment_date <= end,
    )
    if role_of(user) not in _STAFF_ROLES:
        pay_q = pay_q.filter(Payment.created_by == user.id)
    collected = round(float(pay_q.scalar() or 0), 2)

    # Current outstanding (all open invoices in scope)
    open_q = (
        db.query(Invoice)
        .filter(Invoice.payment_status.in_([PaymentStatus.unpaid, PaymentStatus.partial]))
    )
    open_q = scope_invoices(open_q, user)
    open_invoices = open_q.all()
    outstanding, unpaid_count, partial_count = _outstanding_for_invoices(db, open_invoices)

    return {
        "timezone": "America/Chicago",
        "period": label,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "collected_amount": collected,
        "outstanding_balance": outstanding,
        "unpaid_invoice_count": unpaid_count,
        "partial_invoice_count": partial_count,
        "open_invoice_count": unpaid_count + partial_count,
    }


def _area_stats(invoices: list[Invoice]) -> dict[str, dict]:
    areas: dict[str, dict] = {}
    for inv in invoices:
        shop = inv.shop
        city = (shop.city or "Unknown").strip() if shop else "Unknown"
        state = (shop.state or "").strip() if shop else ""
        key = f"{city}|{state}"
        bucket = areas.setdefault(
            key,
            {
                "area": city,
                "city": city,
                "state": state or None,
                "total_sales": 0.0,
                "invoice_count": 0,
                "shop_ids": set(),
            },
        )
        bucket["total_sales"] = round(bucket["total_sales"] + float(inv.total_amount or 0), 2)
        bucket["invoice_count"] += 1
        if inv.shop_id:
            bucket["shop_ids"].add(str(inv.shop_id))
    out: dict[str, dict] = {}
    for key, bucket in areas.items():
        count = bucket["invoice_count"]
        sales = bucket["total_sales"]
        out[key] = {
            "area": bucket["area"],
            "city": bucket["city"],
            "state": bucket["state"],
            "total_sales": sales,
            "invoice_count": count,
            "shop_count": len(bucket["shop_ids"]),
            "average_order_value": round(sales / count, 2) if count else 0.0,
        }
    return out


def tool_sales_by_area(
    db: Session,
    user: User,
    *,
    preset: str | None = "this_month",
    date_from: str | None = None,
    date_to: str | None = None,
    sort_by: str = "total_sales",
    order: str = "desc",
    limit: int = 10,
    min_sales: float | None = None,
    compare_prior: bool = False,
) -> dict:
    start, end, label = resolve_period(preset=preset, date_from=date_from, date_to=date_to)
    invoices = fetch_invoices_in_period(db, user, start, end, load_shop=True)
    current = _area_stats(invoices)

    prior_map: dict[str, dict] = {}
    if compare_prior:
        p_start, p_end = prior_period(start, end)
        prior_map = _area_stats(fetch_invoices_in_period(db, user, p_start, p_end, load_shop=True))

    rows = []
    for key, row in current.items():
        item = dict(row)
        if compare_prior:
            prev = prior_map.get(key, {})
            prev_sales = float(prev.get("total_sales") or 0)
            item["prior_total_sales"] = prev_sales
            item["prior_invoice_count"] = int(prev.get("invoice_count") or 0)
            item["delta_sales"] = round(item["total_sales"] - prev_sales, 2)
            item["worse_than_prior"] = item["total_sales"] < prev_sales - 0.01
        if min_sales is not None and item["total_sales"] >= float(min_sales):
            # for "below threshold" callers pass order=asc and we filter opposite below
            pass
        rows.append(item)

    if min_sales is not None:
        # "sales below X" → keep rows under threshold
        rows = [r for r in rows if r["total_sales"] < float(min_sales)]

    sort_key = sort_by if sort_by in ("total_sales", "invoice_count", "average_order_value") else "total_sales"
    reverse = (order or "desc").lower() != "asc"
    rows.sort(key=lambda r: r.get(sort_key) or 0, reverse=reverse)
    rows = rows[: max(1, min(50, limit))]

    return {
        "timezone": "America/Chicago",
        "period": label,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "sort_by": sort_key,
        "order": "desc" if reverse else "asc",
        "areas": rows,
        "area_count": len(rows),
    }


def _match_city(invoices: list[Invoice], city_name: str) -> list[Invoice]:
    needle = (city_name or "").strip().lower()
    if not needle:
        return []
    return [
        inv
        for inv in invoices
        if inv.shop and inv.shop.city and needle in inv.shop.city.strip().lower()
    ]


def tool_compare_areas(
    db: Session,
    user: User,
    *,
    area_a: str,
    area_b: str,
    preset: str | None = "this_month",
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict:
    start, end, label = resolve_period(preset=preset, date_from=date_from, date_to=date_to)
    invoices = fetch_invoices_in_period(db, user, start, end, load_shop=True)

    def pack(name: str) -> dict:
        subset = _match_city(invoices, name)
        summary = _summarize_invoices(subset)
        cities = sorted(
            {
                (inv.shop.city or "").strip()
                for inv in subset
                if inv.shop and inv.shop.city
            }
        )
        return {"query": name, "matched_cities": cities, **summary}

    return {
        "timezone": "America/Chicago",
        "period": label,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "area_a": pack(area_a),
        "area_b": pack(area_b),
    }


def _find_shops(db: Session, name_query: str, limit: int = 10) -> list[Shop]:
    q = (name_query or "").strip()
    if not q:
        return []
    like = f"%{q}%"
    return (
        db.query(Shop)
        .filter(Shop.is_frozen.is_(False), Shop.name.ilike(like))
        .order_by(Shop.name.asc())
        .limit(limit)
        .all()
    )


def tool_shop_insights(
    db: Session,
    user: User,
    *,
    shop_name: str,
    preset: str | None = "this_month",
    date_from: str | None = None,
    date_to: str | None = None,
    history_limit: int = 10,
) -> dict:
    shops = _find_shops(db, shop_name, limit=5)
    if not shops:
        return {"note": f"No shop matched '{shop_name}'.", "matches": []}

    shop = shops[0]
    start, end, label = resolve_period(preset=preset, date_from=date_from, date_to=date_to)
    start_f, end_f = invoice_range_filter(start, end)

    period_q = db.query(Invoice).filter(Invoice.shop_id == shop.id, start_f, end_f)
    period_q = scope_invoices(period_q, user)
    period_invoices = period_q.order_by(Invoice.created_at.desc()).all()
    summary = _summarize_invoices(period_invoices)

    hist_q = (
        db.query(Invoice)
        .filter(Invoice.shop_id == shop.id)
        .order_by(Invoice.created_at.desc())
        .limit(max(1, min(30, history_limit)))
    )
    hist_q = scope_invoices(hist_q, user)
    history = hist_q.all()

    # Top products for this shop (all-time scoped, or period)
    item_q = (
        db.query(
            InvoiceItem.product_name,
            func.sum(InvoiceItem.quantity).label("qty"),
            func.sum(InvoiceItem.subtotal).label("revenue"),
        )
        .join(Invoice, InvoiceItem.invoice_id == Invoice.id)
        .filter(Invoice.shop_id == shop.id, start_f, end_f)
        .group_by(InvoiceItem.product_name)
        .order_by(func.sum(InvoiceItem.quantity).desc())
        .limit(10)
    )
    if role_of(user) not in _STAFF_ROLES:
        item_q = item_q.filter(Invoice.created_by == user.id)
    top_products = [
        {
            "product_name": r.product_name,
            "quantity_sold": int(r.qty or 0),
            "revenue": round(float(r.revenue or 0), 2),
        }
        for r in item_q.all()
    ]

    last = history[0] if history else None
    return {
        "timezone": "America/Chicago",
        "period": label,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "shop": {
            "id": str(shop.id),
            "name": shop.name,
            "city": shop.city,
            "state": shop.state,
        },
        "other_matches": [{"id": str(s.id), "name": s.name} for s in shops[1:]],
        **summary,
        "last_ordered_at": last.created_at.isoformat() if last and last.created_at else None,
        "recent_invoices": [
            {
                "invoice_number": inv.invoice_number,
                "total_amount": float(inv.total_amount or 0),
                "payment_status": inv.payment_status.value if inv.payment_status else None,
                "created_at": inv.created_at.isoformat() if inv.created_at else None,
            }
            for inv in history
        ],
        "usual_products": top_products,
    }


def tool_customer_rankings(
    db: Session,
    user: User,
    *,
    preset: str | None = "this_month",
    date_from: str | None = None,
    date_to: str | None = None,
    mode: str = "top",
    limit: int = 10,
) -> dict:
    start, end, label = resolve_period(preset=preset, date_from=date_from, date_to=date_to)
    current_inv = fetch_invoices_in_period(db, user, start, end, load_shop=True)
    p_start, p_end = prior_period(start, end)
    prior_inv = fetch_invoices_in_period(db, user, p_start, p_end, load_shop=True)

    def by_shop(invoices: list[Invoice]) -> dict[UUID, dict]:
        out: dict[UUID, dict] = {}
        for inv in invoices:
            if not inv.shop_id or not inv.shop:
                continue
            bucket = out.setdefault(
                inv.shop_id,
                {
                    "shop_id": str(inv.shop_id),
                    "name": inv.shop.name,
                    "city": inv.shop.city,
                    "total_sales": 0.0,
                    "invoice_count": 0,
                },
            )
            bucket["total_sales"] = round(bucket["total_sales"] + float(inv.total_amount or 0), 2)
            bucket["invoice_count"] += 1
        return out

    cur = by_shop(current_inv)
    prev = by_shop(prior_inv)
    mode_key = (mode or "top").lower()

    rows = []
    if mode_key in ("top", "top_sales"):
        rows = sorted(cur.values(), key=lambda r: r["total_sales"], reverse=True)
    elif mode_key in ("increased", "increase"):
        for sid, row in cur.items():
            prior_sales = float(prev.get(sid, {}).get("total_sales") or 0)
            delta = round(row["total_sales"] - prior_sales, 2)
            if delta > 0.01:
                rows.append({**row, "prior_total_sales": prior_sales, "delta_sales": delta})
        rows.sort(key=lambda r: r["delta_sales"], reverse=True)
    elif mode_key in ("reduced", "decrease", "decreased"):
        for sid, row in {**prev, **cur}.items():
            # shops that ordered last period and dropped (including to zero)
            name = (cur.get(sid) or prev.get(sid) or {}).get("name")
            city = (cur.get(sid) or prev.get(sid) or {}).get("city")
            cur_sales = float(cur.get(sid, {}).get("total_sales") or 0)
            prior_sales = float(prev.get(sid, {}).get("total_sales") or 0)
            delta = round(cur_sales - prior_sales, 2)
            if prior_sales > 0.01 and delta < -0.01:
                rows.append(
                    {
                        "shop_id": str(sid),
                        "name": name,
                        "city": city,
                        "total_sales": cur_sales,
                        "prior_total_sales": prior_sales,
                        "delta_sales": delta,
                        "invoice_count": int(cur.get(sid, {}).get("invoice_count") or 0),
                    }
                )
        rows.sort(key=lambda r: r["delta_sales"])
    else:
        rows = sorted(cur.values(), key=lambda r: r["total_sales"], reverse=True)

    return {
        "timezone": "America/Chicago",
        "period": label,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "prior_date_from": p_start.isoformat(),
        "prior_date_to": p_end.isoformat(),
        "mode": mode_key,
        "customers": rows[: max(1, min(50, limit))],
    }


def tool_product_sales(
    db: Session,
    user: User,
    *,
    preset: str | None = "this_month",
    date_from: str | None = None,
    date_to: str | None = None,
    sort_by: str = "quantity",
    order: str = "desc",
    limit: int = 10,
    product_name: str | None = None,
    city: str | None = None,
    shop_name: str | None = None,
    unsold_days: int | None = None,
    compare_prior: bool = False,
) -> dict:
    start, end, label = resolve_period(preset=preset, date_from=date_from, date_to=date_to)
    start_f, end_f = invoice_range_filter(start, end)

    if unsold_days is not None:
        days = max(1, min(365, int(unsold_days)))
        cutoff = business_now().date() - timedelta(days=days)
        cutoff_utc, _ = day_bounds_utc(cutoff)
        sold_ids = (
            db.query(InvoiceItem.product_id)
            .join(Invoice, InvoiceItem.invoice_id == Invoice.id)
            .filter(Invoice.created_at >= cutoff_utc)
        )
        if role_of(user) not in _STAFF_ROLES:
            sold_ids = sold_ids.filter(Invoice.created_by == user.id)
        sold_ids = {row[0] for row in sold_ids.distinct().all()}
        products = (
            db.query(Product)
            .filter(Product.is_active.is_(True))
            .order_by(Product.name.asc())
            .all()
        )
        unsold = [
            {"product_id": str(p.id), "product_name": p.name, "sku": p.sku}
            for p in products
            if p.id not in sold_ids
        ][: max(1, min(50, limit))]
        return {
            "timezone": "America/Chicago",
            "mode": "unsold",
            "since_date": cutoff.isoformat(),
            "days": days,
            "products": unsold,
            "product_count": len(unsold),
        }

    q = (
        db.query(
            InvoiceItem.product_id,
            InvoiceItem.product_name,
            func.sum(InvoiceItem.quantity).label("qty"),
            func.sum(InvoiceItem.subtotal).label("revenue"),
        )
        .join(Invoice, InvoiceItem.invoice_id == Invoice.id)
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(start_f, end_f, Shop.is_frozen.is_(False))
        .group_by(InvoiceItem.product_id, InvoiceItem.product_name)
    )
    if role_of(user) not in _STAFF_ROLES:
        q = q.filter(Invoice.created_by == user.id)
    if product_name:
        q = q.filter(InvoiceItem.product_name.ilike(f"%{product_name.strip()}%"))
    if city:
        q = q.filter(Shop.city.ilike(f"%{city.strip()}%"))
    if shop_name:
        q = q.filter(Shop.name.ilike(f"%{shop_name.strip()}%"))

    rows = q.all()
    items = [
        {
            "product_id": str(r.product_id) if r.product_id else None,
            "product_name": r.product_name,
            "quantity_sold": int(r.qty or 0),
            "revenue": round(float(r.revenue or 0), 2),
        }
        for r in rows
    ]

    if compare_prior:
        p_start, p_end = prior_period(start, end)
        ps, pe = invoice_range_filter(p_start, p_end)
        pq = (
            db.query(
                InvoiceItem.product_name,
                func.sum(InvoiceItem.quantity).label("qty"),
                func.sum(InvoiceItem.subtotal).label("revenue"),
            )
            .join(Invoice, InvoiceItem.invoice_id == Invoice.id)
            .join(Shop, Invoice.shop_id == Shop.id)
            .filter(ps, pe, Shop.is_frozen.is_(False))
            .group_by(InvoiceItem.product_name)
        )
        if role_of(user) not in _STAFF_ROLES:
            pq = pq.filter(Invoice.created_by == user.id)
        prior = {r.product_name: r for r in pq.all()}
        for item in items:
            prev = prior.get(item["product_name"])
            prev_qty = int(prev.qty or 0) if prev else 0
            prev_rev = round(float(prev.revenue or 0), 2) if prev else 0.0
            item["prior_quantity_sold"] = prev_qty
            item["prior_revenue"] = prev_rev
            item["delta_quantity"] = item["quantity_sold"] - prev_qty
            item["trend"] = (
                "up"
                if item["delta_quantity"] > 0
                else ("down" if item["delta_quantity"] < 0 else "flat")
            )

    sort_key = "revenue" if (sort_by or "").lower() in ("revenue", "sales") else "quantity_sold"
    if sort_key == "quantity_sold":
        # normalize field name used above
        pass
    field = "revenue" if sort_key == "revenue" else "quantity_sold"
    reverse = (order or "desc").lower() != "asc"
    items.sort(key=lambda r: r.get(field) or 0, reverse=reverse)

    return {
        "timezone": "America/Chicago",
        "period": label,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "sort_by": field,
        "order": "desc" if reverse else "asc",
        "filters": {
            "product_name": product_name,
            "city": city,
            "shop_name": shop_name,
        },
        "products": items[: max(1, min(50, limit))],
        "product_count": min(len(items), max(1, min(50, limit))),
    }


def tool_rep_performance(
    db: Session,
    user: User,
    *,
    preset: str | None = "this_month",
    date_from: str | None = None,
    date_to: str | None = None,
    salesperson_name: str | None = None,
    compare_prior: bool = False,
    limit: int = 20,
) -> dict:
    start, end, label = resolve_period(preset=preset, date_from=date_from, date_to=date_to)
    invoices = fetch_invoices_in_period(db, user, start, end)

    user_ids = {inv.created_by for inv in invoices if inv.created_by}
    users = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    def aggregate(inv_list: list[Invoice]) -> dict[UUID, dict]:
        out: dict[UUID, dict] = {}
        for inv in inv_list:
            if not inv.created_by:
                continue
            u = users.get(inv.created_by)
            bucket = out.setdefault(
                inv.created_by,
                {
                    "user_id": str(inv.created_by),
                    "full_name": u.full_name if u else "Unknown",
                    "email": u.email if u else None,
                    "total_sales": 0.0,
                    "invoice_count": 0,
                    "shop_ids": set(),
                },
            )
            bucket["total_sales"] = round(bucket["total_sales"] + float(inv.total_amount or 0), 2)
            bucket["invoice_count"] += 1
            if inv.shop_id:
                bucket["shop_ids"].add(str(inv.shop_id))
        return out

    # If filtering by name, load all users matching name for empty-period clarity
    name_q = (salesperson_name or "").strip().lower()
    if name_q:
        matched_users = (
            db.query(User)
            .filter(
                or_(
                    User.full_name.ilike(f"%{salesperson_name.strip()}%"),
                    User.email.ilike(f"%{salesperson_name.strip()}%"),
                )
            )
            .all()
        )
        for u in matched_users:
            users[u.id] = u

    current = aggregate(invoices)
    prior_map: dict[UUID, dict] = {}
    if compare_prior:
        p_start, p_end = prior_period(start, end)
        prior_inv = fetch_invoices_in_period(db, user, p_start, p_end)
        # ensure user names available
        missing = {inv.created_by for inv in prior_inv if inv.created_by and inv.created_by not in users}
        if missing:
            for u in db.query(User).filter(User.id.in_(missing)).all():
                users[u.id] = u
        prior_map = aggregate(prior_inv)

    rows = []
    ids = set(current) | set(prior_map)
    if name_q:
        ids = {uid for uid in ids if users.get(uid) and name_q in (users[uid].full_name or "").lower()}
        # also include matched users with zero sales
        for u in users.values():
            if name_q in (u.full_name or "").lower() or name_q in (u.email or "").lower():
                ids.add(u.id)

    for uid in ids:
        cur = current.get(uid, {})
        prev = prior_map.get(uid, {})
        u = users.get(uid)
        sales = float(cur.get("total_sales") or 0)
        count = int(cur.get("invoice_count") or 0)
        shops = cur.get("shop_ids") or set()
        row = {
            "user_id": str(uid),
            "full_name": u.full_name if u else cur.get("full_name") or "Unknown",
            "email": u.email if u else cur.get("email"),
            "total_sales": sales,
            "invoice_count": count,
            "average_order_value": round(sales / count, 2) if count else 0.0,
            "unique_shops": len(shops),
        }
        if compare_prior:
            prev_sales = float(prev.get("total_sales") or 0)
            row["prior_total_sales"] = prev_sales
            row["delta_sales"] = round(sales - prev_sales, 2)
            row["improved"] = row["delta_sales"] > 0.01
        rows.append(row)

    rows.sort(key=lambda r: r["total_sales"], reverse=True)
    return {
        "timezone": "America/Chicago",
        "period": label,
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "salespeople": rows[: max(1, min(50, limit))],
    }


def tool_focus_recommendations(db: Session, user: User, *, limit: int = 8) -> dict:
    """Deterministic focus list: MoM city drops + outstanding + quiet shops."""
    today = business_now().date()
    this_start, this_end, _ = resolve_period(preset="this_month")
    last_start, last_end, _ = resolve_period(preset="last_month")
    week_start, week_end, _ = resolve_period(preset="this_week")

    this_areas = _area_stats(fetch_invoices_in_period(db, user, this_start, this_end, load_shop=True))
    last_areas = _area_stats(fetch_invoices_in_period(db, user, last_start, last_end, load_shop=True))

    # Outstanding by city
    open_q = (
        db.query(Invoice)
        .options(joinedload(Invoice.shop))
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(
            Shop.is_frozen.is_(False),
            Invoice.payment_status.in_([PaymentStatus.unpaid, PaymentStatus.partial]),
        )
    )
    open_q = scope_invoices(open_q, user)
    open_invoices = open_q.all()
    paid_map = {}
    if open_invoices:
        ids = [inv.id for inv in open_invoices]
        paid_map = {
            invoice_id: float(total or 0)
            for invoice_id, total in (
                db.query(Payment.invoice_id, func.coalesce(func.sum(Payment.amount), 0))
                .filter(Payment.invoice_id.in_(ids))
                .group_by(Payment.invoice_id)
                .all()
            )
        }
    outstanding_by_city: dict[str, float] = {}
    for inv in open_invoices:
        city = (inv.shop.city or "Unknown").strip() if inv.shop else "Unknown"
        remaining = max(float(inv.total_amount or 0) - paid_map.get(inv.id, 0.0), 0.0)
        outstanding_by_city[city] = round(outstanding_by_city.get(city, 0.0) + remaining, 2)

    # Quiet churned shops (30d, exclude never-ordered)
    cutoff = today - timedelta(days=30)
    cutoff_utc, _ = day_bounds_utc(cutoff)
    last_order_q = db.query(
        Invoice.shop_id.label("shop_id"),
        func.max(Invoice.created_at).label("last_ordered_at"),
    ).group_by(Invoice.shop_id)
    if role_of(user) not in _STAFF_ROLES:
        last_order_q = last_order_q.filter(Invoice.created_by == user.id)
    last_sq = last_order_q.subquery()
    quiet_rows = (
        db.query(Shop.city, Shop.name, last_sq.c.last_ordered_at)
        .join(last_sq, Shop.id == last_sq.c.shop_id)
        .filter(
            Shop.is_frozen.is_(False),
            last_sq.c.last_ordered_at.isnot(None),
            last_sq.c.last_ordered_at < cutoff_utc,
        )
        .all()
    )
    quiet_by_city: dict[str, list[str]] = {}
    for city, name, _last in quiet_rows:
        c = (city or "Unknown").strip()
        quiet_by_city.setdefault(c, []).append(name)

    scored: list[dict] = []
    # keys are city|state — roll up to city
    city_roll_this: dict[str, dict] = {}
    city_roll_last: dict[str, dict] = {}
    for row in this_areas.values():
        city = row["city"]
        bucket = city_roll_this.setdefault(city, {"total_sales": 0.0, "invoice_count": 0})
        bucket["total_sales"] = round(bucket["total_sales"] + row["total_sales"], 2)
        bucket["invoice_count"] += row["invoice_count"]
    for row in last_areas.values():
        city = row["city"]
        bucket = city_roll_last.setdefault(city, {"total_sales": 0.0, "invoice_count": 0})
        bucket["total_sales"] = round(bucket["total_sales"] + row["total_sales"], 2)
        bucket["invoice_count"] += row["invoice_count"]

    for city in set(city_roll_this) | set(city_roll_last) | set(outstanding_by_city) | set(quiet_by_city):
        cur = float(city_roll_this.get(city, {}).get("total_sales") or 0)
        prev = float(city_roll_last.get(city, {}).get("total_sales") or 0)
        delta = round(cur - prev, 2)
        outstanding = float(outstanding_by_city.get(city) or 0)
        quiet = quiet_by_city.get(city) or []
        reasons = []
        score = 0.0
        if prev > 0 and delta < -0.01:
            drop_pct = abs(delta) / prev * 100
            reasons.append(f"Sales down {drop_pct:.0f}% vs last month (${prev:.0f} → ${cur:.0f})")
            score += min(40.0, drop_pct)
        if outstanding >= 500:
            reasons.append(f"Outstanding balance ${outstanding:.0f}")
            score += min(30.0, outstanding / 200.0)
        if quiet:
            reasons.append(f"{len(quiet)} shop(s) quiet 30+ days (e.g. {', '.join(quiet[:3])})")
            score += min(30.0, len(quiet) * 3)
        if not reasons:
            continue
        scored.append(
            {
                "area": city,
                "score": round(score, 1),
                "this_month_sales": cur,
                "last_month_sales": prev,
                "delta_sales": delta,
                "outstanding_balance": outstanding,
                "quiet_shop_count": len(quiet),
                "reasons": reasons,
                "sample_quiet_shops": quiet[:5],
            }
        )

    scored.sort(key=lambda r: r["score"], reverse=True)
    return {
        "timezone": "America/Chicago",
        "as_of": today.isoformat(),
        "this_week": {"date_from": week_start.isoformat(), "date_to": week_end.isoformat()},
        "recommendations": scored[: max(1, min(20, limit))],
        "note": None
        if scored
        else "No strong focus signals from MoM drops, outstanding balances, or quiet shops.",
    }
