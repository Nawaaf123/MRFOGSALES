"""Capacity test: ~15 sales users creating invoices + related metrics.

Measures:
  - health / admin auth
  - ensure 15 sales accounts exist
  - concurrent sales logins
  - concurrent invoice creates (unique numbers)
  - concurrent sales page browses (dashboard/shops/products/invoices)
  - mixed browse + invoice write load
  - list endpoint latency (invoices, products, products brief)
  - map API burst (admin)

Usage:
  $env:SMOKE_BASE='http://3.231.131.90'
  $env:SMOKE_PASSWORD='...'
  $env:NUM_SALES='15'
  py -3 scripts/full_capacity_test.py
"""
from __future__ import annotations

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

BASE = os.environ.get("SMOKE_BASE", "http://3.231.131.90").rstrip("/")
API = f"{BASE}/api"
EMAIL = os.environ.get("SMOKE_EMAIL", "admin@example.com")
PASSWORD = os.environ.get("SMOKE_PASSWORD", "")
SALES_PASSWORD = os.environ.get("SALES_PASSWORD", "SalesTest123!")
NUM_SALES = int(os.environ.get("NUM_SALES", "15"))
TIMEOUT = httpx.Timeout(60.0)


def pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    idx = min(len(s) - 1, int(round((p / 100) * (len(s) - 1))))
    return s[idx]


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def summarize(label: str, lat_ms: list[float], errors: int, total: int) -> None:
    ok = total - errors
    print(
        f"{label}: OK {ok}/{total}  "
        f"p50={pct(lat_ms,50):.0f}ms p95={pct(lat_ms,95):.0f}ms "
        f"max={max(lat_ms) if lat_ms else 0:.0f}ms"
    )


