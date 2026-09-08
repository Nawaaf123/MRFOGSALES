"""Migrate Lovable invoices/items/payments into production Postgres.

Dry-run by default. Pass --apply to write SQL file for import.
Does NOT change product stock.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
import uuid
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / "migration-export"

INV_FILE = EXPORT / "invoices (1).csv"
ITEMS_FILE = EXPORT / "invoice_items.csv"
PAY_FILE = EXPORT / "payments.csv"
LOVABLE_SHOPS = EXPORT / "shops.csv"
LOVABLE_PRODUCTS = EXPORT / "products.csv"
PROFILES = EXPORT / "profiles.csv"
PROD_SHOPS = EXPORT / "prod_shops.csv"
PROD_PRODUCTS = EXPORT / "prod_products.csv"
PROD_USERS = EXPORT / "prod_users.csv"

REPORT = EXPORT / "migration_report.txt"
SQL_OUT = EXPORT / "migration_import.sql"
UNMATCHED_SHOPS = EXPORT / "unmatched_shops.csv"
UNMATCHED_PRODUCTS = EXPORT / "unmatched_products.csv"


def norm_name(s: str | None) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s]", "", s)
    return s


def norm_sku(s: str | None) -> str:
    s = (s or "").strip().upper()
    if s.endswith("-US"):
        s = s[:-3]
    return s


def code_from_name(name: str | None) -> str | None:
    """AU09 - Twist Watermelon -> AU09"""
    name = (name or "").strip()
    m = re.match(r"^([A-Za-z0-9]+)\s*[-–]", name)
    if m:
        return m.group(1).upper()
    return None


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def sql_str(v) -> str:
    if v is None:
        return "NULL"
    s = str(v)
    if s == "":
        return "NULL"
    return "'" + s.replace("'", "''") + "'"


def sql_ts(v: str | None) -> str:
    if not v:
        return "NULL"
    # '2026-07-29 22:14:34.546301+00' -> timestamptz
    return sql_str(v)


def sql_date(v: str | None) -> str:
    if not v:
        return "NULL"
    # payment_date may be timestamp; take date part
    return sql_str(v[:10])


def sql_num(v) -> str:
    if v is None or v == "":
        return "0"
    return str(float(v))


def sql_uuid(v: str | None) -> str:
    if not v:
        return "NULL"
    return sql_str(v)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Write SQL import file")
    args = ap.parse_args()

    invoices = read_csv(INV_FILE)
    items = read_csv(ITEMS_FILE)
    payments = read_csv(PAY_FILE)
    lov_shops = read_csv(LOVABLE_SHOPS)
    lov_products = {r["id"]: r for r in read_csv(LOVABLE_PRODUCTS)}
    profiles = {r["id"]: r for r in read_csv(PROFILES)}
    prod_shops = read_csv(PROD_SHOPS)
    prod_products = read_csv(PROD_PRODUCTS)
    prod_users = read_csv(PROD_USERS)

    # Shop maps: lovable id -> prod id
    prod_by_name: dict[str, list[dict]] = defaultdict(list)
    for s in prod_shops:
        prod_by_name[norm_name(s["name"])].append(s)

    lov_shop_by_id = {s["id"]: s for s in lov_shops}
    shop_map: dict[str, str] = {}
    shop_unmatched: list[dict] = []

    for s in lov_shops:
        key = norm_name(s["name"])
        cands = prod_by_name.get(key) or []
        if len(cands) == 1:
            shop_map[s["id"]] = cands[0]["id"]
            continue
        if len(cands) > 1:
            # prefer same city
            city = norm_name(s.get("city"))
            city_hits = [c for c in cands if norm_name(c.get("city")) == city]
            pick = city_hits[0] if city_hits else cands[0]
            shop_map[s["id"]] = pick["id"]
            continue
        shop_unmatched.append(s)

    # Product maps
    prod_by_name: dict[str, list[dict]] = defaultdict(list)
    prod_by_sku: dict[str, list[dict]] = defaultdict(list)
    prod_by_code: dict[str, list[dict]] = defaultdict(list)
    for p in prod_products:
        prod_by_name[norm_name(p["name"])].append(p)
        sku_n = norm_sku(p.get("sku"))
        if sku_n:
            prod_by_sku[sku_n].append(p)
        code = code_from_name(p.get("name")) or sku_n
        if code:
            prod_by_code[code].append(p)

    def match_product(lovable_product_id: str | None, product_name: str) -> str | None:
        # 1) name exact
        hits = prod_by_name.get(norm_name(product_name)) or []
        if len(hits) == 1:
            return hits[0]["id"]
        if len(hits) > 1:
            return hits[0]["id"]
        # 2) code from invoice line name
        code = code_from_name(product_name)
        if code:
            hits = prod_by_code.get(code) or prod_by_sku.get(code) or []
            if hits:
                return hits[0]["id"]
        # 3) lovable product row name
        lp = lov_products.get(lovable_product_id or "")
        if lp:
            hits = prod_by_name.get(norm_name(lp["name"])) or []
            if hits:
                return hits[0]["id"]
            code = code_from_name(lp["name"])
            if code:
                hits = prod_by_code.get(code) or prod_by_sku.get(code) or []
                if hits:
                    return hits[0]["id"]
        return None

    # User map by email
    user_by_email = {u["email"].strip().lower(): u["id"] for u in prod_users if u.get("email")}
    admin_id = None
    for u in prod_users:
        if (u.get("email") or "").lower() in ("admin@example.com", "nawaafmohd22@gmail.com"):
            admin_id = u["id"]
            break
    if not admin_id and prod_users:
        admin_id = prod_users[0]["id"]

    def map_user(lovable_user_id: str | None) -> str:
        if not lovable_user_id:
            return admin_id
        prof = profiles.get(lovable_user_id)
        if prof and prof.get("email"):
            hit = user_by_email.get(prof["email"].strip().lower())
            if hit:
                return hit
        # same UUID if already exists in prod
        for u in prod_users:
            if u["id"] == lovable_user_id:
                return lovable_user_id
        return admin_id

    items_by_inv: dict[str, list[dict]] = defaultdict(list)
    for it in items:
        items_by_inv[it["invoice_id"]].append(it)
    pays_by_inv: dict[str, list[dict]] = defaultdict(list)
    for p in payments:
        pays_by_inv[p["invoice_id"]].append(p)

    # Placeholder product for unmatched lines (created in SQL if needed)
    PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000001"

    inv_ok = 0
    inv_skip_shop = 0
    item_ok = 0
    item_placeholder = 0
    legacy_count = 0
    unmatched_product_names: dict[str, int] = defaultdict(int)
    skipped_invoices: list[str] = []

    sql_lines: list[str] = []
    sql_lines.append("BEGIN;")
    sql_lines.append(
        f"""
