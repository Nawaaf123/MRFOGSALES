"""Import products from us_products_only.xlsx into the live API (upsert by SKU)."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("Install openpyxl first: py -3 -m pip install openpyxl", file=sys.stderr)
    raise SystemExit(1)


def api_json(url: str, method: str = "GET", token: str | None = None, body: dict | None = None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"{method} {url} -> HTTP {exc.code}: {detail}") from exc


def load_products(path: Path) -> list[dict]:
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(h).strip() if h is not None else "" for h in rows[0]]
    idx = {h: i for i, h in enumerate(headers)}

    def get(row, *names, default=None):
        for name in names:
            if name in idx:
                return row[idx[name]]
        return default

    products: list[dict] = []
    for row in rows[1:]:
        name = str(get(row, "Product Name", "Name") or "").strip()
        if not name:
            continue
        sku = str(get(row, "SKU", "Sku") or "").strip() or None
        category = str(get(row, "Category") or "").strip() or "General"
        subcategory = str(get(row, "Subcategory") or "").strip() or None
        try:
            price = float(get(row, "Price") or 0)
        except (TypeError, ValueError):
            price = 0.0
        try:
            min_stock = int(get(row, "Min Stock", "Low Stock") or 0)
        except (TypeError, ValueError):
            min_stock = 0
        products.append(
            {
                "name": name,
                "sku": sku,
                "category": category,
                "subcategory": subcategory,
                "sub_subcategory": None,
                "price": price,
                "stock_quantity": 0,
                "stock_quantity_b": 0,
                "low_stock_threshold": min_stock,
                "is_active": True,
            }
        )
    return products


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--file",
        default=r"c:\Users\nawaa\Desktop\us_products_only.xlsx",
        help="Path to Excel product export",
    )
    parser.add_argument("--base-url", default="http://3.231.131.90", help="App base URL")
    parser.add_argument("--email", default="admin@example.com")
    parser.add_argument("--password", required=True)
    parser.add_argument("--chunk-size", type=int, default=100)
    args = parser.parse_args()

    path = Path(args.file)
    products = load_products(path)
    print(f"Loaded {len(products)} products from {path}")
    if not products:
        raise SystemExit("No products found in file")

    base = args.base_url.rstrip("/")
    auth = api_json(
        f"{base}/api/auth/login",
        method="POST",
        body={"email": args.email, "password": args.password},
    )
    token = auth.get("access_token") or auth.get("token")
    if not token:
        raise SystemExit(f"Login response missing token: {auth}")

    created_total = 0
    updated_total = 0
    for i in range(0, len(products), args.chunk_size):
        chunk = products[i : i + args.chunk_size]
        result = api_json(
            f"{base}/api/bulk/products",
            method="POST",
            token=token,
            body={"products": chunk},
        )
        created_total += int(result.get("created") or 0)
        updated_total += int(result.get("updated") or 0)
        print(
            f"Chunk {i // args.chunk_size + 1}: "
            f"created={result.get('created')} updated={result.get('updated')}"
        )

    print(f"Done. created={created_total} updated={updated_total}")


if __name__ == "__main__":
    main()
