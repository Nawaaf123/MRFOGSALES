from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import AppRole, User, UserLocation
from app.schemas import LocationOut, LocationUpdate

router = APIRouter(prefix="/locations", tags=["locations"])


@router.put("/me", response_model=LocationOut)
def upsert_my_location(
    payload: LocationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LocationOut:
    location = db.query(UserLocation).filter(UserLocation.user_id == current_user.id).first()
    if not location:
        location = UserLocation(user_id=current_user.id, **payload.model_dump())
        db.add(location)
    else:
        location.latitude = payload.latitude
        location.longitude = payload.longitude
        location.accuracy = payload.accuracy
    db.commit()
    db.refresh(location)
    return LocationOut(
        id=location.id,
        user_id=location.user_id,
        latitude=location.latitude,
        longitude=location.longitude,
        accuracy=location.accuracy,
        updated_at=location.updated_at,
        full_name=current_user.full_name,
        email=current_user.email,
    )


@router.get("", response_model=list[LocationOut])
def list_locations(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> list[LocationOut]:
    rows = db.query(UserLocation).options(joinedload(UserLocation.user)).all()
    return [
        LocationOut(
            id=row.id,
            user_id=row.user_id,
            latitude=row.latitude,
            longitude=row.longitude,
            accuracy=row.accuracy,
            updated_at=row.updated_at,
            full_name=row.user.full_name if row.user else None,
            email=row.user.email if row.user else None,
        )
        for row in rows
    ]