INSERT INTO products (id, name, category, price, stock_quantity, stock_quantity_b, low_stock_threshold, is_active, sku, barcode)
VALUES ({sql_uuid(PLACEHOLDER_ID)}, 'LEGACY UNMATCHED PRODUCT', 'LEGACY', 0, 0, 0, 0, false, 'LEGACY-UNMATCHED', NULL)
ON CONFLICT (id) DO NOTHING;
""".strip()
    )

    warehouse_ok = {"A", "B"}

    for inv in invoices:
        lov_shop_id = inv["shop_id"]
        prod_shop_id = shop_map.get(lov_shop_id)
        if not prod_shop_id:
            inv_skip_shop += 1
            skipped_invoices.append(inv.get("invoice_number") or inv["id"])
            continue

        notes = inv.get("notes") or ""
        if "[LEGACY BALANCE]" in notes.upper():
            legacy_count += 1

        created_by = map_user(inv.get("created_by"))
        wh = (inv.get("warehouse") or "").strip().upper()
        wh_sql = sql_str(wh) if wh in warehouse_ok else "NULL"
        status = (inv.get("payment_status") or "unpaid").strip().lower()
        if status not in ("paid", "partial", "unpaid"):
            status = "unpaid"

        sql_lines.append(
            f"""
INSERT INTO invoices (
  id, invoice_number, client_request_id, shop_id, created_by,
  total_amount, discount_amount, payment_status, notes, warehouse, created_at, updated_at
) VALUES (
  {sql_uuid(inv['id'])},
  {sql_str(inv['invoice_number'])},
  {sql_str('lovable:' + inv['id'])},
  {sql_uuid(prod_shop_id)},
  {sql_uuid(created_by)},
  {sql_num(inv.get('total_amount'))},
  {sql_num(inv.get('discount_amount') or 0)},
  {sql_str(status)}::payment_status,
  {sql_str(notes)},
  {wh_sql + '::warehouse_code' if wh in warehouse_ok else 'NULL'},
  {sql_ts(inv.get('created_at'))}::timestamptz,
  {sql_ts(inv.get('updated_at'))}::timestamptz
) ON CONFLICT (id) DO NOTHING;
""".strip()
        )
        inv_ok += 1

        for it in items_by_inv.get(inv["id"], []):
            pid = match_product(it.get("product_id"), it.get("product_name") or "")
            if not pid:
                pid = PLACEHOLDER_ID
                item_placeholder += 1
                unmatched_product_names[it.get("product_name") or "(blank)"] += 1
            else:
                item_ok += 1
            sql_lines.append(
                f"""
