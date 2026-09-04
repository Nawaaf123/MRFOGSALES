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
) -> UserLocation:
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
    return location


@router.get("", response_model=list[LocationOut])
def list_locations(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(AppRole.admin)),
) -> list[UserLocation]:
    return db.query(UserLocation).options(joinedload(UserLocation.user)).all()
