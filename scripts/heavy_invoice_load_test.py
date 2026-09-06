"""Heavy invoice load: 15 sales × N invoices × ≥50 line items each.

Usage:
  $env:SMOKE_BASE='http://3.231.131.90'
  $env:SMOKE_PASSWORD=(terraform -chdir=infra output -raw seed_admin_password)
  $env:NUM_SALES='15'
  $env:INVOICES_PER_SALES='3'
  $env:ITEMS_PER_INVOICE='50'
  $env:QTY_MIN='5'
  $env:QTY_MAX='25'
  py -3 scripts/heavy_invoice_load_test.py
"""
from __future__ import annotations

import os
import random
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

BASE = os.environ.get("SMOKE_BASE", "http://3.231.131.90").rstrip("/")
API = f"{BASE}/api"
EMAIL = os.environ.get("SMOKE_EMAIL", "admin@example.com")
PASSWORD = os.environ.get("SMOKE_PASSWORD", "")
SALES_PASSWORD = os.environ.get("SALES_PASSWORD", "SalesTest123!")
NUM_SALES = int(os.environ.get("NUM_SALES", "15"))
INVOICES_PER_SALES = int(os.environ.get("INVOICES_PER_SALES", "3"))
ITEMS_PER_INVOICE = int(os.environ.get("ITEMS_PER_INVOICE", "50"))
QTY_MIN = int(os.environ.get("QTY_MIN", "5"))
QTY_MAX = int(os.environ.get("QTY_MAX", "25"))
TIMEOUT = httpx.Timeout(180.0, connect=30.0)


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = min(len(s) - 1, int(round((p / 100) * (len(s) - 1))))
    return s[idx]


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def main() -> int:
    if not PASSWORD:
        print("Set SMOKE_PASSWORD", file=sys.stderr)
        return 2

    total_jobs = NUM_SALES * INVOICES_PER_SALES
    print(
        f"Target: {NUM_SALES} sales × {INVOICES_PER_SALES} invoices "
        f"× {ITEMS_PER_INVOICE}+ items (qty {QTY_MIN}-{QTY_MAX}) = {total_jobs} invoices"
    )

    with httpx.Client(timeout=TIMEOUT) as client:
        section("1) HEALTH + ADMIN")
        h = client.get(f"{BASE}/health")
        print(f"health: {h.status_code} {h.text.strip()}")
        if h.status_code != 200:
            return 1
        r = client.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
        if r.status_code != 200:
            print(f"admin login FAIL: {r.status_code} {r.text[:200]}")
            return 1
        admin_h = {"Authorization": f"Bearer {r.json()['access_token']}"}

        section("2) SHOPS + PRODUCTS")
        shops = client.get(f"{API}/shops?page=1&page_size=200", headers=admin_h).json()["items"]
        products = client.get(
            f"{API}/products?active_only=true&brief=true&page=1&page_size=200", headers=admin_h
        ).json()["items"]
        if len(shops) < 1:
            print("Need at least 1 shop", file=sys.stderr)
            return 1
        if len(products) < ITEMS_PER_INVOICE:
            print(
                f"Need ≥{ITEMS_PER_INVOICE} active products, have {len(products)}",
                file=sys.stderr,
            )
            return 1
        print(f"shops={len(shops)} products={len(products)}")

        section(f"3) ENSURE {NUM_SALES} SALES ACCOUNTS")
        sales: list[dict] = []
        for i in range(1, NUM_SALES + 1):
            email = f"sales.concurrent.{i:02d}@example.com"
            payload = {
                "email": email,
                "password": SALES_PASSWORD,
                "full_name": f"Sales Concurrent {i:02d}",
                "role": "sales",
                "assigned_warehouse": "A" if i % 2 else "B",
            }
            cr = client.post(f"{API}/users", headers=admin_h, json=payload)
            ok = cr.status_code in (200, 201) or (
                cr.status_code == 400 and "already" in cr.text.lower()
            )
            if not ok:
                print(f"  FAIL create {email}: {cr.status_code} {cr.text[:120]}")
                continue
            lr = client.post(f"{API}/auth/login", json={"email": email, "password": SALES_PASSWORD})
            if lr.status_code != 200:
                print(f"  FAIL login {email}: {lr.status_code}")
                continue
            sales.append({"email": email, "token": lr.json()["access_token"], "idx": i})
            print(f"  OK {email}")

        if len(sales) < NUM_SALES:
            print(f"Only {len(sales)}/{NUM_SALES} sales ready", file=sys.stderr)
            return 1

        section(
            f"4) CONCURRENT HEAVY CREATES "
            f"({len(sales)} sales × {INVOICES_PER_SALES} = {total_jobs})"
        )

        def build_items(seed: int) -> list[dict]:
            rng = random.Random(seed)
            picks = rng.sample(products, ITEMS_PER_INVOICE)
            items = []
            for p in picks:
                price = float(p.get("price") or 1.0) or 1.0
                qty = rng.randint(QTY_MIN, QTY_MAX)
                items.append(
                    {
                        "product_id": p["id"],
                        "product_name": p["name"],
                        "quantity": qty,
                        "unit_price": price,
                        "subtotal": round(price * qty, 2),
                    }
                )
            return items

        jobs: list[dict] = []
        for acct in sales:
            for n in range(INVOICES_PER_SALES):
                shop = shops[(acct["idx"] + n) % len(shops)]
                items = build_items(seed=acct["idx"] * 1000 + n)
                jobs.append(
                    {
                        "email": acct["email"],
                        "token": acct["token"],
                        "shop": shop,
                        "items": items,
                        "round": n + 1,
                        "client_request_id": str(uuid.uuid4()),
                    }
                )

        def create_one(job: dict) -> dict:
            headers = {"Authorization": f"Bearer {job['token']}"}
            total = sum(i["subtotal"] for i in job["items"])
            body = {
                "client_request_id": job["client_request_id"],
                "shop_id": job["shop"]["id"],
                "warehouse": "A",
                "discount_amount": 0,
                "notes": f"heavy-load {job['email']} r{job['round']} items={len(job['items'])}",
                "items": job["items"],
                "payments": [],
            }
            t0 = time.perf_counter()
            try:
                with httpx.Client(timeout=TIMEOUT) as c:
                    resp = c.post(f"{API}/invoices", headers=headers, json=body)
                ms = (time.perf_counter() - t0) * 1000
                if resp.status_code >= 400:
                    return {
                        "ok": False,
                        "ms": ms,
                        "email": job["email"],
                        "round": job["round"],
                        "items": len(job["items"]),
                        "detail": f"{resp.status_code} {resp.text[:160]}",
                    }
                data = resp.json()
                return {
                    "ok": True,
                    "ms": ms,
                    "email": job["email"],
                    "round": job["round"],
                    "items": len(job["items"]),
                    "qty_sum": sum(i["quantity"] for i in job["items"]),
                    "total": total,
                    "invoice_number": data.get("invoice_number"),
                    "id": data.get("id"),
                }
            except Exception as exc:  # noqa: BLE001
                return {
                    "ok": False,
                    "ms": (time.perf_counter() - t0) * 1000,
                    "email": job["email"],
                    "round": job["round"],
                    "items": len(job["items"]),
                    "detail": str(exc),
                }

        wall0 = time.perf_counter()
        results: list[dict] = []
        # All invoices fire together (worst-case concurrency)
        with ThreadPoolExecutor(max_workers=total_jobs) as pool:
            futs = [pool.submit(create_one, j) for j in jobs]
            for fut in as_completed(futs):
                results.append(fut.result())
        wall_ms = (time.perf_counter() - wall0) * 1000

        ok_rows = [r for r in results if r["ok"]]
        bad_rows = [r for r in results if not r["ok"]]
        lat = [r["ms"] for r in results]
        nums = [r["invoice_number"] for r in ok_rows]
        unique_nums = set(nums)

        print(
            f"creates: OK {len(ok_rows)}/{len(results)}  "
            f"p50={pct(lat,50):.0f}ms p95={pct(lat,95):.0f}ms "
            f"max={max(lat) if lat else 0:.0f}ms  wall={wall_ms:.0f}ms"
        )
        print(
            f"invoice numbers: unique={len(unique_nums)} "
            f"dupes={len(nums) - len(unique_nums)}"
        )
        if ok_rows:
            print(
                f"per invoice: items={ok_rows[0]['items']}  "
                f"avg_qty_units={sum(r['qty_sum'] for r in ok_rows)/len(ok_rows):.0f}  "
                f"avg_total=${sum(r['total'] for r in ok_rows)/len(ok_rows):.2f}"
            )
        for b in bad_rows[:10]:
            print(f"  FAIL {b['email']} r{b['round']}: {b.get('detail')}")

        section("5) IDEMPOTENT REPLAY (1 heavy invoice twice)")
        sample = jobs[0]
        headers = {"Authorization": f"Bearer {sample['token']}"}
        body = {
            "client_request_id": sample["client_request_id"],
            "shop_id": sample["shop"]["id"],
            "warehouse": "A",
            "discount_amount": 0,
            "notes": "heavy-load replay",
            "items": sample["items"],
            "payments": [],
        }
        r1 = client.post(f"{API}/invoices", headers=headers, json=body)
        r2 = client.post(f"{API}/invoices", headers=headers, json=body)
        same = (
            r1.status_code < 400
            and r2.status_code < 400
            and r1.json().get("id") == r2.json().get("id")
        )
        print(
            f"replay same id: {'PASS' if same else 'FAIL'} "
            f"({r1.status_code}/{r2.status_code}) "
            f"{r1.json().get('invoice_number') if r1.status_code < 400 else r1.text[:80]}"
        )

        section("SUMMARY")
        print(f"- Heavy invoices OK: {len(ok_rows)}/{total_jobs}")
        print(f"- Unique invoice #s: {len(unique_nums)} (dupes={len(nums)-len(unique_nums)})")
        print(f"- Wall time: {wall_ms/1000:.1f}s")
        print(f"- Idempotent replay: {'PASS' if same else 'FAIL'}")
        print(
            f"- Hardware: single t3.small — {ITEMS_PER_INVOICE} lines × qty "
            f"{QTY_MIN}-{QTY_MAX} under full concurrency"
        )

        return 0 if not bad_rows and same else 1


if __name__ == "__main__":
    raise SystemExit(main())
