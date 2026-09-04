from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.core.security import hash_password
from app.db.session import get_db
from app.models import AppRole, User, UserRole, WarehouseCode
from app.schemas import SignUpRequest, UserPublic
from app.api.routes.auth import serialize_user

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserPublic])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> list[UserPublic]:
    users = db.query(User).options(joinedload(User.role)).order_by(User.created_at.desc()).all()
    return [serialize_user(user) for user in users]


@router.post("", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: SignUpRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> UserPublic:
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    user = User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        assigned_warehouse=WarehouseCode.A,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role=payload.role))
    db.commit()
    user = db.query(User).options(joinedload(User.role)).filter(User.id == user.id).one()
    return serialize_user(user)


@router.patch("/{user_id}/role", response_model=UserPublic)
def update_user_role(
    user_id: UUID,
    role: AppRole,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> UserPublic:
    user = db.query(User).options(joinedload(User.role)).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.role:
        db.add(UserRole(user_id=user.id, role=role))
    else:
        user.role.role = role
    db.commit()
    user = db.query(User).options(joinedload(User.role)).filter(User.id == user_id).one()
    return serialize_user(user)
