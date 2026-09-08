from uuid import UUID
from typing import Union

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import AppRole, Product, User
from app.schemas import (
    ProductBrief,
    ProductBriefListPage,
    ProductCreate,
    ProductListPage,
    ProductOut,
    ProductUpdate,
)

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=None)
def list_products(
    active_only: bool = Query(default=False),
    brief: bool = Query(default=False),
    search: str | None = Query(default=None),
    category: str | None = Query(default=None),
    subcategory: str | None = Query(default=None),
    sort: str = Query(default="name", pattern="^(name|sku_asc|sku_desc)$"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Union[ProductBriefListPage, ProductListPage]:
    query = db.query(Product)
    if active_only:
        query = query.filter(Product.is_active.is_(True))
    if category:
        query = query.filter(Product.category == category)
    if subcategory:
        query = query.filter(Product.subcategory == subcategory)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(
            or_(
                Product.name.ilike(like),
                Product.sku.ilike(like),
                Product.barcode.ilike(like),
                Product.category.ilike(like),
                Product.subcategory.ilike(like),
                Product.sub_subcategory.ilike(like),
            )
        )

    total = query.count()

    if sort == "sku_asc":
        query = query.order_by(Product.sku.asc().nulls_last(), Product.name.asc())
    elif sort == "sku_desc":
        query = query.order_by(Product.sku.desc().nulls_last(), Product.name.asc())
    else:
        query = query.order_by(Product.name.asc())

    products = query.offset((page - 1) * page_size).limit(page_size).all()

    if brief:
        return ProductBriefListPage(
            items=[
                ProductBrief(
                    id=p.id,
                    name=p.name,
                    sku=p.sku,
                    barcode=p.barcode,
                    category=p.category,
                    subcategory=p.subcategory,
                    price=float(p.price or 0),
                )
                for p in products
            ],
            total=total,
            page=page,
            page_size=page_size,
        )

    categories = [
        row[0]
        for row in db.query(Product.category)
        .filter(Product.category.isnot(None), Product.category != "")
        .distinct()
        .order_by(Product.category.asc())
        .all()
    ]
    sub_q = db.query(Product.subcategory).filter(
        Product.subcategory.isnot(None),
        Product.subcategory != "",
    )
    if category:
        sub_q = sub_q.filter(Product.category == category)
    subcategories = [row[0] for row in sub_q.distinct().order_by(Product.subcategory.asc()).all()]

    stock_total = func.coalesce(Product.stock_quantity, 0) + func.coalesce(Product.stock_quantity_b, 0)
    active_count = db.query(func.count(Product.id)).filter(Product.is_active.is_(True)).scalar() or 0
    low_stock_count = (
        db.query(func.count(Product.id))
        .filter(
            Product.is_active.is_(True),
            stock_total <= func.coalesce(Product.low_stock_threshold, 0),
        )
        .scalar()
        or 0
    )
    catalog_total = db.query(func.count(Product.id)).scalar() or 0

    return ProductListPage(
        items=products,
        total=total,
        page=page,
        page_size=page_size,
        categories=categories,
        subcategories=subcategories,
        catalog_total=int(catalog_total),
        active_count=int(active_count),
        low_stock_count=int(low_stock_count),
    )


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin, AppRole.srour)),
) -> Product:
    product = Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.get("/{product_id}", response_model=ProductOut)
def get_product(
    product_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> Product:
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.patch("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin, AppRole.srour)),
) -> Product:
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(product, key, value)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_product(
    product_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> None:
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    product.is_active = False
    db.commit()
