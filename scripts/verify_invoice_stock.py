"""Live DB check: create → edit → delete stock math (rolls back; leaves no data).

Run inside the API container:
  python /tmp/verify_invoice_stock.py
"""
from __future__ import annotations

import sys
from decimal import Decimal
from uuid import uuid4

from app.api.routes.invoices import adjust_stock
from app.db.session import SessionLocal
from app.models import Invoice, InvoiceItem, PaymentStatus, Product, Shop, User, WarehouseCode
from sqlalchemy.orm import joinedload


def stock_of(product: Product, warehouse: str) -> int:
    if warehouse == "B":
        return int(product.stock_quantity_b or 0)
    return int(product.stock_quantity or 0)


def main() -> int:
    db = SessionLocal()
    try:
        product = (
            db.query(Product)
            .filter(Product.is_active.is_(True))
            .order_by(Product.stock_quantity.desc())
            .first()
        )
        shop = db.query(Shop).filter(Shop.is_frozen.is_(False)).first()
        user = db.query(User).first()
        if not product or not shop or not user:
            print("FAIL: need at least one product, shop, and user")
            return 1

        warehouse = "A"
        start = stock_of(product, warehouse)
        if start < 20:
            # Prefer warehouse B if A is too low for a safe qty test
            if int(product.stock_quantity_b or 0) >= 20:
                warehouse = "B"
                start = stock_of(product, warehouse)
            else:
                print(f"FAIL: product {product.name} stock too low (A={product.stock_quantity}, B={product.stock_quantity_b})")
                return 1

        print(f"Product: {product.name} ({product.id})")
        print(f"Warehouse: {warehouse}  starting stock: {start}")

        # --- CREATE (qty 10) ---
        invoice = Invoice(
            invoice_number=f"TEST-{uuid4().hex[:8]}",
            shop_id=shop.id,
            created_by=user.id,
            total_amount=Decimal("100.00"),
            discount_amount=Decimal("0"),
            notes="[STOCK VERIFY] temporary — will roll back",
            warehouse=WarehouseCode.B if warehouse == "B" else WarehouseCode.A,
            payment_status=PaymentStatus.unpaid,
        )
        db.add(invoice)
        db.flush()
        db.add(
            InvoiceItem(
                invoice_id=invoice.id,
                product_id=product.id,
                product_name=product.name,
                quantity=10,
                unit_price=Decimal("10.00"),
                subtotal=Decimal("100.00"),
            )
        )
        adjust_stock(product, warehouse, 10, restore=False)
        db.flush()
        db.refresh(product)
        after_create = stock_of(product, warehouse)
        print(f"After create qty=10: {after_create} (expect {start - 10})")
        if after_create != start - 10:
            print("FAIL: create stock mismatch")
            return 1

        # --- EDIT (10 → 4) ---
        for old in list(invoice.items):
            adjust_stock(product, warehouse, int(old.quantity), restore=True)
            db.delete(old)
        db.flush()
        db.add(
            InvoiceItem(
                invoice_id=invoice.id,
                product_id=product.id,
                product_name=product.name,
                quantity=4,
                unit_price=Decimal("10.00"),
                subtotal=Decimal("40.00"),
            )
        )
        invoice.total_amount = Decimal("40.00")
        adjust_stock(product, warehouse, 4, restore=False)
        db.flush()
        db.refresh(product)
        after_edit = stock_of(product, warehouse)
        print(f"After edit qty=4: {after_edit} (expect {start - 4})")
        if after_edit != start - 4:
            print("FAIL: edit stock mismatch")
            return 1

        rows = (
            db.query(InvoiceItem)
            .filter(InvoiceItem.invoice_id == invoice.id)
            .all()
        )
        print(
            "DB line items after edit:",
            [(str(r.id), r.quantity) for r in rows],
        )

        # --- DELETE (restore remaining lines) — new session like a new API request ---
        invoice_id = invoice.id
        product_id = product.id
        db.flush()
        # Keep outer transaction; expire so next loads hit DB state
        db.expire_all()

        invoice = (
            db.query(Invoice)
            .options(joinedload(Invoice.items))
            .filter(Invoice.id == invoice_id)
            .one()
        )
        product = db.query(Product).filter(Product.id == product_id).with_for_update().one()
        print(
            "Loaded items for delete:",
            [(str(i.id), i.quantity) for i in (invoice.items or [])],
        )
        for item in list(invoice.items or []):
            adjust_stock(product, warehouse, int(item.quantity), restore=True)
        # Delete items explicitly first (avoids stale cascade), then invoice
        for item in list(invoice.items or []):
            db.delete(item)
        db.flush()
        db.delete(invoice)
        db.flush()
        db.refresh(product)
        after_delete = stock_of(product, warehouse)
        print(f"After delete: {after_delete} (expect {start})")
        if after_delete != start:
            print("FAIL: delete did not fully restore stock")
            return 1

        print("PASS: create / edit / delete all adjust stock correctly")

        # --- OVERSELL must be rejected ---
        from fastapi import HTTPException

        db.expire_all()
        product = db.query(Product).filter(Product.id == product_id).with_for_update().one()
        have = stock_of(product, warehouse)
        try:
            adjust_stock(product, warehouse, have + 1, restore=False)
            print("FAIL: oversell was allowed")
            return 1
        except HTTPException as exc:
            if exc.status_code != 400:
                print(f"FAIL: expected 400 on oversell, got {exc.status_code}")
                return 1
            print(f"PASS: oversell rejected ({exc.detail})")

        return 0
    finally:
        db.rollback()
        db.close()
        print("Rolled back — no data left in DB")


if __name__ == "__main__":
    sys.exit(main())
