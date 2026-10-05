"""Import Lovable shops/invoices/items/payments that are not already in production.

Does not change product stock. Does not create user accounts.
Existing invoices keep their current creator. New invoices are assigned by email.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / "migration-export"

LOV_INV = EXPORT / "invoices.csv"
LOV_ITEMS = EXPORT / "invoice_items.csv"
LOV_PAY = EXPORT / "payments.csv"
LOV_SHOPS = EXPORT / "shops.csv"
LOV_PRODUCTS = EXPORT / "products.csv"
PROFILES = EXPORT / "profiles.csv"
PROD_SHOPS = EXPORT / "prod_shops_live.csv"
PROD_INV = EXPORT / "prod_invoices_live.csv"
PROD_ITEMS = EXPORT / "prod_items_live.csv"
PROD_PAY = EXPORT / "prod_payments_live.csv"
PROD_USERS = EXPORT / "prod_users_live.csv"
PROD_PRODUCTS = EXPORT / "prod_products_live.csv"
if not PROD_PRODUCTS.exists():
    PROD_PRODUCTS = EXPORT / "prod_products.csv"

SQL_OUT = EXPORT / "delta_import.sql"
REPORT = EXPORT / "delta_report.txt"
PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000001"


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
    return sql_str(v) + "::timestamptz"


def sql_date(v: str | None) -> str:
    if not v:
        return "NULL"
    return sql_str(v[:10]) + "::date"


def sql_num(v) -> str:
    if v is None or v == "":
        return "0"
    return str(float(v))


def sql_uuid(v: str | None) -> str:
    if not v:
        return "NULL"
    return sql_str(v) + "::uuid"


def sql_bool(v: str | None) -> str:
    return "true" if str(v or "").strip().lower() in ("t", "true", "1", "yes") else "false"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Write the SQL file")
    args = ap.parse_args()

    lov_shops = read_csv(LOV_SHOPS)
    lov_inv = read_csv(LOV_INV)
    lov_items = read_csv(LOV_ITEMS)
    lov_pays = read_csv(LOV_PAY)
    lov_products = {r["id"]: r for r in read_csv(LOV_PRODUCTS)}
    profiles = {r["id"]: r for r in read_csv(PROFILES)}
    prod_shops = read_csv(PROD_SHOPS)
    prod_inv = read_csv(PROD_INV)
    prod_items = read_csv(PROD_ITEMS)
    prod_pays = read_csv(PROD_PAY)
    prod_users = read_csv(PROD_USERS)
    prod_products = read_csv(PROD_PRODUCTS)

    prod_by_name: dict[str, list[dict]] = defaultdict(list)
    for s in prod_shops:
        prod_by_name[norm_name(s["name"])].append(s)

    shop_map: dict[str, str] = {}
    new_shops: list[dict] = []
    for s in lov_shops:
        cands = prod_by_name.get(norm_name(s["name"])) or []
        if len(cands) == 1:
            shop_map[s["id"]] = cands[0]["id"]
        elif len(cands) > 1:
            city = norm_name(s.get("city"))
            city_hits = [c for c in cands if norm_name(c.get("city")) == city]
            shop_map[s["id"]] = (city_hits or cands)[0]["id"]
        else:
            shop_map[s["id"]] = s["id"]
            new_shops.append(s)

    prod_by_pname: dict[str, list[dict]] = defaultdict(list)
    prod_by_sku: dict[str, list[dict]] = defaultdict(list)
    prod_by_code: dict[str, list[dict]] = defaultdict(list)
    for p in prod_products:
        prod_by_pname[norm_name(p["name"])].append(p)
        sku_n = norm_sku(p.get("sku"))
        if sku_n:
            prod_by_sku[sku_n].append(p)
        code = code_from_name(p.get("name")) or sku_n
        if code:
            prod_by_code[code].append(p)

    def match_product(lovable_product_id: str | None, product_name: str) -> str | None:
        hits = prod_by_pname.get(norm_name(product_name)) or []
        if hits:
            return hits[0]["id"]
        code = code_from_name(product_name)
        if code:
            hits = prod_by_code.get(code) or prod_by_sku.get(code) or []
            if hits:
                return hits[0]["id"]
        lp = lov_products.get(lovable_product_id or "")
        if lp:
            hits = prod_by_pname.get(norm_name(lp.get("name"))) or []
            if hits:
                return hits[0]["id"]
            code = code_from_name(lp.get("name"))
            if code:
                hits = prod_by_code.get(code) or prod_by_sku.get(code) or []
                if hits:
                    return hits[0]["id"]
        return None

    user_by_email = {u["email"].strip().lower(): u["id"] for u in prod_users if u.get("email")}
    admin_id = None
    for u in prod_users:
        if (u.get("email") or "").lower() in ("admin@example.com", "nawaafmohd22@gmail.com"):
            admin_id = u["id"]
            if (u.get("email") or "").lower() == "admin@example.com":
                break
    if not admin_id:
        print("ERROR: no admin user in prod_users_live.csv", file=sys.stderr)
        return 2

    def map_user(lovable_user_id: str | None) -> str:
        prof = profiles.get(lovable_user_id or "")
        if prof and prof.get("email"):
            hit = user_by_email.get(prof["email"].strip().lower())
            if hit:
                return hit
        for u in prod_users:
            if u["id"] == lovable_user_id:
                return lovable_user_id
        return admin_id

    prod_inv_ids = {r["id"] for r in prod_inv}
    prod_item_ids = {r["id"] for r in prod_items}
    prod_pay_ids = {r["id"] for r in prod_pays}
    prod_inv_by_id = {r["id"]: r for r in prod_inv}
    prod_numbers = {r["invoice_number"]: r["id"] for r in prod_inv}

    new_inv = [r for r in lov_inv if r["id"] not in prod_inv_ids]
    collisions = [
        r
        for r in new_inv
        if r.get("invoice_number") in prod_numbers and prod_numbers[r["invoice_number"]] != r["id"]
    ]
    if collisions:
        print("ERROR: invoice number already used in this app:", file=sys.stderr)
        for r in collisions:
            print(f"  {r.get('invoice_number')} lovable={r['id']} prod={prod_numbers[r['invoice_number']]}", file=sys.stderr)
        return 2

    new_items = [r for r in lov_items if r["id"] not in prod_item_ids and r["invoice_id"] in {i["id"] for i in lov_inv}]
    new_pays = [r for r in lov_pays if r["id"] not in prod_pay_ids and r["invoice_id"] in {i["id"] for i in lov_inv}]

    updates = []
    for inv in lov_inv:
        cur = prod_inv_by_id.get(inv["id"])
        if not cur:
            continue
        status = (inv.get("payment_status") or "unpaid").strip().lower()
        if status not in ("paid", "partial", "unpaid"):
            status = "unpaid"
        total = float(inv.get("total_amount") or 0)
        discount = float(inv.get("discount_amount") or 0)
        cur_status = (cur.get("payment_status") or "").strip().lower()
        cur_total = float(cur.get("total_amount") or 0)
        changed = status != cur_status or abs(total - cur_total) > 0.009
        if changed:
            updates.append((inv, status, total, discount))

    unmatched_names: dict[str, int] = defaultdict(int)
    sql: list[str] = ["BEGIN;"]
    sql.append(
        f"""
