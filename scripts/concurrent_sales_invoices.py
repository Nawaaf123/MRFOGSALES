"""Create 10 sales accounts and concurrently create invoices.

Usage (from repo root, with admin password):
  $env:SMOKE_BASE='http://3.231.131.90'
  $env:SMOKE_PASSWORD='...'
  python scripts/concurrent_sales_invoices.py
"""
from __future__ import annotations

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

BASE = os.environ.get("SMOKE_BASE", "http://3.231.131.90").rstrip("/")
API = f"{BASE}/api"
ADMIN_EMAIL = os.environ.get("SMOKE_EMAIL", "admin@example.com")
ADMIN_PASSWORD = os.environ.get("SMOKE_PASSWORD", "")
SALES_PASSWORD = os.environ.get("SALES_PASSWORD", "SalesTest123!")
NUM_SALES = int(os.environ.get("NUM_SALES", "10"))


def main() -> int:
    if not ADMIN_PASSWORD:
        print("Set SMOKE_PASSWORD to the admin password", file=sys.stderr)
        return 2

    timeout = httpx.Timeout(60.0)
    results: list[dict] = []

    with httpx.Client(timeout=timeout) as client:
        r = client.post(
            f"{API}/auth/login",
            json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        )
        r.raise_for_status()
        admin_token = r.json()["access_token"]
        admin_h = {"Authorization": f"Bearer {admin_token}"}

        shops = client.get(f"{API}/shops", headers=admin_h).json()
        products = client.get(f"{API}/products?active_only=true", headers=admin_h).json()
        if not shops or not products:
            print("Need at least one shop and one active product", file=sys.stderr)
            return 1

        shop = shops[0]
        product = products[0]
        print(f"Shop: {shop['name']} ({shop['id']})")
        print(f"Product: {product['name']} @ ${product['price']} stockA={product.get('stock_quantity')}")

        accounts: list[dict] = []
        print(f"\nCreating {NUM_SALES} sales accounts...")
        for i in range(1, NUM_SALES + 1):
            email = f"sales.concurrent.{i:02d}@example.com"
            payload = {
                "email": email,
                "password": SALES_PASSWORD,
                "full_name": f"Sales Concurrent {i:02d}",
                "role": "sales",
                "assigned_warehouse": "A" if i % 2 else "B",
            }
            created = False
            cr = client.post(f"{API}/users", headers=admin_h, json=payload)
            if cr.status_code in (200, 201):
                created = True
                user = cr.json()
            elif cr.status_code == 400 and "already" in cr.text.lower():
                # already exists — login later
                user = {"email": email, "id": None}
            else:
                print(f"  FAIL create {email}: {cr.status_code} {cr.text[:200]}")
                results.append(
                    {
                        "email": email,
                        "ok": False,
                        "phase": "create_user",
                        "detail": f"{cr.status_code} {cr.text[:120]}",
                        "ms": 0,
                    }
                )
                continue

            lr = client.post(
                f"{API}/auth/login",
                json={"email": email, "password": SALES_PASSWORD},
            )
            if lr.status_code != 200:
                print(f"  FAIL login {email}: {lr.status_code} {lr.text[:200]}")
                results.append(
                    {
                        "email": email,
                        "ok": False,
                        "phase": "login",
                        "detail": f"{lr.status_code} {lr.text[:120]}",
                        "ms": 0,
                    }
                )
                continue

            token = lr.json()["access_token"]
            accounts.append({"email": email, "token": token, "created": created})
            print(f"  OK {email} ({'new' if created else 'existing'})")

        if not accounts:
            print("No sales accounts available", file=sys.stderr)
            return 1

        print(f"\nConcurrent invoice create: {len(accounts)} sales users at once...")
        price = float(product["price"] or 10)
        qty = 1

        def create_invoice(acct: dict) -> dict:
            headers = {"Authorization": f"Bearer {acct['token']}"}
            body = {
                "shop_id": shop["id"],
                "items": [
                    {
                        "product_id": product["id"],
                        "product_name": product["name"],
                        "quantity": qty,
                        "unit_price": price,
                        "subtotal": price * qty,
                    }
                ],
                "discount_amount": 0,
                "notes": f"Concurrent test from {acct['email']}",
                "warehouse": "A",
                "payments": [],
            }
            t0 = time.perf_counter()
            try:
                with httpx.Client(timeout=timeout) as c:
                    resp = c.post(f"{API}/invoices", headers=headers, json=body)
                ms = (time.perf_counter() - t0) * 1000
                if resp.status_code >= 400:
                    return {
                        "email": acct["email"],
                        "ok": False,
                        "phase": "create_invoice",
                        "detail": f"{resp.status_code} {resp.text[:180]}",
                        "ms": ms,
                        "invoice": None,
                    }
                data = resp.json()
                return {
                    "email": acct["email"],
                    "ok": True,
                    "phase": "create_invoice",
                    "detail": "ok",
                    "ms": ms,
                    "invoice": data.get("invoice_number"),
                    "status": data.get("payment_status"),
                    "total": data.get("total_amount"),
                }
            except Exception as exc:  # noqa: BLE001
                ms = (time.perf_counter() - t0) * 1000
                return {
                    "email": acct["email"],
                    "ok": False,
                    "phase": "create_invoice",
                    "detail": str(exc),
                    "ms": ms,
                    "invoice": None,
                }

        t_wall0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=len(accounts)) as pool:
            futs = [pool.submit(create_invoice, a) for a in accounts]
            for fut in as_completed(futs):
                results.append(fut.result())
        wall_ms = (time.perf_counter() - t_wall0) * 1000

    invoice_results = [r for r in results if r.get("phase") == "create_invoice"]
    ok = [r for r in invoice_results if r["ok"]]
    bad = [r for r in invoice_results if not r["ok"]]
    latencies = sorted(r["ms"] for r in invoice_results)

    print("\n=== RESULTS ===")
    print(f"Sales accounts ready: {len(accounts)}")
    print(f"Invoices OK: {len(ok)} / {len(invoice_results)}")
    print(f"Invoices FAIL: {len(bad)}")
    print(f"Wall clock (all parallel): {wall_ms:.0f} ms")
    if latencies:
        print(
            f"Latency ms min/avg/max: "
            f"{min(latencies):.0f} / {sum(latencies)/len(latencies):.0f} / {max(latencies):.0f}"
        )

    print("\nCreated invoices:")
    for r in sorted(ok, key=lambda x: x["email"]):
        print(f"  {r['email']}: {r['invoice']} ${r.get('total')} ({r['ms']:.0f} ms)")

    if bad:
        print("\nFailures:")
        for r in bad:
            print(f"  {r['email']} [{r['phase']}]: {r['detail']}")

    # Glitch checks
    print("\n=== GLITCH CHECK ===")
    numbers = [r["invoice"] for r in ok if r.get("invoice")]
    dupes = len(numbers) - len(set(numbers))
    if dupes:
        print(f"BUG: duplicate invoice numbers ({dupes} extras) -> {numbers}")
    else:
        print("Invoice numbers: all unique")

    if len(ok) == len(accounts):
        print("Concurrency: all sales users created an invoice successfully")
    else:
        print("Concurrency: some invoice creates failed — see Failures above")

    return 0 if not bad else 1


if __name__ == "__main__":
    raise SystemExit(main())
