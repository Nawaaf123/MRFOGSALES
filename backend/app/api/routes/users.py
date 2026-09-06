from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import require_roles
from app.api.routes.auth import serialize_user
from app.core.security import hash_password
from app.db.session import get_db
from app.models import AppRole, User, UserRole
from app.schemas import SignUpRequest, UserNamePublic, UserPublic, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/names", response_model=list[UserNamePublic])
def list_user_names(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin, AppRole.sales, AppRole.srour)),
) -> list[UserNamePublic]:
    """Lightweight directory so staff can show invoice creator names."""
    users = (
        db.query(User.id, User.full_name)
        .filter(User.is_active.is_(True))
        .order_by(User.full_name.asc())
        .all()
    )
    return [UserNamePublic(id=row.id, full_name=row.full_name) for row in users]


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
        assigned_warehouse=payload.assigned_warehouse,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role=payload.role))
    db.commit()
    user = db.query(User).options(joinedload(User.role)).filter(User.id == user.id).one()
    return serialize_user(user)


@router.patch("/{user_id}", response_model=UserPublic)
def update_user(
    user_id: UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> UserPublic:
    user = db.query(User).options(joinedload(User.role)).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.assigned_warehouse is not None:
        user.assigned_warehouse = payload.assigned_warehouse
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.role is not None:
        if not user.role:
            db.add(UserRole(user_id=user.id, role=payload.role))
        else:
            user.role.role = payload.role

    db.commit()
    user = db.query(User).options(joinedload(User.role)).filter(User.id == user_id).one()
    return serialize_user(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_admin: User = Depends(require_roles(AppRole.admin)),
) -> None:
    if current_admin.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot deactivate yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_active = False
    db.commit()