INSERT INTO products (id, name, category, price, stock_quantity, stock_quantity_b, low_stock_threshold, is_active, sku, barcode)
VALUES ({sql_uuid(PLACEHOLDER_ID)}, 'LEGACY UNMATCHED PRODUCT', 'LEGACY', 0, 0, 0, 0, false, 'LEGACY-UNMATCHED', NULL)
ON CONFLICT (id) DO NOTHING;
""".strip()
    )

    for s in new_shops:
        sql.append(
            f"""
INSERT INTO shops (
  id, name, owner_name, email, phone, street_address, street_address_line_2,
  city, state, zip_code, is_frozen, created_by, created_at, updated_at
) VALUES (
  {sql_uuid(s['id'])},
  {sql_str(s.get('name'))},
  {sql_str(s.get('owner_name'))},
  {sql_str(s.get('email'))},
  {sql_str(s.get('phone'))},
  {sql_str(s.get('street_address'))},
  {sql_str(s.get('street_address_line_2'))},
  {sql_str(s.get('city'))},
  {sql_str(s.get('state'))},
  {sql_str(s.get('zip_code'))},
  {sql_bool(s.get('is_frozen'))},
  {sql_uuid(map_user(s.get('created_by')))},
  {sql_ts(s.get('created_at'))},
  {sql_ts(s.get('updated_at'))}
) ON CONFLICT (id) DO NOTHING;
""".strip()
        )

    warehouse_ok = {"A", "B"}
    creator_counts: dict[str, int] = defaultdict(int)
    for inv in new_inv:
        created_by = map_user(inv.get("created_by"))
        prof = profiles.get(inv.get("created_by") or "")
        creator_counts[(prof or {}).get("full_name") or "(none)", (prof or {}).get("email") or "", created_by] += 1
        wh = (inv.get("warehouse") or "").strip().upper()
        wh_sql = sql_str(wh) + "::warehouse_code" if wh in warehouse_ok else "NULL"
        status = (inv.get("payment_status") or "unpaid").strip().lower()
        if status not in ("paid", "partial", "unpaid"):
            status = "unpaid"
        sql.append(
            f"""
