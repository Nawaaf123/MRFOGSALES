"""OpenAI-backed helpers: suggest order + grounded sales chat."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_roles
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
from app.schemas import (
    AiChatRequest,
    AiChatResponse,
    SuggestOrderItem,
    SuggestOrderRequest,
    SuggestOrderResponse,
)
from app.services.openai_client import require_openai_client
from app.services import ai_analytics as analytics

router = APIRouter(prefix="/ai", tags=["ai"])

_BUSINESS_TZ = ZoneInfo("America/Chicago")
_STAFF_ROLES = (AppRole.admin, AppRole.sales, AppRole.srour)


def _role(user: User) -> AppRole:
    return user.role.role if user.role else AppRole.sales


def _scope_invoices(query, user: User):
    """Staff (admin/sales/srour) see all invoices; others only their own."""
    role = _role(user)
    if role not in _STAFF_ROLES:
        query = query.filter(Invoice.created_by == user.id)
    return query


def _business_now() -> datetime:
    return datetime.now(_BUSINESS_TZ)


def _parse_ymd(value: str | None) -> date | None:
    if not value:
        return None
    text = str(value).strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """Inclusive calendar day in America/Chicago → UTC-aware bounds."""
    start_local = datetime(day.year, day.month, day.day, 0, 0, 0, tzinfo=_BUSINESS_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def _aggregate_shop_products(
    db: Session,
    user: User,
    shop_id: UUID,
    limit: int,
) -> list[dict]:
    shop = db.query(Shop).filter(Shop.id == shop_id, Shop.is_frozen.is_(False)).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")

    inv_q = db.query(Invoice.id).filter(Invoice.shop_id == shop_id)
    inv_q = _scope_invoices(inv_q, user)
    invoice_ids = [
        row[0]
        for row in inv_q.order_by(Invoice.created_at.desc()).limit(40).all()
    ]
    if not invoice_ids:
        return []

    rows = (
        db.query(
            InvoiceItem.product_id,
            InvoiceItem.product_name,
            func.sum(InvoiceItem.quantity).label("qty_sum"),
            func.count(InvoiceItem.id).label("line_count"),
            func.avg(InvoiceItem.unit_price).label("avg_price"),
        )
        .filter(InvoiceItem.invoice_id.in_(invoice_ids))
        .group_by(InvoiceItem.product_id, InvoiceItem.product_name)
        .order_by(func.sum(InvoiceItem.quantity).desc())
        .limit(limit * 2)
        .all()
    )

    product_ids = [r.product_id for r in rows]
    products = {
        p.id: p
        for p in db.query(Product)
        .filter(Product.id.in_(product_ids), Product.is_active.is_(True))
        .all()
    }

    # Typical order qty ≈ average per invoice line appearance
    inv_count = max(len(invoice_ids), 1)
    out: list[dict] = []
    for r in rows:
        product = products.get(r.product_id)
        if not product:
            continue
        qty_sum = int(r.qty_sum or 0)
        typical = max(1, round(qty_sum / inv_count))
        # Prefer median-ish: clamp using avg per line when frequent
        if int(r.line_count or 0) > 0:
            per_line = max(1, round(qty_sum / int(r.line_count)))
            typical = max(1, min(per_line, typical * 2))
        price = float(product.price or r.avg_price or 0)
        out.append(
            {
                "product_id": str(product.id),
                "product_name": product.name,
                "sku": product.sku,
                "quantity": typical,
                "unit_price": price,
                "qty_sum": qty_sum,
                "line_count": int(r.line_count or 0),
            }
        )
        if len(out) >= limit:
            break
    return out


@router.post("/suggest-order", response_model=SuggestOrderResponse)
def suggest_order(
    payload: SuggestOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> SuggestOrderResponse:
    candidates = _aggregate_shop_products(db, current_user, payload.shop_id, payload.limit)
    if not candidates:
        return SuggestOrderResponse(
            shop_id=payload.shop_id,
            items=[],
            note="No prior invoices for this shop to suggest from.",
        )

    # Light LLM polish: reorder / adjust qty within safe bounds; prices stay from DB.
    client, model = require_openai_client()
    catalog = [
        {
            "product_id": c["product_id"],
            "product_name": c["product_name"],
            "sku": c["sku"],
            "suggested_qty": c["quantity"],
            "unit_price": c["unit_price"],
            "history_qty_sum": c["qty_sum"],
            "times_ordered": c["line_count"],
        }
        for c in candidates
    ]
    try:
        completion = client.chat.completions.create(
            model=model,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You help a field sales rep build a reorder for a smoke-shop customer. "
                        "Given product history JSON, return JSON: "
                        '{"items":[{"product_id":"...","quantity":N,"reason":"short"}]} '
                        "Only use product_ids from the input. quantity must be an integer 1-100. "
                        "Prefer frequent/high-qty products. Keep at most the requested limit. "
                        "Do not invent products or change prices."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"limit": payload.limit, "candidates": catalog},
                        default=str,
                    ),
                },
            ],
        )
        raw = completion.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        llm_items = parsed.get("items") if isinstance(parsed, dict) else None
    except Exception:
        llm_items = None

    by_id = {c["product_id"]: c for c in candidates}
    items: list[SuggestOrderItem] = []
    if isinstance(llm_items, list):
        for row in llm_items:
            if not isinstance(row, dict):
                continue
            pid = str(row.get("product_id") or "")
            base = by_id.get(pid)
            if not base:
                continue
            try:
                qty = int(row.get("quantity") or base["quantity"])
            except (TypeError, ValueError):
                qty = base["quantity"]
            qty = max(1, min(100, qty))
            reason = str(row.get("reason") or "Based on recent orders")[:160]
            items.append(
                SuggestOrderItem(
                    product_id=UUID(pid),
                    product_name=base["product_name"],
                    sku=base["sku"],
                    quantity=qty,
                    unit_price=base["unit_price"],
                    reason=reason,
                )
            )
            if len(items) >= payload.limit:
                break

    if not items:
        items = [
            SuggestOrderItem(
                product_id=UUID(c["product_id"]),
                product_name=c["product_name"],
                sku=c["sku"],
                quantity=c["quantity"],
                unit_price=c["unit_price"],
                reason="Top product from recent invoices",
            )
            for c in candidates[: payload.limit]
        ]

    return SuggestOrderResponse(shop_id=payload.shop_id, items=items, note=None)


def _tool_shop_balances(db: Session, user: User, limit: int = 15) -> list[dict]:
    q = (
        db.query(Invoice)
        .options(joinedload(Invoice.shop))
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(
            Shop.is_frozen.is_(False),
            Invoice.payment_status.in_([PaymentStatus.unpaid, PaymentStatus.partial]),
        )
    )
    q = _scope_invoices(q, user)
    invoices = q.all()
    if not invoices:
        return []

    paid_map: dict[UUID, float] = {}
    ids = [inv.id for inv in invoices]
    rows = (
        db.query(Payment.invoice_id, func.coalesce(func.sum(Payment.amount), 0))
        .filter(Payment.invoice_id.in_(ids))
        .group_by(Payment.invoice_id)
        .all()
    )
    for invoice_id, total in rows:
        paid_map[invoice_id] = float(total or 0)

    balances: dict[UUID, dict] = {}
    for inv in invoices:
        remaining = max(float(inv.total_amount or 0) - paid_map.get(inv.id, 0.0), 0.0)
        if remaining <= 0.01 or not inv.shop:
            continue
        bucket = balances.setdefault(
            inv.shop_id,
            {"shop_id": str(inv.shop_id), "name": inv.shop.name, "city": inv.shop.city, "unpaid_balance": 0.0},
        )
        bucket["unpaid_balance"] = round(bucket["unpaid_balance"] + remaining, 2)

    ranked = sorted(balances.values(), key=lambda r: r["unpaid_balance"], reverse=True)
    return ranked[:limit]


def _tool_recent_invoices(db: Session, user: User, limit: int = 10) -> list[dict]:
    q = (
        db.query(Invoice)
        .options(joinedload(Invoice.shop))
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(Shop.is_frozen.is_(False))
        .order_by(Invoice.created_at.desc())
        .limit(limit)
    )
    q = _scope_invoices(q, user)
    invoices = q.all()
    return [
        {
            "invoice_number": inv.invoice_number,
            "shop": inv.shop.name if inv.shop else None,
            "total_amount": float(inv.total_amount or 0),
            "payment_status": inv.payment_status.value if inv.payment_status else None,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
        }
        for inv in invoices
    ]


def _tool_invoices_by_date(
    db: Session,
    user: User,
    *,
    date_from: str | None = None,
    date_to: str | None = None,
    days_back: int | None = None,
    payment_status: str | None = None,
    limit: int = 30,
) -> dict:
    """Invoices in a calendar range (America/Chicago). Includes summary totals."""
    today = _business_now().date()
    start_day = _parse_ymd(date_from)
    end_day = _parse_ymd(date_to)

    if days_back is not None and start_day is None and end_day is None:
        days = max(0, min(365, int(days_back)))
        end_day = today
        start_day = today - timedelta(days=days)

    if start_day is None and end_day is None:
        # Default: yesterday (most common chat ask when date tools are used loosely)
        start_day = today - timedelta(days=1)
        end_day = start_day
    elif start_day is None:
        start_day = end_day
    elif end_day is None:
        end_day = start_day

    assert start_day is not None and end_day is not None
    if end_day < start_day:
        start_day, end_day = end_day, start_day

    start_utc, _ = _day_bounds_utc(start_day)
    _, end_utc = _day_bounds_utc(end_day)

    q = (
        db.query(Invoice)
        .options(joinedload(Invoice.shop))
        .join(Shop, Invoice.shop_id == Shop.id)
        .filter(
            Shop.is_frozen.is_(False),
            Invoice.created_at >= start_utc,
            Invoice.created_at < end_utc,
        )
        .order_by(Invoice.created_at.desc())
    )
    q = _scope_invoices(q, user)

    status_key = (payment_status or "").strip().lower()
    if status_key in ("paid", "partial", "unpaid"):
        q = q.filter(Invoice.payment_status == PaymentStatus(status_key))

    invoices = q.limit(max(1, min(50, limit))).all()
    items = [
        {
            "invoice_number": inv.invoice_number,
            "shop": inv.shop.name if inv.shop else None,
            "total_amount": float(inv.total_amount or 0),
            "payment_status": inv.payment_status.value if inv.payment_status else None,
            "created_at": inv.created_at.isoformat() if inv.created_at else None,
        }
        for inv in invoices
    ]
    total_amount = round(sum(i["total_amount"] for i in items), 2)
    by_status: dict[str, int] = {}
    for i in items:
        st = i["payment_status"] or "unknown"
        by_status[st] = by_status.get(st, 0) + 1

    return {
        "timezone": "America/Chicago",
        "date_from": start_day.isoformat(),
        "date_to": end_day.isoformat(),
        "invoice_count": len(items),
        "total_amount": total_amount,
        "by_payment_status": by_status,
        "invoices": items,
        "note": (
            None
            if items
            else f"No invoices found from {start_day.isoformat()} to {end_day.isoformat()} (America/Chicago)."
        ),
    }


def _tool_quiet_shops(
    db: Session,
    user: User,
    *,
    days_without_order: int | None = None,
    since_date: str | None = None,
    include_never_ordered: bool = False,
    limit: int = 20,
) -> dict:
    """Shops with no invoice since a cutoff (or never ordered)."""
    today = _business_now().date()
    since = _parse_ymd(since_date)
    if since is None:
        days = 30 if days_without_order is None else int(days_without_order)
        days = max(1, min(730, days))
        since = today - timedelta(days=days)
    else:
        days = (today - since).days

    cutoff_utc, _ = _day_bounds_utc(since)

    last_order_q = (
        db.query(
            Invoice.shop_id.label("shop_id"),
            func.max(Invoice.created_at).label("last_ordered_at"),
        )
        .group_by(Invoice.shop_id)
    )
    if _role(user) not in _STAFF_ROLES:
        last_order_q = last_order_q.filter(Invoice.created_by == user.id)
    last_order_sq = last_order_q.subquery()

    q = (
        db.query(
            Shop.id,
            Shop.name,
            Shop.city,
            Shop.state,
            last_order_sq.c.last_ordered_at,
        )
        .outerjoin(last_order_sq, Shop.id == last_order_sq.c.shop_id)
        .filter(Shop.is_frozen.is_(False))
    )
    if include_never_ordered:
        q = q.filter(
            (last_order_sq.c.last_ordered_at.is_(None))
            | (last_order_sq.c.last_ordered_at < cutoff_utc)
        )
    else:
        q = q.filter(
            last_order_sq.c.last_ordered_at.isnot(None),
            last_order_sq.c.last_ordered_at < cutoff_utc,
        )

    # Never-ordered first, then oldest last order.
    rows = (
        q.order_by(
            (last_order_sq.c.last_ordered_at.is_(None)).desc(),
            last_order_sq.c.last_ordered_at.asc(),
            Shop.name.asc(),
        )
        .limit(max(1, min(50, limit)))
        .all()
    )

    shops = []
    for shop_id, name, city, state, last_at in rows:
        if last_at is None:
            days_quiet = None
            last_iso = None
        else:
            last_local = (
                last_at.replace(tzinfo=timezone.utc).astimezone(_BUSINESS_TZ)
                if last_at.tzinfo is None
                else last_at.astimezone(_BUSINESS_TZ)
            )
            days_quiet = (today - last_local.date()).days
            last_iso = last_at.isoformat()
        shops.append(
            {
                "shop_id": str(shop_id),
                "name": name,
                "city": city,
                "state": state,
                "last_ordered_at": last_iso,
                "days_since_last_order": days_quiet,
                "never_ordered": last_at is None,
            }
        )

    return {
        "timezone": "America/Chicago",
        "since_date": since.isoformat(),
        "days_without_order": days,
        "shop_count": len(shops),
        "shops": shops,
        "note": (
            None
            if shops
            else f"No quiet shops found since {since.isoformat()} (everyone ordered more recently)."
        ),
    }


def _tool_low_stock(db: Session, limit: int = 15) -> list[dict]:
    products = (
        db.query(Product)
        .filter(Product.is_active.is_(True))
        .all()
    )
    rows = []
    for p in products:
        total = int(p.stock_quantity or 0) + int(p.stock_quantity_b or 0)
        thresh = int(p.low_stock_threshold or 0)
        if total <= thresh:
            rows.append(
                {
                    "name": p.name,
                    "sku": p.sku,
                    "stock_a": int(p.stock_quantity or 0),
                    "stock_b": int(p.stock_quantity_b or 0),
                    "total_stock": total,
                    "threshold": thresh,
                }
            )
    rows.sort(key=lambda r: r["total_stock"])
    return rows[:limit]


def _tool_top_products(db: Session, user: User, limit: int = 10) -> list[dict]:
    q = (
        db.query(
            InvoiceItem.product_name,
            func.sum(InvoiceItem.quantity).label("qty"),
            func.sum(InvoiceItem.subtotal).label("revenue"),
        )
        .join(Invoice, InvoiceItem.invoice_id == Invoice.id)
        .group_by(InvoiceItem.product_name)
        .order_by(func.sum(InvoiceItem.quantity).desc())
        .limit(limit)
    )
    if _role(user) not in _STAFF_ROLES:
        q = q.filter(Invoice.created_by == user.id)
    return [
        {
            "product_name": r.product_name,
            "quantity_sold": int(r.qty or 0),
            "revenue": round(float(r.revenue or 0), 2),
        }
        for r in q.all()
    ]


CHAT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "shop_balances",
            "description": "List shops with unpaid/partial invoice balances (highest first).",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "recent_invoices",
            "description": "List the most recent invoices overall (no date filter).",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "invoices_by_date",
            "description": (
                "List individual invoices in a calendar date range (America/Chicago). "
                "Use when the user wants an invoice list for yesterday/today/a date range. "
                "For totals/AOV use sales_summary instead."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date_from": {
                        "type": "string",
                        "description": "Start date YYYY-MM-DD (America/Chicago).",
                    },
                    "date_to": {
                        "type": "string",
                        "description": "End date YYYY-MM-DD inclusive (America/Chicago).",
                    },
                    "days_back": {
                        "type": "integer",
                        "description": "Alternative to dates: include invoices from the last N days through today.",
                        "minimum": 0,
                        "maximum": 365,
                    },
                    "payment_status": {
                        "type": "string",
                        "enum": ["paid", "partial", "unpaid"],
                    },
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sales_summary",
            "description": (
                "Sales totals for a period: invoice_count, total_sales, average_order_value, "
                "payment_status breakdown. Use for total sales today/yesterday/week/month and AOV."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset": {
                        "type": "string",
                        "enum": [
                            "today",
                            "yesterday",
                            "this_week",
                            "last_week",
                            "this_month",
                            "last_month",
                        ],
                    },
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                    "days_back": {"type": "integer", "minimum": 0, "maximum": 365},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sales_compare",
            "description": (
                "Compare sales between two periods (totals, delta $, delta %, up/down). "
                "Default this_month vs last_month. Use for MoM and increasing/decreasing questions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset_a": {"type": "string"},
                    "preset_b": {"type": "string"},
                    "date_from_a": {"type": "string"},
                    "date_to_a": {"type": "string"},
                    "date_from_b": {"type": "string"},
                    "date_to_b": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sales_by_day",
            "description": (
                "Daily sales breakdown for a month/range with best_day and worst_day. "
                "Use for best/lowest sales day this month."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset": {
                        "type": "string",
                        "enum": ["this_month", "last_month", "this_week", "last_week"],
                    },
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "payments_summary",
            "description": (
                "Collections in a period (by payment_date) plus current outstanding balance, "
                "unpaid and partial invoice counts. Use for collected today/week and how much outstanding."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset": {
                        "type": "string",
                        "enum": [
                            "today",
                            "yesterday",
                            "this_week",
                            "last_week",
                            "this_month",
                            "last_month",
                        ],
                    },
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                    "days_back": {"type": "integer", "minimum": 0, "maximum": 365},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sales_by_area",
            "description": (
                "Sales/orders/AOV grouped by shop city (area). Sort top/bottom, filter min_sales "
                "(areas below threshold), optional MoM compare_prior. Use for top/bottom areas."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset": {"type": "string"},
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                    "sort_by": {
                        "type": "string",
                        "enum": ["total_sales", "invoice_count", "average_order_value"],
                    },
                    "order": {"type": "string", "enum": ["asc", "desc"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                    "min_sales": {
                        "type": "number",
                        "description": "Keep only areas with total_sales strictly below this amount.",
                    },
                    "compare_prior": {"type": "boolean"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compare_areas",
            "description": "Side-by-side sales/orders/AOV for two city names (e.g. Bensenville vs Addison).",
            "parameters": {
                "type": "object",
                "properties": {
                    "area_a": {"type": "string"},
                    "area_b": {"type": "string"},
                    "preset": {"type": "string"},
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                },
                "required": ["area_a", "area_b"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "shop_insights",
            "description": (
                "Insights for one shop by name: period sales, AOV, order count, last order, "
                "recent invoices, usual products."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "shop_name": {"type": "string"},
                    "preset": {"type": "string"},
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                    "history_limit": {"type": "integer", "minimum": 1, "maximum": 30},
                },
                "required": ["shop_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "customer_rankings",
            "description": (
                "Rank shops (customers) by sales: top, biggest increase vs prior period, or reduced. "
                "Modes: top, increased, reduced."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset": {"type": "string"},
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                    "mode": {
                        "type": "string",
                        "enum": ["top", "increased", "reduced"],
                    },
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "quiet_shops",
            "description": (
                "Shops that have not ordered since a cutoff. Default returns CHURNED shops only "
                "(had orders before, silent since cutoff). Set include_never_ordered=true only when "
                "asked about shops that never ordered."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days_without_order": {
                        "type": "integer",
                        "description": "No invoice for at least this many days (default 30).",
                        "minimum": 1,
                        "maximum": 730,
                    },
                    "since_date": {
                        "type": "string",
                        "description": "Alternative cutoff YYYY-MM-DD; shops with no order on/after this date.",
                    },
                    "include_never_ordered": {
                        "type": "boolean",
                        "description": "Include shops with zero invoices ever (default false).",
                    },
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "product_sales",
            "description": (
                "Product sales by period: top/least by qty or revenue, filter by city/shop/product name, "
                "unsold_days for products not sold recently, compare_prior for trends."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset": {"type": "string"},
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                    "sort_by": {"type": "string", "enum": ["quantity", "revenue"]},
                    "order": {"type": "string", "enum": ["asc", "desc"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                    "product_name": {"type": "string"},
                    "city": {"type": "string"},
                    "shop_name": {"type": "string"},
                    "unsold_days": {"type": "integer", "minimum": 1, "maximum": 365},
                    "compare_prior": {"type": "boolean"},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "rep_performance",
            "description": (
                "Salesperson performance by invoice created_by: sales, orders, AOV, unique shops. "
                "Optional salesperson_name filter and MoM compare_prior."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "preset": {"type": "string"},
                    "date_from": {"type": "string"},
                    "date_to": {"type": "string"},
                    "salesperson_name": {"type": "string"},
                    "compare_prior": {"type": "boolean"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "focus_recommendations",
            "description": (
                "Rule-based list of cities/areas to focus on this week: MoM sales drops, "
                "high outstanding balances, quiet/churned shops. Use for which areas should we focus on."
            ),
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 20}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "low_stock",
            "description": "List products at or below low-stock threshold.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "top_products",
            "description": "Top products by quantity sold (all-time-ish). Prefer product_sales for period filters.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}},
            },
        },
    },
]


def _run_tool(name: str, args: dict, db: Session, user: User) -> str:
    limit = int(args.get("limit") or 10)
    limit = max(1, min(50, limit))
    if name == "shop_balances":
        data = _tool_shop_balances(db, user, min(limit, 30))
    elif name == "recent_invoices":
        data = _tool_recent_invoices(db, user, min(limit, 30))
    elif name == "invoices_by_date":
        days_back = args.get("days_back")
        data = _tool_invoices_by_date(
            db,
            user,
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
            days_back=int(days_back) if days_back is not None else None,
            payment_status=args.get("payment_status"),
            limit=limit,
        )
    elif name == "sales_summary":
        days_back = args.get("days_back")
        data = analytics.tool_sales_summary(
            db,
            user,
            preset=args.get("preset"),
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
            days_back=int(days_back) if days_back is not None else None,
        )
    elif name == "sales_compare":
        data = analytics.tool_sales_compare(
            db,
            user,
            preset_a=args.get("preset_a") or "this_month",
            preset_b=args.get("preset_b") or "last_month",
            date_from_a=args.get("date_from_a"),
            date_to_a=args.get("date_to_a"),
            date_from_b=args.get("date_from_b"),
            date_to_b=args.get("date_to_b"),
        )
    elif name == "sales_by_day":
        data = analytics.tool_sales_by_day(
            db,
            user,
            preset=args.get("preset") or "this_month",
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
        )
    elif name == "payments_summary":
        days_back = args.get("days_back")
        data = analytics.tool_payments_summary(
            db,
            user,
            preset=args.get("preset"),
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
            days_back=int(days_back) if days_back is not None else None,
        )
    elif name == "sales_by_area":
        min_sales = args.get("min_sales")
        data = analytics.tool_sales_by_area(
            db,
            user,
            preset=args.get("preset") or "this_month",
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
            sort_by=args.get("sort_by") or "total_sales",
            order=args.get("order") or "desc",
            limit=limit,
            min_sales=float(min_sales) if min_sales is not None else None,
            compare_prior=bool(args.get("compare_prior")),
        )
    elif name == "compare_areas":
        data = analytics.tool_compare_areas(
            db,
            user,
            area_a=str(args.get("area_a") or ""),
            area_b=str(args.get("area_b") or ""),
            preset=args.get("preset") or "this_month",
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
        )
    elif name == "shop_insights":
        data = analytics.tool_shop_insights(
            db,
            user,
            shop_name=str(args.get("shop_name") or ""),
            preset=args.get("preset") or "this_month",
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
            history_limit=int(args.get("history_limit") or 10),
        )
    elif name == "customer_rankings":
        data = analytics.tool_customer_rankings(
            db,
            user,
            preset=args.get("preset") or "this_month",
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
            mode=str(args.get("mode") or "top"),
            limit=limit,
        )
    elif name == "quiet_shops":
        include_never = args.get("include_never_ordered")
        data = _tool_quiet_shops(
            db,
            user,
            days_without_order=(
                int(args["days_without_order"])
                if args.get("days_without_order") is not None
                else None
            ),
            since_date=args.get("since_date"),
            include_never_ordered=False if include_never is None else bool(include_never),
            limit=limit,
        )
    elif name == "product_sales":
        unsold = args.get("unsold_days")
        data = analytics.tool_product_sales(
            db,
            user,
            preset=args.get("preset") or "this_month",
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
            sort_by=args.get("sort_by") or "quantity",
            order=args.get("order") or "desc",
            limit=limit,
            product_name=args.get("product_name"),
            city=args.get("city"),
            shop_name=args.get("shop_name"),
            unsold_days=int(unsold) if unsold is not None else None,
            compare_prior=bool(args.get("compare_prior")),
        )
    elif name == "rep_performance":
        data = analytics.tool_rep_performance(
            db,
            user,
            preset=args.get("preset") or "this_month",
            date_from=args.get("date_from"),
            date_to=args.get("date_to"),
            salesperson_name=args.get("salesperson_name"),
            compare_prior=bool(args.get("compare_prior")),
            limit=limit,
        )
    elif name == "focus_recommendations":
        data = analytics.tool_focus_recommendations(db, user, limit=min(limit, 20))
    elif name == "low_stock":
        data = _tool_low_stock(db, min(limit, 30))
    elif name == "top_products":
        data = _tool_top_products(db, user, min(limit, 30))
    else:
        data = {"error": f"unknown tool {name}"}
    return json.dumps(data, default=str)


@router.post("/chat", response_model=AiChatResponse)
def ai_chat(
    payload: AiChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> AiChatResponse:
    client, model = require_openai_client()
    history = payload.messages[-12:]
    today = _business_now().date().isoformat()
    messages: list[dict] = [
        {
            "role": "system",
            "content": (
                "You are the MR FOG Sales assistant inside the company app. "
                "Answer briefly for mobile. Only use numbers from tool results — never invent "
                "balances, stock, invoice totals, shop lists, area rankings, or rep stats. "
                "If tools return empty/note, say so clearly. "
                f"Business timezone is America/Chicago. Today is {today}. "
                "Area means shop city. Salesperson means invoice created_by user. "
                "Tool routing: "
                "sales totals/AOV → sales_summary; MoM/trend compare → sales_compare; "
                "best/worst day → sales_by_day; invoice line list for a date → invoices_by_date; "
                "collections/outstanding → payments_summary; "
                "areas/cities rankings → sales_by_area; two cities → compare_areas; "
                "one shop → shop_insights; top/increased/reduced customers → customer_rankings; "
                "quiet/churned shops → quiet_shops (default churned only; include_never_ordered only if asked); "
                "products by period/city/shop → product_sales; salespeople → rep_performance; "
                "which areas to focus on → focus_recommendations; "
                "unpaid shop list → shop_balances; low stock → low_stock. "
                "Prefer calling tools before answering factual questions."
            ),
        }
    ]
    for m in history:
        role = (m.role or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        content = (m.content or "").strip()
        if not content:
            continue
        messages.append({"role": role, "content": content[:2000]})

    if len(messages) < 2:
        raise HTTPException(status_code=400, detail="Send at least one user message")

    # Tool loop (max 3 rounds)
    for _ in range(3):
        completion = client.chat.completions.create(
            model=model,
            temperature=0.2,
            messages=messages,
            tools=CHAT_TOOLS,
            tool_choice="auto",
        )
        msg = completion.choices[0].message
        tool_calls = msg.tool_calls or []
        if not tool_calls:
            reply = (msg.content or "").strip() or "I could not generate a reply."
            return AiChatResponse(reply=reply)

        messages.append(
            {
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments or "{}",
                        },
                    }
                    for tc in tool_calls
                ],
            }
        )
        for tc in tool_calls:
            try:
                args = json.loads(tc.function.arguments or "{}")
            except json.JSONDecodeError:
                args = {}
            result = _run_tool(tc.function.name, args if isinstance(args, dict) else {}, db, current_user)
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result[:8000],
                }
            )

    # Final pass without tools if still looping
    completion = client.chat.completions.create(
        model=model,
        temperature=0.2,
        messages=messages,
    )
    reply = (completion.choices[0].message.content or "").strip() or "I could not generate a reply."
    return AiChatResponse(reply=reply)
