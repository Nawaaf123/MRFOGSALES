from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import AppRole, Shop, User
from app.schemas import (
    GeocodeMissingResult,
    ShopBrief,
    ShopCreate,
    ShopListPage,
    ShopOut,
    ShopUpdate,
)
from app.services.geocode import apply_geocode_if_needed

router = APIRouter(prefix="/shops", tags=["shops"])

ADDRESS_FIELDS = {
    "street_address",
    "street_address_line_2",
    "city",
    "state",
    "zip_code",
}


@router.get("", response_model=ShopListPage)
def list_shops(
    include_frozen: bool = Query(default=False),
    with_coords_only: bool = Query(default=False),
    frozen: bool | None = Query(default=None),
    search: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ShopListPage:
    query = db.query(Shop)
    if frozen is True:
        query = query.filter(Shop.is_frozen.is_(True))
    elif frozen is False or not include_frozen:
        query = query.filter(Shop.is_frozen.is_(False))
    if with_coords_only:
        query = query.filter(Shop.latitude.isnot(None), Shop.longitude.isnot(None))
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Shop.name.ilike(like),
                Shop.owner_name.ilike(like),
                Shop.phone.ilike(like),
                Shop.email.ilike(like),
                Shop.city.ilike(like),
                Shop.state.ilike(like),
            )
        )

    total = query.count()
    shops = query.order_by(Shop.name.asc()).offset((page - 1) * page_size).limit(page_size).all()
    active_count = db.query(func.count(Shop.id)).filter(Shop.is_frozen.is_(False)).scalar() or 0
    frozen_count = db.query(func.count(Shop.id)).filter(Shop.is_frozen.is_(True)).scalar() or 0

    return ShopListPage(
        items=shops,
        total=total,
        page=page,
        page_size=page_size,
        active_count=int(active_count),
        frozen_count=int(frozen_count),
    )


@router.get("/map", response_model=list[ShopBrief])
def list_shops_for_map(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> list[ShopBrief]:
    """Lightweight pin payload — only fields the map needs. Admin only."""
    rows = (
        db.query(Shop)
        .filter(
            Shop.is_frozen.is_(False),
            Shop.latitude.isnot(None),
            Shop.longitude.isnot(None),
        )
        .order_by(Shop.name.asc())
        .all()
    )
    return [
        ShopBrief(
            id=shop.id,
            name=shop.name,
            owner_name=shop.owner_name,
            phone=shop.phone,
            email=shop.email,
            street_address=shop.street_address,
            city=shop.city,
            state=shop.state,
            zip_code=shop.zip_code,
            latitude=shop.latitude,
            longitude=shop.longitude,
        )
        for shop in rows
    ]


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
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
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
    _: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
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