INSERT INTO invoice_items (
  id, invoice_id, product_id, product_name, quantity, unit_price, subtotal, created_at
) VALUES (
  {sql_uuid(it['id'])},
  {sql_uuid(inv['id'])},
  {sql_uuid(pid)},
  {sql_str(it.get('product_name'))},
  {int(float(it.get('quantity') or 1))},
  {sql_num(it.get('unit_price'))},
  {sql_num(it.get('subtotal'))},
  {sql_ts(it.get('created_at'))}::timestamptz
) ON CONFLICT (id) DO NOTHING;
""".strip()
            )

        for pay in pays_by_inv.get(inv["id"], []):
            method = (pay.get("payment_method") or "cash").strip().lower()
            if method not in ("cash", "check", "credit"):
                method = "cash"
            pay_user = map_user(pay.get("created_by"))
            sql_lines.append(
                f"""
INSERT INTO payments (
  id, invoice_id, amount, payment_method, payment_date, check_number, notes, created_by, created_at
) VALUES (
  {sql_uuid(pay['id'])},
  {sql_uuid(inv['id'])},
  {sql_num(pay.get('amount'))},
  {sql_str(method)}::payment_method,
  {sql_date(pay.get('payment_date'))}::date,
  {sql_str(pay.get('check_number'))},
  {sql_str(pay.get('notes'))},
  {sql_uuid(pay_user)},
  {sql_ts(pay.get('created_at'))}::timestamptz
) ON CONFLICT (id) DO NOTHING;
""".strip()
            )

    sql_lines.append("COMMIT;")

    # Report
    lines = []
    lines.append(f"Lovable invoices: {len(invoices)}")
    lines.append(f"Importable invoices (shop matched): {inv_ok}")
    lines.append(f"Skipped invoices (shop unmatched): {inv_skip_shop}")
    lines.append(f"Legacy balance invoices (among importable): {legacy_count}")
    lines.append(f"Line items matched to product: {item_ok}")
    lines.append(f"Line items using placeholder product: {item_placeholder}")
    lines.append(f"Payments rows: {len(payments)}")
    lines.append(f"Shop match: {len(shop_map)}/{len(lov_shops)} lovable shops mapped")
    lines.append(f"Unmatched lovable shops: {len(shop_unmatched)}")
    lines.append("")
    lines.append("Top unmatched product names:")
    for name, cnt in sorted(unmatched_product_names.items(), key=lambda x: -x[1])[:30]:
        lines.append(f"  {cnt:4d}  {name}")
    if skipped_invoices:
        lines.append("")
        lines.append(f"Sample skipped invoice numbers ({min(20, len(skipped_invoices))}):")
        for n in skipped_invoices[:20]:
            lines.append(f"  {n}")

    report = "\n".join(lines) + "\n"
    REPORT.write_text(report, encoding="utf-8")
    print(report)

    with UNMATCHED_SHOPS.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["id", "name", "city", "state"])
        w.writeheader()
        for s in shop_unmatched:
            w.writerow({k: s.get(k) for k in w.fieldnames})

    with UNMATCHED_PRODUCTS.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["product_name", "line_count"])
        for name, cnt in sorted(unmatched_product_names.items(), key=lambda x: -x[1]):
            w.writerow([name, cnt])

    if args.apply:
        SQL_OUT.write_text("\n".join(sql_lines) + "\n", encoding="utf-8")
        print(f"Wrote SQL: {SQL_OUT} ({SQL_OUT.stat().st_size} bytes)")
    else:
        print("Dry-run only. Re-run with --apply to write SQL.")

    # Fail dry-run if shop match is terrible
    if inv_ok == 0:
        print("ERROR: no invoices matched shops", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
