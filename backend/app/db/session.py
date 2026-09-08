from collections.abc import Generator
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()

# Keep total DB connections modest across workers:
# pool_size + max_overflow per process × WEB_CONCURRENCY.
_workers = max(1, int(os.getenv("WEB_CONCURRENCY", "1") or "1"))
_pool_size = 5 if _workers <= 2 else 3
_max_overflow = 5 if _workers <= 2 else 2

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=_pool_size,
    max_overflow=_max_overflow,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
