from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.core.security import hash_password
from app.db.session import get_db
from app.models import (
    AppRole,
    RetailerSignupRequest,
    Shop,
    SignupRequestStatus,
    User,
    UserRole,
    WarehouseCode,
)
from app.schemas import RetailerSignupApprove, RetailerSignupCreate, RetailerSignupOut

router = APIRouter(prefix="/retailer-signups", tags=["retailer-signups"])


def serialize(row: RetailerSignupRequest) -> RetailerSignupOut:
    return RetailerSignupOut(
        id=row.id,
        email=row.email,
        full_name=row.full_name,
        phone=row.phone,
        requested_shop_name=row.requested_shop_name,
        message=row.message,
        status=row.status.value if hasattr(row.status, "value") else str(row.status),
        shop_id=row.shop_id,
        user_id=row.user_id,
        created_at=row.created_at,
        reviewed_at=row.reviewed_at,
    )


@router.post("", response_model=RetailerSignupOut, status_code=status.HTTP_201_CREATED)
def create_signup(payload: RetailerSignupCreate, db: Session = Depends(get_db)) -> RetailerSignupOut:
    existing_user = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    pending = (
        db.query(RetailerSignupRequest)
        .filter(
            RetailerSignupRequest.email == payload.email.lower(),
            RetailerSignupRequest.status == SignupRequestStatus.pending,
        )
        .first()
    )
    if pending:
        raise HTTPException(status_code=400, detail="A pending request already exists for this email")

    # Create inactive retailer user until approved
    user = User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        assigned_warehouse=WarehouseCode.A,
        is_active=False,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role=AppRole.retailer))

    request_row = RetailerSignupRequest(
        email=payload.email.lower(),
        full_name=payload.full_name,
        phone=payload.phone,
        requested_shop_name=payload.requested_shop_name,
        message=payload.message,
        status=SignupRequestStatus.pending,
        user_id=user.id,
    )
    db.add(request_row)
    db.commit()
    db.refresh(request_row)
    return serialize(request_row)


@router.get("", response_model=list[RetailerSignupOut])
def list_signups(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> list[RetailerSignupOut]:
    rows = (
        db.query(RetailerSignupRequest)
        .order_by(RetailerSignupRequest.created_at.desc())
        .all()
    )
    return [serialize(row) for row in rows]


@router.post("/{request_id}/approve", response_model=RetailerSignupOut)
def approve_signup(
    request_id: UUID,
    payload: RetailerSignupApprove,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin)),
) -> RetailerSignupOut:
    row = db.query(RetailerSignupRequest).filter(RetailerSignupRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.status != SignupRequestStatus.pending:
        raise HTTPException(status_code=400, detail="Request is not pending")

    shop = db.query(Shop).filter(Shop.id == payload.shop_id).first()
    if not shop:
        raise HTTPException(status_code=404, detail="Shop not found")
    if shop.retailer_user_id:
        raise HTTPException(status_code=400, detail="Shop already linked to a retailer")

    user = db.query(User).filter(User.id == row.user_id).first() if row.user_id else None
    if not user:
        raise HTTPException(status_code=400, detail="Signup user missing")

    user.is_active = True
    shop.retailer_user_id = user.id
    row.status = SignupRequestStatus.approved
    row.shop_id = shop.id
    row.reviewed_by = current_user.id
    row.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return serialize(row)


@router.post("/{request_id}/reject", response_model=RetailerSignupOut)
def reject_signup(
    request_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin)),
) -> RetailerSignupOut:
    row = db.query(RetailerSignupRequest).filter(RetailerSignupRequest.id == request_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.status != SignupRequestStatus.pending:
        raise HTTPException(status_code=400, detail="Request is not pending")

    row.status = SignupRequestStatus.rejected
    row.reviewed_by = current_user.id
    row.reviewed_at = datetime.now(timezone.utc)
    if row.user_id:
        user = db.query(User).filter(User.id == row.user_id).first()
        if user:
            user.is_active = False
    db.commit()
    db.refresh(row)
    return serialize(row)
