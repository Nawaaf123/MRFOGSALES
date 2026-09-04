"""Simple concurrent load test against the deployed API.

Usage:
  set SMOKE_BASE=http://3.231.131.90
  set SMOKE_PASSWORD=...
  python scripts/load_test.py

Optional:
  SMOKE_EMAIL, LOAD_CONCURRENCY (default 20), LOAD_REQUESTS (default 200)
"""
from __future__ import annotations

import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import httpx

BASE = os.environ.get("SMOKE_BASE", "http://127.0.0.1:8000").rstrip("/")
API = f"{BASE}/api"
EMAIL = os.environ.get("SMOKE_EMAIL", "admin@example.com")
PASSWORD = os.environ.get("SMOKE_PASSWORD", "ChangeMe123!")
CONCURRENCY = int(os.environ.get("LOAD_CONCURRENCY", "20"))
TOTAL = int(os.environ.get("LOAD_REQUESTS", "200"))


def login(client: httpx.Client) -> str:
    r = client.post(f"{API}/auth/login", json={"email": EMAIL, "password": PASSWORD})
    r.raise_for_status()
    return r.json()["access_token"]


def one_user_flow(token: str) -> tuple[bool, float, str]:
    """Mimic a typical page load: dashboard + lists."""
    headers = {"Authorization": f"Bearer {token}"}
    started = time.perf_counter()
    try:
        with httpx.Client(timeout=30.0) as client:
            paths = [
                "/dashboard/stats",
                "/dashboard/pending-payments",
                "/shops",
                "/products",
                "/invoices",
                "/analytics/overview",
            ]
            for path in paths:
                r = client.get(f"{API}{path}", headers=headers)
                if r.status_code >= 400:
                    elapsed = time.perf_counter() - started
                    return False, elapsed, f"{path} -> {r.status_code}"
        return True, time.perf_counter() - started, "ok"
    except Exception as exc:  # noqa: BLE001
        return False, time.perf_counter() - started, str(exc)


def run_level(concurrency: int, total: int, token: str) -> dict:
    latencies: list[float] = []
    errors = 0
    error_samples: list[str] = []
    t0 = time.perf_counter()

    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [pool.submit(one_user_flow, token) for _ in range(total)]
        for fut in as_completed(futures):
            ok, elapsed, detail = fut.result()
            latencies.append(elapsed)
            if not ok:
                errors += 1
                if len(error_samples) < 5:
                    error_samples.append(detail)

    wall = time.perf_counter() - t0
    latencies.sort()

    def pct(p: float) -> float:
        if not latencies:
            return 0.0
        idx = min(len(latencies) - 1, int(round((p / 100) * (len(latencies) - 1))))
        return latencies[idx]

    return {
        "concurrency": concurrency,
        "total": total,
        "errors": errors,
        "error_rate": errors / total if total else 0,
        "wall_s": wall,
        "rps": total / wall if wall else 0,
        "p50": pct(50),
        "p95": pct(95),
        "p99": pct(99),
        "avg": statistics.mean(latencies) if latencies else 0,
        "error_samples": error_samples,
    }


def main() -> int:
    print(f"Target: {BASE}")
    print(f"Warmup login...")
    with httpx.Client(timeout=30.0) as client:
        health = client.get(f"{BASE}/health")
        if health.status_code != 200:
            print(f"Health failed: {health.status_code} {health.text}")
            return 1
        token = login(client)

    # Ramp: 5 -> 10 -> 20 -> 40 (or up to requested concurrency)
    levels = []
    for c in (5, 10, 20, 40, 60):
        if c <= max(CONCURRENCY, 20):
            levels.append(c)
    if CONCURRENCY not in levels:
        levels.append(CONCURRENCY)
    levels = sorted(set(levels))

    print()
    print(f"{'conc':>5}  {'reqs':>5}  {'err%':>6}  {'rps':>7}  {'p50':>6}  {'p95':>6}  {'p99':>6}")
    print("-" * 55)

    worst_ok = 0
    for conc in levels:
        # fewer total at high concurrency to keep the run short
        total = max(TOTAL // 2, conc * 5) if conc >= 40 else TOTAL
        result = run_level(conc, total, token)
        err_pct = result["error_rate"] * 100
        print(
            f"{result['concurrency']:5d}  {result['total']:5d}  {err_pct:5.1f}%  "
            f"{result['rps']:7.1f}  {result['p50']:5.2f}s  {result['p95']:5.2f}s  {result['p99']:5.2f}s"
        )
        if result["error_samples"]:
            print(f"       samples: {result['error_samples']}")
        if result["error_rate"] <= 0.01 and result["p95"] < 3.0:
            worst_ok = conc
        elif result["error_rate"] > 0.05 or result["p95"] >= 5.0:
            print(f"\nStopping ramp: server struggling at concurrency={conc}")
            break

    print()
    if worst_ok:
        print(
            f"Estimate: about {worst_ok} concurrent users look comfortable "
            f"(p95 < 3s, errors <= 1%) on this box for dashboard-style traffic."
        )
    else:
        print("Estimate: even low concurrency was slow/erroring — check instance health.")
    print("Note: each 'user' hits 6 API reads (dashboard-like). Writes/uploads are heavier.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
