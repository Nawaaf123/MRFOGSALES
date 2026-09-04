from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.db.session import get_db
from app.models import AppRole, User, UserRole, WarehouseCode
from app.schemas import AuthResponse, SignInRequest, SignUpRequest, UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])


def serialize_user(user: User) -> UserPublic:
    role = user.role.role if user.role else AppRole.sales
    return UserPublic(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=role,
        assigned_warehouse=user.assigned_warehouse,
        is_active=user.is_active,
        created_at=user.created_at,
    )


@router.post("/signup", response_model=AuthResponse)
def signup(payload: SignUpRequest, db: Session = Depends(get_db)) -> AuthResponse:
    settings = get_settings()
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    # First user becomes admin; later self-signups default to sales unless configured otherwise.
    user_count = db.query(User).count()
    role = AppRole.admin if user_count == 0 else payload.role
    if role == AppRole.admin and user_count > 0 and settings.environment == "production":
        role = AppRole.sales

    user = User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        assigned_warehouse=WarehouseCode.A,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role=role))
    db.commit()
    db.refresh(user)
    user = db.query(User).options(joinedload(User.role)).filter(User.id == user.id).one()

    token = create_access_token(user.id, {"role": role.value})
    return AuthResponse(access_token=token, user=serialize_user(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: SignInRequest, db: Session = Depends(get_db)) -> AuthResponse:
    user = (
        db.query(User)
        .options(joinedload(User.role))
        .filter(User.email == payload.email.lower())
        .first()
    )
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    role = user.role.role.value if user.role else AppRole.sales.value
    token = create_access_token(user.id, {"role": role})
    return AuthResponse(access_token=token, user=serialize_user(user))


@router.get("/me", response_model=UserPublic)
def me(current_user: User = Depends(get_current_user)) -> UserPublic:
    return serialize_user(current_user)