def main() -> int:
    if not PASSWORD:
        print("Set SMOKE_PASSWORD", file=sys.stderr)
        return 2

    report: list[str] = []
    exit_bad = False

    with httpx.Client(timeout=TIMEOUT) as client:
        section(f"1) HEALTH + AUTH  (target {NUM_SALES} sales)")
        t0 = time.perf_counter()
        h = client.get(f"{BASE}/health")
        print(f"health: {h.status_code} {(time.perf_counter()-t0)*1000:.0f}ms {h.text.strip()}")
        if h.status_code != 200:
            return 1

        r = client.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
        if r.status_code != 200:
            print(f"admin login FAIL: {r.status_code} {r.text[:200]}")
            return 1
        admin_token = r.json()["access_token"]
        admin_h = {"Authorization": f"Bearer {admin_token}"}
        me = client.get(f"{API}/auth/me", headers=admin_h).json()
        print(f"admin login OK role={me.get('role')}")

        section("2) ENSURE SALES ACCOUNTS")
        shops = client.get(f"{API}/shops", headers=admin_h).json()
        products = client.get(f"{API}/products?active_only=true&brief=true", headers=admin_h).json()
        if not shops or not products:
            print("Need shops and products", file=sys.stderr)
            return 1
        shop = shops[0]
        product = products[0]
        price = float(product.get("price") or 1)
        print(f"shop={shop['name']} product={product.get('sku') or product['name']} price={price}")

        sales_accounts: list[dict] = []
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
            created = cr.status_code in (200, 201)
            exists = cr.status_code == 400 and "already" in cr.text.lower()
            if not created and not exists:
                print(f"  FAIL create {email}: {cr.status_code} {cr.text[:120]}")
                exit_bad = True
                continue
            lr = client.post(f"{API}/auth/login", json={"email": email, "password": SALES_PASSWORD})
            if lr.status_code != 200:
                print(f"  FAIL login {email}: {lr.status_code}")
                exit_bad = True
                continue
            sales_accounts.append(
                {
                    "email": email,
                    "token": lr.json()["access_token"],
                    "created": created,
                }
            )
            print(f"  OK {email} ({'new' if created else 'existing'})")

        n = len(sales_accounts)
        if n < NUM_SALES:
            report.append(f"Only {n}/{NUM_SALES} sales accounts ready")
            exit_bad = True
        else:
            report.append(f"{n} sales accounts ready")

        section("3) CONCURRENT SALES LOGINS")

        def sales_login(email: str) -> tuple[bool, float, str]:
            t1 = time.perf_counter()
            try:
                with httpx.Client(timeout=TIMEOUT) as c:
                    resp = c.post(
                        f"{API}/auth/login",
                        json={"email": email, "password": SALES_PASSWORD},
                    )
                ms = (time.perf_counter() - t1) * 1000
                if resp.status_code != 200:
                    return False, ms, f"{resp.status_code}"
                return True, ms, "ok"
            except Exception as exc:  # noqa: BLE001
                return False, (time.perf_counter() - t1) * 1000, str(exc)

        login_ms: list[float] = []
        login_err = 0
        with ThreadPoolExecutor(max_workers=n or 1) as pool:
            futs = {
                pool.submit(sales_login, a["email"]): a["email"] for a in sales_accounts
            }
            for fut in as_completed(futs):
                ok, ms, detail = fut.result()
                login_ms.append(ms)
                if not ok:
                    login_err += 1
                    print(f"  FAIL {futs[fut]}: {detail}")
        summarize(f"{n} concurrent logins", login_ms, login_err, n)
        report.append(f"Concurrent logins: {n - login_err}/{n}")
        if login_err:
            exit_bad = True

        section(f"4) CONCURRENT INVOICE CREATES ({n} sales at once)")

        def create_invoice(acct: dict) -> tuple[bool, float, str]:
            headers = {"Authorization": f"Bearer {acct['token']}"}
            body = {
                "shop_id": shop["id"],
                "warehouse": "A",
                "discount_amount": 0,
                "notes": f"capacity-15 {acct['email']}",
                "items": [
                    {
                        "product_id": product["id"],
                        "product_name": product["name"],
                        "quantity": 1,
                        "unit_price": price,
                        "subtotal": price,
                    }
                ],
                "payments": [],
            }
            t1 = time.perf_counter()
            try:
                with httpx.Client(timeout=TIMEOUT) as c:
                    resp = c.post(f"{API}/invoices", headers=headers, json=body)
                ms = (time.perf_counter() - t1) * 1000
                if resp.status_code >= 400:
                    return False, ms, f"{resp.status_code} {resp.text[:120]}"
                return True, ms, resp.json().get("invoice_number", "?")
            except Exception as exc:  # noqa: BLE001
                return False, (time.perf_counter() - t1) * 1000, str(exc)

        inv_ms: list[float] = []
        inv_nums: list[str] = []
        inv_err = 0
        wall0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=n or 1) as pool:
            futs = [pool.submit(create_invoice, a) for a in sales_accounts]
            for fut in as_completed(futs):
                ok, ms, detail = fut.result()
                inv_ms.append(ms)
                if ok:
                    inv_nums.append(detail)
                else:
                    inv_err += 1
                    print(f"  FAIL invoice: {detail}")
        wall = (time.perf_counter() - wall0) * 1000
        dupes = len(inv_nums) - len(set(inv_nums))
        summarize(f"{n} concurrent invoice creates", inv_ms, inv_err, n)
        print(
            f"  wall={wall:.0f}ms unique_invoice_numbers={len(set(inv_nums))} dupes={dupes}"
        )
        report.append(
            f"Concurrent invoices: {n - inv_err}/{n}, dupes={dupes}, wall={wall:.0f}ms"
        )
        if inv_err or dupes:
            exit_bad = True

        section("5) CONCURRENT SALES PAGE BROWSE (15 users × 5 pages)")

        def sales_browse(token: str) -> tuple[bool, float, str]:
            headers = {"Authorization": f"Bearer {token}"}
            paths = [
                "/dashboard/stats",
                "/dashboard/pending-payments",
                "/shops",
                "/products?active_only=true&brief=true",
                "/invoices",
            ]
            t1 = time.perf_counter()
            try:
                with httpx.Client(timeout=TIMEOUT) as c:
                    for path in paths:
                        resp = c.get(f"{API}{path}", headers=headers)
                        if resp.status_code >= 400:
                            return (
                                False,
                                (time.perf_counter() - t1) * 1000,
                                f"{path}->{resp.status_code}",
                            )
                return True, (time.perf_counter() - t1) * 1000, "ok"
            except Exception as exc:  # noqa: BLE001
                return False, (time.perf_counter() - t1) * 1000, str(exc)

        browse_ms: list[float] = []
        browse_err = 0
        wall0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=n or 1) as pool:
            futs = [pool.submit(sales_browse, a["token"]) for a in sales_accounts]
            for fut in as_completed(futs):
                ok, ms, detail = fut.result()
                browse_ms.append(ms)
                if not ok:
                    browse_err += 1
                    print(f"  FAIL browse: {detail}")
        wall = (time.perf_counter() - wall0) * 1000
        summarize(f"{n} concurrent sales browses", browse_ms, browse_err, n)
        print(f"  wall={wall:.0f}ms (each browse = 5 GETs)")
        report.append(f"Sales page browse: {n - browse_err}/{n}")
        if browse_err:
            exit_bad = True

        section("6) MIXED LOAD (15 browses + 15 invoice creates together)")

        def mixed(kind: str, acct: dict) -> tuple[str, bool, float, str]:
            if kind == "browse":
                ok, ms, detail = sales_browse(acct["token"])
                return kind, ok, ms, detail
            ok, ms, detail = create_invoice(acct)
            return kind, ok, ms, detail

        jobs = [("browse", a) for a in sales_accounts] + [
            ("write", a) for a in sales_accounts
        ]
        mix_err = 0
        mix_ms: list[float] = []
        wall0 = time.perf_counter()
        with ThreadPoolExecutor(max_workers=min(30, len(jobs) or 1)) as pool:
            futs = [pool.submit(mixed, k, a) for k, a in jobs]
            for fut in as_completed(futs):
                kind, ok, ms, detail = fut.result()
                mix_ms.append(ms)
                if not ok:
                    mix_err += 1
                    print(f"  FAIL {kind}: {detail}")
        wall = (time.perf_counter() - wall0) * 1000
        summarize(f"mixed {len(jobs)} jobs", mix_ms, mix_err, len(jobs))
        print(f"  wall={wall:.0f}ms")
        report.append(f"Mixed browse+write: {len(jobs) - mix_err}/{len(jobs)}")
        if mix_err:
            exit_bad = True

        section("7) LIST ENDPOINT LATENCY (warm, sales token)")
        sales_h = {"Authorization": f"Bearer {sales_accounts[0]['token']}"}
        for path in [
            "/invoices",
            "/products",
            "/products?active_only=true&brief=true",
            "/shops",
            "/dashboard/stats",
            "/dashboard/pending-payments",
        ]:
            samples: list[float] = []
            bytes_n = 0
            for _ in range(5):
                t1 = time.perf_counter()
                resp = client.get(f"{API}{path}", headers=sales_h)
                samples.append((time.perf_counter() - t1) * 1000)
                bytes_n = len(resp.content)
                if resp.status_code >= 400:
                    print(f"  FAIL {path} {resp.status_code}")
                    exit_bad = True
                    break
            else:
                print(
                    f"  {path:42s}  {bytes_n/1024:6.1f}KB  "
                    f"p50={pct(samples,50):.0f}ms p95={pct(samples,95):.0f}ms"
                )

        section("8) MAP BURST (admin, 20 concurrent × 2)")

        def hit_map() -> tuple[bool, float]:
            t1 = time.perf_counter()
            try:
                with httpx.Client(timeout=TIMEOUT) as c:
                    resp = c.get(f"{API}/shops/map", headers=admin_h)
                return resp.status_code < 400, (time.perf_counter() - t1) * 1000
            except Exception:  # noqa: BLE001
                return False, (time.perf_counter() - t1) * 1000

        map_ms: list[float] = []
        map_err = 0
        with ThreadPoolExecutor(max_workers=20) as pool:
            for fut in as_completed([pool.submit(hit_map) for _ in range(40)]):
                ok, ms = fut.result()
                map_ms.append(ms)
                if not ok:
                    map_err += 1
        summarize("/shops/map 40 reqs", map_ms, map_err, 40)
        report.append(f"Map burst errors={map_err}/40")

        section("SUMMARY")
        for line in report:
            print(f"- {line}")
        print(
            f"\nHardware: single t3.small (2 vCPU / 2GB) — API + Postgres + nginx."
            f"\nPass criteria for {NUM_SALES} sales: 0 login/invoice failures, 0 invoice# dupes,"
            f" browse p95 ideally < 3s under concurrent load."
        )
        return 1 if exit_bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
