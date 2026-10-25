"""Add Lovable products that are not already in this app.

Matches an existing product when the full name or the flavor after the code
(AU02 - Cherry Kiss -> Cherry Kiss) already exists. Does not change stock on
existing products. New products are inserted with stock 0 because the old app
quantities include negatives from overselling.
Also relinks placeholder invoice lines whose name matches a new product.
"""
from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / "migration-export"
LOV_PRODUCTS = EXPORT / "products.csv"
PROD_PRODUCTS = EXPORT / "prod_products_full.csv"
LOV_ITEMS = EXPORT / "invoice_items.csv"
SQL_OUT = EXPORT / "products_import.sql"
PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000001"


def norm(s: str | None) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s]", "", s)
    return s


def split_code(name: str | None) -> tuple[str | None, str]:
    name = (name or "").strip()
    m = re.match(r"^([A-Za-z0-9]+)\s*[-–]\s*(.+)$", name)
    if m:
        return m.group(1).upper(), m.group(2).strip()
    return None, name


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def sql_str(v) -> str:
    if v is None or str(v).strip() == "":
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def sql_uuid(v: str) -> str:
    return sql_str(v) + "::uuid"


def sql_num(v) -> str:
    if v is None or str(v).strip() == "":
        return "0"
    return str(float(v))


def sql_int(v) -> str:
    if v is None or str(v).strip() == "":
        return "10"
    return str(int(float(v)))


def sql_bool(v: str | None) -> str:
    return "true" if str(v or "").strip().lower() in ("t", "true", "1", "yes") else "false"


def sql_ts(v: str | None) -> str:
    if not v:
        return "now()"
    return sql_str(v) + "::timestamptz"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    lov = read_csv(LOV_PRODUCTS)
    prod = read_csv(PROD_PRODUCTS)
    items = read_csv(LOV_ITEMS)
    prod_names = {norm(r["name"]) for r in prod}
    prod_ids = {r["id"] for r in prod}

    missing: list[dict] = []
    seen: set[str] = set()
    skipped_placeholder = 0
    matched = 0
    for r in lov:
        name = (r.get("name") or "").strip()
        if not name or name.startswith("_placeholder"):
            skipped_placeholder += 1
            continue
        code, flavor = split_code(name)
        if norm(name) in prod_names or norm(flavor) in prod_names:
            matched += 1
            continue
        key = norm(name)
        if key in seen:
            continue
        seen.add(key)
        r = dict(r)
        r["_code"] = code or ""
        missing.append(r)

    # Relink placeholder lines to a new product when the line name matches.
    by_name = {norm(r["name"]): r for r in missing}
    relink = 0
    for it in items:
        if norm(it.get("product_name")) in by_name:
            relink += 1

    sql = ["BEGIN;"]
    for r in missing:
        if r["id"] in prod_ids:
            continue
        sql.append(
            f"""
INSERT INTO products (
  id, name, category, subcategory, sub_subcategory, price,
  stock_quantity, stock_quantity_b, low_stock_threshold, is_active, created_at, updated_at
) VALUES (
  {sql_uuid(r['id'])},
  {sql_str(r['name'])},
  {sql_str(r.get('category') or 'General')},
  {sql_str(r.get('subcategory'))},
  {sql_str(r.get('sub_subcategory'))},
  {sql_num(r.get('price'))},
  0,
  0,
  {sql_int(r.get('low_stock_threshold') or 10)},
  {sql_bool(r.get('is_active'))},
  {sql_ts(r.get('created_at'))},
  {sql_ts(r.get('updated_at'))}
) ON CONFLICT (id) DO NOTHING;
""".strip()
        )
        sql.append(
            f"""
UPDATE invoice_items
SET product_id = {sql_uuid(r['id'])}
WHERE product_id = {sql_uuid(PLACEHOLDER_ID)}
  AND lower(trim(product_name)) = lower(trim({sql_str(r['name'])}));
""".strip()
        )

    sql.append("COMMIT;")

    print(f"Already in this app (name or flavor): {matched}")
    print(f"Skipped placeholder rows: {skipped_placeholder}")
    print(f"Products to add: {len(missing)}")
    print(f"Invoice lines that will link to a new product: {relink}")
    print("New products start at stock 0. Existing product stock is not changed.")
    if args.apply:
        SQL_OUT.write_text("\n".join(sql) + "\n", encoding="utf-8")
        print(f"Wrote {SQL_OUT}")
    else:
        print("Dry-run only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
