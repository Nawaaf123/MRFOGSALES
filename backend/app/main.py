from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session, joinedload

from app.api.router import api_router
from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import Base, SessionLocal, engine
from app.models import AppRole, User, UserRole, WarehouseCode


def seed_admin(db: Session) -> None:
    settings = get_settings()
    existing = db.query(User).filter(User.email == settings.seed_admin_email.lower()).first()
    if existing:
        return
    user = User(
        email=settings.seed_admin_email.lower(),
        hashed_password=hash_password(settings.seed_admin_password),
        full_name=settings.seed_admin_name,
        assigned_warehouse=WarehouseCode.A,
    )
    db.add(user)
    db.flush()
    db.add(UserRole(user_id=user.id, role=AppRole.admin))
    db.commit()


def ensure_schema() -> None:
    """Add columns that create_all will not alter on existing databases."""
    statements = [
        "ALTER TABLE shops ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION",
        "ALTER TABLE shops ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION",
    ]
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    ensure_schema()
    db = SessionLocal()
    try:
        seed_admin(db)
    finally:
        db.close()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(api_router)

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
