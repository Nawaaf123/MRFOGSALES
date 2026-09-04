from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models import AppRole, Product, Shop, User
from app.schemas import ProductCreate, ShopCreate

router = APIRouter(prefix="/bulk", tags=["bulk"])


class BulkProductsRequest(BaseModel):
    products: list[ProductCreate] = Field(min_length=1)


class BulkShopsRequest(BaseModel):
    shops: list[ShopCreate] = Field(min_length=1)


class BulkResult(BaseModel):
    created: int


@router.post("/products", response_model=BulkResult, status_code=status.HTTP_201_CREATED)
def bulk_create_products(
    payload: BulkProductsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin, AppRole.sales)),
) -> BulkResult:
    rows = [Product(**item.model_dump()) for item in payload.products]
    db.add_all(rows)
    db.commit()
    return BulkResult(created=len(rows))


@router.post("/shops", response_model=BulkResult, status_code=status.HTTP_201_CREATED)
def bulk_create_shops(
    payload: BulkShopsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin, AppRole.sales)),
) -> BulkResult:
    rows = [Shop(**item.model_dump(), created_by=current_user.id) for item in payload.shops]
    db.add_all(rows)
    db.commit()
    return BulkResult(created=len(rows))
