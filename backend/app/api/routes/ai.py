"""OpenAI-backed helpers: suggest order + grounded sales chat."""
from __future__ import annotations

import json
from uuid import UUID

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

router = APIRouter(prefix="/ai", tags=["ai"])


def _role(user: User) -> AppRole:
    return user.role.role if user.role else AppRole.sales


def _scope_invoices(query, user: User):
    role = _role(user)
    if role not in (AppRole.admin, AppRole.srour):
        query = query.filter(Invoice.created_by == user.id)
    return query


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
    if _role(user) not in (AppRole.admin, AppRole.srour):
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
            "description": "List the most recent invoices (number, shop, total, payment status).",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}},
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
            "description": "Top products by quantity sold.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}},
            },
        },
    },
]


def _run_tool(name: str, args: dict, db: Session, user: User) -> str:
    limit = int(args.get("limit") or 10)
    limit = max(1, min(30, limit))
    if name == "shop_balances":
        data = _tool_shop_balances(db, user, limit)
    elif name == "recent_invoices":
        data = _tool_recent_invoices(db, user, limit)
    elif name == "low_stock":
        data = _tool_low_stock(db, limit)
    elif name == "top_products":
        data = _tool_top_products(db, user, limit)
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
    messages: list[dict] = [
        {
            "role": "system",
            "content": (
                "You are the MR FOG Sales assistant inside the company app. "
                "Answer briefly for mobile. Only use numbers from tool results — never invent "
                "balances, stock, or invoice totals. If tools return empty, say you have no data. "
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