INSERT INTO invoices (
  id, invoice_number, client_request_id, shop_id, created_by,
  total_amount, discount_amount, payment_status, notes, warehouse, created_at, updated_at
) VALUES (
  {sql_uuid(inv['id'])},
  {sql_str(inv.get('invoice_number'))},
  {sql_str('lovable:' + inv['id'])},
  {sql_uuid(shop_map[inv['shop_id']])},
  {sql_uuid(created_by)},
  {sql_num(inv.get('total_amount'))},
  {sql_num(inv.get('discount_amount') or 0)},
  {sql_str(status)}::payment_status,
  {sql_str(inv.get('notes'))},
  {wh_sql},
  {sql_ts(inv.get('created_at'))},
  {sql_ts(inv.get('updated_at'))}
) ON CONFLICT (id) DO NOTHING;
""".strip()
        )

    placeholder_n = 0
    for it in new_items:
        pid = match_product(it.get("product_id"), it.get("product_name") or "")
        if not pid:
            pid = PLACEHOLDER_ID
            placeholder_n += 1
            unmatched_names[it.get("product_name") or "(blank)"] += 1
        sql.append(
            f"""
INSERT INTO invoice_items (
  id, invoice_id, product_id, product_name, quantity, unit_price, subtotal, created_at
) VALUES (
  {sql_uuid(it['id'])},
  {sql_uuid(it['invoice_id'])},
  {sql_uuid(pid)},
  {sql_str(it.get('product_name'))},
  {int(float(it.get('quantity') or 1))},
  {sql_num(it.get('unit_price'))},
  {sql_num(it.get('subtotal'))},
  {sql_ts(it.get('created_at'))}
) ON CONFLICT (id) DO NOTHING;
""".strip()
        )

    for pay in new_pays:
        method = (pay.get("payment_method") or "cash").strip().lower()
        if method not in ("cash", "check", "credit"):
            method = "cash"
        sql.append(
            f"""
INSERT INTO payments (
  id, invoice_id, amount, payment_method, payment_date, check_number, notes, created_by, created_at
) VALUES (
  {sql_uuid(pay['id'])},
  {sql_uuid(pay['invoice_id'])},
  {sql_num(pay.get('amount'))},
  {sql_str(method)}::payment_method,
  {sql_date(pay.get('payment_date'))},
  {sql_str(pay.get('check_number'))},
  {sql_str(pay.get('notes'))},
  {sql_uuid(map_user(pay.get('created_by')))},
  {sql_ts(pay.get('created_at'))}
) ON CONFLICT (id) DO NOTHING;
""".strip()
        )

    for inv, status, total, discount in updates:
        sql.append(
            f"""
UPDATE invoices SET
  payment_status = {sql_str(status)}::payment_status,
  total_amount = {sql_num(total)},
  discount_amount = {sql_num(discount)},
  updated_at = {sql_ts(inv.get('updated_at'))}
WHERE id = {sql_uuid(inv['id'])};
""".strip()
        )

    sql.append("COMMIT;")

    lines = [
        f"New shops: {len(new_shops)}",
        f"New invoices: {len(new_inv)}",
        f"New line items: {len(new_items)}",
        f"New payments: {len(new_pays)}",
        f"Existing invoices to update (status/total): {len(updates)}",
        f"Line items using placeholder product: {placeholder_n}",
        f"Product catalog used: {PROD_PRODUCTS.name}",
        "",
        "New invoice creators:",
    ]
    id_to_user = {u["id"]: u for u in prod_users}
    for (name, email, uid), n in sorted(creator_counts.items(), key=lambda x: -x[1]):
        dest = id_to_user.get(uid, {})
        lines.append(
            f"  {n:4d}  {name} <{email}> -> {dest.get('full_name')} <{dest.get('email')}>"
        )
    if unmatched_names:
        lines.append("")
        lines.append("Unmatched product names:")
        for name, cnt in sorted(unmatched_names.items(), key=lambda x: -x[1])[:20]:
            lines.append(f"  {cnt:4d}  {name}")
    report = "\n".join(lines) + "\n"
    REPORT.write_text(report, encoding="utf-8")
    print(report)
    if args.apply:
        SQL_OUT.write_text("\n".join(sql) + "\n", encoding="utf-8")
        print(f"Wrote {SQL_OUT} ({SQL_OUT.stat().st_size} bytes)")
    else:
        print("Dry-run only. Re-run with --apply to write SQL.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
