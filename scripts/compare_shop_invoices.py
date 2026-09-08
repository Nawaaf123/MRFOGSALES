"""Compare Lovable export vs production shop invoice summaries."""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from pathlib import Path

export = Path(r"C:\Users\nawaa\Documents\MRFOGSALES\migration-export")


def norm_name(s: str | None) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s]", "", s)
    return s


shops = {r["id"]: r for r in csv.DictReader(open(export / "shops.csv", encoding="utf-8-sig"))}
invoices = list(csv.DictReader(open(export / "invoices (1).csv", encoding="utf-8-sig")))
payments = list(csv.DictReader(open(export / "payments.csv", encoding="utf-8-sig")))
prod = list(csv.DictReader(open(export / "prod_shop_invoice_summary.csv", encoding="utf-8-sig")))

paid_by_inv: dict[str, float] = defaultdict(float)
for p in payments:
    paid_by_inv[p["invoice_id"]] += float(p.get("amount") or 0)

lov: dict[str, dict] = defaultdict(
    lambda: {"name": "", "city": "", "invoice_count": 0, "total_sales": 0.0, "pending": 0.0}
)
for inv in invoices:
    sid = inv["shop_id"]
    shop = shops.get(sid, {})
    bucket = lov[sid]
    bucket["name"] = shop.get("name") or sid
    bucket["city"] = shop.get("city") or ""
    total = float(inv.get("total_amount") or 0)
    paid = paid_by_inv.get(inv["id"], 0.0)
    pending = max(total - paid, 0.0)
    bucket["invoice_count"] += 1
    bucket["total_sales"] += total
    bucket["pending"] += pending

prod_by_name: dict[str, list] = defaultdict(list)
for r in prod:
    prod_by_name[norm_name(r["name"])].append(r)

rows = []
matched = 0
mismatch = 0
unmatched_lov = 0
for sid, L in lov.items():
    key = norm_name(L["name"])
    cands = prod_by_name.get(key) or []
    P = None
    if len(cands) == 1:
        P = cands[0]
    elif len(cands) > 1:
        city = norm_name(L["city"])
        city_hits = [c for c in cands if norm_name(c.get("city")) == city]
        P = city_hits[0] if city_hits else cands[0]
    if not P:
        unmatched_lov += 1
        rows.append(
            {
                "shop": L["name"],
                "city": L["city"],
                "status": "MISSING_IN_PROD",
                "lov_invoices": L["invoice_count"],
                "prod_invoices": 0,
                "delta_invoices": L["invoice_count"],
                "lov_total": round(L["total_sales"], 2),
                "prod_total": 0,
                "delta_total": round(L["total_sales"], 2),
                "lov_pending": round(L["pending"], 2),
                "prod_pending": 0,
                "delta_pending": round(L["pending"], 2),
            }
        )
        continue
    matched += 1
    pi = int(float(P["invoice_count"]))
    pt = round(float(P["total_sales"]), 2)
    pp = round(float(P["pending"]), 2)
    di = pi - L["invoice_count"]
    dt = round(pt - L["total_sales"], 2)
    dp = round(pp - L["pending"], 2)
    ok = di == 0 and abs(dt) < 0.02 and abs(dp) < 0.02
    if not ok:
        mismatch += 1
    rows.append(
        {
            "shop": L["name"],
            "city": L["city"],
            "status": "MATCH" if ok else "DIFF",
            "lov_invoices": L["invoice_count"],
            "prod_invoices": pi,
            "delta_invoices": di,
            "lov_total": round(L["total_sales"], 2),
            "prod_total": pt,
            "delta_total": dt,
            "lov_pending": round(L["pending"], 2),
            "prod_pending": pp,
            "delta_pending": dp,
        }
    )

lov_names = {norm_name(L["name"]) for L in lov.values()}
prod_only = [r for r in prod if norm_name(r["name"]) not in lov_names]

rows.sort(
    key=lambda r: (
        0 if r["status"] == "DIFF" else 1 if r["status"] == "MISSING_IN_PROD" else 2,
        -abs(r["delta_invoices"]),
        str(r["shop"]).lower(),
    )
)

out_csv = export / "shop_compare_lovable_vs_prod.csv"
with out_csv.open("w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
    w.writeheader()
    w.writerows(rows)

print(f"Lovable shops with invoices: {len(lov)}")
print(f"Prod shops with invoices: {len(prod)}")
print(f"Compared/matched by name: {matched}")
print(f"Exact matches: {matched - mismatch}")
print(f"Differences: {mismatch}")
print(f"Lovable shops missing in prod: {unmatched_lov}")
print(f"Prod-only shops (no lovable name match): {len(prod_only)}")
print(f"Sum lov invoices: {sum(L['invoice_count'] for L in lov.values())}")
print(f"Sum prod invoices: {sum(int(float(r['invoice_count'])) for r in prod)}")
print()
print("=== DIFF shops ===")
diffs = [r for r in rows if r["status"] == "DIFF"]
for r in diffs[:50]:
    print(
        f"{str(r['shop'])[:40]:40} inv L{r['lov_invoices']}->P{r['prod_invoices']} ({r['delta_invoices']:+d})  "
        f"total d={r['delta_total']:+.2f}  pend d={r['delta_pending']:+.2f}"
    )
if not diffs:
    print("(none)")
print()
print("=== MISSING IN PROD ===")
miss = [r for r in rows if r["status"] == "MISSING_IN_PROD"]
for r in miss[:20]:
    print(f"{r['shop']} | inv={r['lov_invoices']} total={r['lov_total']}")
if not miss:
    print("(none)")
print()
print(f"Wrote {out_csv}")
