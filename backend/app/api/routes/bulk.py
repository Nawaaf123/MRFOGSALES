from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models import AppRole, Product, Shop, User
from app.schemas import ProductCreate, ShopCreate
from app.services.geocode import apply_geocode_if_needed

router = APIRouter(prefix="/bulk", tags=["bulk"])


class BulkProductsRequest(BaseModel):
    products: list[ProductCreate] = Field(min_length=1)


class BulkShopsRequest(BaseModel):
    shops: list[ShopCreate] = Field(min_length=1)
    geocode: bool = False


class BulkResult(BaseModel):
    created: int
    updated: int = 0
    geocoded: int = 0


@router.post("/products", response_model=BulkResult, status_code=status.HTTP_201_CREATED)
def bulk_create_products(
    payload: BulkProductsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> BulkResult:
    """Create products, or update existing rows when barcode or SKU already matches."""
    created = 0
    updated = 0
    for item in payload.products:
        data = item.model_dump()
        sku = (data.get("sku") or "").strip() or None
        barcode = (data.get("barcode") or "").strip() or None
        data["sku"] = sku
        data["barcode"] = barcode
        if data.get("name"):
            data["name"] = str(data["name"]).strip()

        existing = None
        if barcode:
            existing = db.query(Product).filter(Product.barcode == barcode).first()
        if existing is None and sku:
            existing = db.query(Product).filter(Product.sku == sku).first()

        if existing:
            for key, value in data.items():
                setattr(existing, key, value)
            updated += 1
        else:
            db.add(Product(**data))
            created += 1

    db.commit()
    return BulkResult(created=created, updated=updated)

@router.post("/shops", response_model=BulkResult, status_code=status.HTTP_201_CREATED)
def bulk_create_shops(
    payload: BulkShopsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin)),
) -> BulkResult:
    """
    Insert shops quickly. Geocoding 700+ rows in one request times out,
    so leave geocode=false (default) and call POST /shops/geocode-missing in batches.
    """
    rows: list[Shop] = []
    geocoded = 0
    for item in payload.shops:
        shop = Shop(**item.model_dump(), created_by=current_user.id)
        if payload.geocode and apply_geocode_if_needed(shop):
            geocoded += 1
        rows.append(shop)
    db.add_all(rows)
    db.commit()
    return BulkResult(created=len(rows), geocoded=geocoded)
