"""Remove the DISPOSABLE category added from the old app.

Duplicates of products already in NOVA, Elite, AURA, SWITCH-15000, or
SWITCH-5500 are deleted and invoice lines are pointed at the existing product.
Products that are not already there are moved into that category, with no
subcategory, matching how this app was arranged before.
"""
from __future__ import annotations

import argparse
import csv
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / "migration-export"
LOV = EXPORT / "products.csv"
PROD = EXPORT / "prod_products_full.csv"
SQL_OUT = EXPORT / "remove_disposable.sql"

TARGET = {
    "NOVA": "NOVA",
    "ELITE": "Elite",
    "AURA": "AURA",
    "SWITCH - 15000": "SWITCH-15000",
    "SWITCH - 5500": "SWITCH-5500",
}


def norm(s: str | None) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"[^\w\s]", "", s)
    return s


def flavor(name: str) -> str:
    name = (name or "").strip()
    m = re.match(r"^[A-Za-z0-9]+\s*[-–]\s*(.+)$", name)
    rest = m.group(1).strip() if m else name
    rest = re.sub(r"^US\s+", "", rest, flags=re.I)
    rest = rest.replace("Fanstastic", "Fantastic").replace("fanstastic", "fantastic")
    rest = rest.replace("Blur ", "Blue ").replace("BLUR ", "Blue ")
    return rest


def sql_uuid(v: str) -> str:
    return "'" + v.replace("'", "''") + "'::uuid"


def sql_str(v: str) -> str:
    return "'" + v.replace("'", "''") + "'"


def read_csv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    lov = read_csv(LOV)
    prod = read_csv(PROD)
    by_cat: dict[str, dict[str, dict]] = defaultdict(dict)
    for r in prod:
        by_cat[r.get("category") or ""][norm(r["name"])] = r

    prod_ids = {r["id"] for r in prod}
    seen: set[str] = set()
    deletes: list[tuple[dict, dict]] = []
    moves: list[tuple[dict, str]] = []
    for r in lov:
        name = (r.get("name") or "").strip()
        if not name or name.startswith("_placeholder"):
            continue
        if (r.get("category") or "") != "DISPOSABLE":
            continue
        key = norm(name)
        if key in seen:
            continue
        seen.add(key)
        target_cat = TARGET.get((r.get("subcategory") or "").strip())
        if not target_cat:
            print("SKIP no target", name)
            continue
        fl = norm(flavor(name))
        existing = by_cat.get(target_cat, {}).get(fl)
        if not existing and "elite display" in norm(name):
            for n, row in by_cat.get("Elite", {}).items():
                if n.startswith("elite display"):
                    existing = row
                    break
        if existing and r["id"] not in prod_ids:
            deletes.append((r, existing))
        elif r["id"] not in prod_ids:
            moves.append((r, target_cat))

    print(f"Delete as duplicates: {len(deletes)}")
    for src, dest in deletes:
        print(f"  {src['name']}  ->  {dest['category']} / {dest['name']}")
    print(f"Move into existing category: {len(moves)}")
    for src, cat in moves:
        print(f"  {src['name']}  ->  {cat}")

    sql = ["BEGIN;"]
    for src, dest in deletes:
        for table in ("invoice_items", "order_items"):
            sql.append(
                f"UPDATE {table} SET product_id = {sql_uuid(dest['id'])} "
                f"WHERE product_id = {sql_uuid(src['id'])};"
            )
        sql.append(f"DELETE FROM products WHERE id = {sql_uuid(src['id'])};")
    for src, cat in moves:
        sql.append(
            f"UPDATE products SET category = {sql_str(cat)}, subcategory = NULL, sub_subcategory = NULL "
            f"WHERE id = {sql_uuid(src['id'])} AND category = 'DISPOSABLE';"
        )
    sql.append("COMMIT;")
    if args.apply:
        SQL_OUT.write_text("\n".join(sql) + "\n", encoding="utf-8")
        print(f"Wrote {SQL_OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
