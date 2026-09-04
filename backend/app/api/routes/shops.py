from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import AppRole, Shop, User
from app.schemas import ShopCreate, ShopOut, ShopUpdate

router = APIRouter(prefix="/shops", tags=["shops"])


@router.get("", response_model=list[ShopOut])
def list_shops(
    include_frozen: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[Shop]:
    query = db.query(Shop).order_by(Shop.name.asc())
    if not include_frozen:
        query = query.filter(Shop.is_frozen.is_(False))
    return query.all()


@router.post("", response_model=ShopOut, status_code=status.HTTP_201_CREATED)
def create_shop(
    payload: ShopCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales)),
) -> Shop:
    shop = Shop(**payload.model_dump(), created_by=current_user.id)
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
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(shop, key, value)
    db.commit()
    db.refresh(shop)
    return shop
