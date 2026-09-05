from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import AppRole, Shop, User
from app.schemas import GeocodeMissingResult, ShopCreate, ShopOut, ShopUpdate
from app.services.geocode import apply_geocode_if_needed

router = APIRouter(prefix="/shops", tags=["shops"])

ADDRESS_FIELDS = {
    "street_address",
    "street_address_line_2",
    "city",
    "state",
    "zip_code",
}


@router.get("", response_model=list[ShopOut])
def list_shops(
    include_frozen: bool = Query(default=False),
    with_coords_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[Shop]:
    query = db.query(Shop).order_by(Shop.name.asc())
    if not include_frozen:
        query = query.filter(Shop.is_frozen.is_(False))
    if with_coords_only:
        query = query.filter(Shop.latitude.isnot(None), Shop.longitude.isnot(None))
    return query.all()


@router.get("/map", response_model=list[ShopOut])
def list_shops_for_map(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[Shop]:
    return (
        db.query(Shop)
        .filter(
            Shop.is_frozen.is_(False),
            Shop.latitude.isnot(None),
            Shop.longitude.isnot(None),
        )
        .order_by(Shop.name.asc())
        .all()
    )


@router.post("/geocode-missing", response_model=GeocodeMissingResult)
def geocode_missing_shops(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> GeocodeMissingResult:
    """Geocode a batch of shops missing coordinates. Call repeatedly until remaining=0."""
    shops = (
        db.query(Shop)
        .filter(or_(Shop.latitude.is_(None), Shop.longitude.is_(None)))
        .order_by(Shop.name.asc())
        .limit(limit)
        .all()
    )
    attempted = 0
    updated = 0
    skipped = 0
    errors: list[str] = []
    for shop in shops:
        attempted += 1
        try:
            if apply_geocode_if_needed(shop, force=True):
                updated += 1
            else:
                skipped += 1
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{shop.name}: {exc}")
    db.commit()
    remaining = (
        db.query(Shop)
        .filter(or_(Shop.latitude.is_(None), Shop.longitude.is_(None)))
        .count()
    )
    return GeocodeMissingResult(
        attempted=attempted,
        updated=updated,
        skipped=skipped,
        remaining=remaining,
        errors=errors[:20],
    )


@router.post("", response_model=ShopOut, status_code=status.HTTP_201_CREATED)
def create_shop(
    payload: ShopCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales)),
) -> Shop:
    shop = Shop(**payload.model_dump(), created_by=current_user.id)
    apply_geocode_if_needed(shop)
    db.add(shop)
    db.commit()
    db.refresh(shop)
    return shop


@router.get("/{shop_id}", response_model=ShopOut)
def get_shop(
    shop_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Shop:
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    return shop


@router.patch("/{shop_id}", response_model=ShopOut)
def update_shop(
    shop_id: UUID,
    payload: ShopUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin, AppRole.sales)),
) -> Shop:
    shop = db.query(Shop).filter(Shop.id == shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    data = payload.model_dump(exclude_unset=True)
    address_changed = bool(ADDRESS_FIELDS.intersection(data.keys()))
    coords_provided = "latitude" in data or "longitude" in data
    for key, value in data.items():
        setattr(shop, key, value)
    if coords_provided:
        pass
    elif address_changed or shop.latitude is None or shop.longitude is None:
        apply_geocode_if_needed(shop, force=address_changed)
    db.commit()
    db.refresh(shop)
    return shop
