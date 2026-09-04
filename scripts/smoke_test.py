"""Local smoke test: auth -> shop -> product -> invoice -> payment -> get invoice."""
from __future__ import annotations

import os
import sys
from datetime import date

import httpx

BASE = os.environ.get("SMOKE_BASE", "http://127.0.0.1:8000").rstrip("/")
API = f"{BASE}/api"
ADMIN_EMAIL = os.environ.get("SMOKE_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("SMOKE_PASSWORD", "ChangeMe123!")
failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"PASS  {name}")
    else:
        msg = f"FAIL  {name}" + (f" — {detail}" if detail else "")
        print(msg)
        failures.append(msg)


def main() -> int:
    client = httpx.Client(timeout=30.0)

    # Health
    r = client.get(f"{BASE}/health")
    check("health", r.status_code == 200 and r.json().get("status") == "ok", r.text)

    # Login (seed admin)
    r = client.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    if r.status_code != 200:
        # try signup if seed missing
        r2 = client.post(
            f"{API}/auth/signup",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "full_name": "Admin"},
        )
        check("signup fallback", r2.status_code in (200, 201), r2.text)
        r = client.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    check("login", r.status_code == 200, r.text)
    if r.status_code != 200:
        return 1
    token = r.json()["access_token"]
    user = r.json()["user"]
    check("login returns admin role", user.get("role") == "admin", str(user))
    headers = {"Authorization": f"Bearer {token}"}

    # Me
    r = client.get(f"{API}/auth/me", headers=headers)
    check("auth/me", r.status_code == 200, r.text)

    # Shop
    shop_name = f"Smoke Shop {date.today().isoformat()}"
    r = client.post(
        f"{API}/shops",
        headers=headers,
        json={
            "name": shop_name,
            "owner_name": "Test Owner",
            "phone": "555-0100",
            "city": "Dallas",
            "state": "TX",
            "email": "shop@example.com",
        },
    )
    check("create shop", r.status_code == 201, r.text)
    shop = r.json()
    shop_id = shop["id"]

    # Product
    r = client.post(
        f"{API}/products",
        headers=headers,
        json={
            "name": "Smoke Product",
            "category": "Test",
            "price": 12.5,
            "stock_quantity": 100,
            "stock_quantity_b": 50,
            "low_stock_threshold": 10,
        },
    )
    check("create product", r.status_code == 201, r.text)
    product = r.json()
    product_id = product["id"]

    # Invoice with payment
    r = client.post(
        f"{API}/invoices",
        headers=headers,
        json={
            "shop_id": shop_id,
            "warehouse": "A",
            "discount_amount": 2.5,
            "notes": "smoke test invoice",
            "items": [
                {
                    "product_id": product_id,
                    "product_name": "Smoke Product",
                    "quantity": 4,
                    "unit_price": 12.5,
                    "subtotal": 50.0,
                }
            ],
            "payments": [
                {
                    "amount": 20.0,
                    "payment_method": "cash",
                    "payment_date": date.today().isoformat(),
                }
            ],
        },
    )
    check("create invoice", r.status_code == 201, r.text)
    invoice = r.json()
    invoice_id = invoice["id"]
    check("invoice number present", bool(invoice.get("invoice_number")), str(invoice))
    check("invoice total 47.5", abs(float(invoice["total_amount"]) - 47.5) < 0.01, str(invoice.get("total_amount")))
    check("invoice partial after payment", invoice.get("payment_status") == "partial", str(invoice.get("payment_status")))
    check("amount_paid ~20", abs(float(invoice.get("amount_paid", 0)) - 20) < 0.01, str(invoice.get("amount_paid")))

    # Stock deducted
    r = client.get(f"{API}/products/{product_id}", headers=headers)
    check("get product after sale", r.status_code == 200, r.text)
    if r.status_code == 200:
        stock = r.json()["stock_quantity"]
        check("stock A reduced by 4", stock == 96, f"stock={stock}")

    # Additional payment / credit
    remaining = float(invoice["total_amount"]) - float(invoice.get("amount_paid", 0))
    r = client.post(
        f"{API}/payments",
        headers=headers,
        json={
            "invoice_id": invoice_id,
            "amount": remaining,
            "payment_method": "credit",
            "payment_date": date.today().isoformat(),
            "notes": "smoke credit",
        },
    )
    check("apply remaining credit", r.status_code == 201, r.text)

    r = client.get(f"{API}/invoices/{invoice_id}", headers=headers)
    check("get invoice detail", r.status_code == 200, r.text)
    if r.status_code == 200:
        detail = r.json()
        check("invoice paid", detail.get("payment_status") == "paid", str(detail.get("payment_status")))
        check("invoice has shop nested", detail.get("shop") is not None and detail["shop"].get("name") == shop_name)
        check("invoice has items", len(detail.get("items") or []) == 1)
        check("invoice has payments", len(detail.get("payments") or []) >= 2)

    # Legacy balance
    r = client.post(
        f"{API}/invoices/legacy-balance",
        headers=headers,
        json={"shop_id": shop_id, "amount": 75.0, "notes": "smoke legacy"},
    )
    check("legacy balance", r.status_code == 201, r.text)
    legacy = r.json() if r.status_code == 201 else {}
    check("legacy note tagged", "[LEGACY BALANCE]" in (legacy.get("notes") or ""), str(legacy.get("notes")))

    # Distribute payment across unpaid (legacy still unpaid)
    r = client.post(
        f"{API}/payments/distribute",
        headers=headers,
        json={
            "shop_id": shop_id,
            "amount": 30.0,
            "payment_method": "check",
            "check_number": "1001",
            "payment_date": date.today().isoformat(),
        },
    )
    check("distribute payment", r.status_code == 200, r.text)

    # Dashboard / analytics
    r = client.get(f"{API}/dashboard/stats", headers=headers)
    check("dashboard stats", r.status_code == 200 and r.json().get("shops_count", 0) >= 1, r.text)

    r = client.get(f"{API}/dashboard/pending-payments", headers=headers)
    check("pending payments", r.status_code == 200, r.text)

    r = client.get(f"{API}/dashboard/low-stock", headers=headers)
    check("low stock", r.status_code == 200, r.text)

    r = client.get(f"{API}/analytics/overview", headers=headers)
    check("analytics overview", r.status_code == 200 and r.json().get("invoice_count", 0) >= 1, r.text)

    r = client.get(f"{API}/analytics/top-products?limit=5", headers=headers)
    check("top products", r.status_code == 200, r.text)

    # List endpoints used by UI
    for path in ["/shops", "/products", "/invoices", "/orders", "/users"]:
        r = client.get(f"{API}{path}", headers=headers)
        check(f"list {path}", r.status_code == 200, r.text)

    # Email without Resend should 503 cleanly
    r = client.post(
        f"{API}/invoices/{invoice_id}/email",
        headers=headers,
        json={"to": "shop@example.com", "pdf_base64": "dGVzdA=="},
    )
    check("email without key returns 503", r.status_code == 503, r.text)

    print()
    if failures:
        print(f"{len(failures)} failure(s)")
        return 1
    print("All smoke checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
