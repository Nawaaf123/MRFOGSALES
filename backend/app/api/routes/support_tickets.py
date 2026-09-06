from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, aliased

from app.api.deps import require_roles
from app.db.session import get_db
from app.models import AppRole, SupportTicket, SupportTicketStatus, User
from app.schemas import SupportTicketCreate, SupportTicketOut, SupportTicketResolve

router = APIRouter(prefix="/support-tickets", tags=["support-tickets"])

STAFF_ROLES = (AppRole.admin, AppRole.sales, AppRole.srour)


def serialize(
    row: SupportTicket,
    *,
    created_by_name: str | None = None,
    created_by_email: str | None = None,
    resolved_by_name: str | None = None,
) -> SupportTicketOut:
    return SupportTicketOut(
        id=row.id,
        created_by=row.created_by,
        created_by_name=created_by_name,
        created_by_email=created_by_email,
        subject=row.subject,
        body=row.body,
        status=row.status.value if hasattr(row.status, "value") else str(row.status),
        resolution=row.resolution,
        resolved_by=row.resolved_by,
        resolved_by_name=resolved_by_name,
        resolved_at=row.resolved_at,
        created_at=row.created_at,
    )


@router.post("", response_model=SupportTicketOut, status_code=status.HTTP_201_CREATED)
def create_ticket(
    payload: SupportTicketCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*STAFF_ROLES)),
) -> SupportTicketOut:
    row = SupportTicket(
        created_by=current_user.id,
        subject=payload.subject.strip(),
        body=payload.body.strip(),
        status=SupportTicketStatus.open,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return serialize(
        row,
        created_by_name=current_user.full_name,
        created_by_email=current_user.email,
    )


@router.get("", response_model=list[SupportTicketOut])
def list_tickets(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(*STAFF_ROLES)),
) -> list[SupportTicketOut]:
    creator = aliased(User)
    resolver = aliased(User)
    query = (
        db.query(SupportTicket, creator.full_name, creator.email, resolver.full_name)
        .join(creator, SupportTicket.created_by == creator.id)
        .outerjoin(resolver, SupportTicket.resolved_by == resolver.id)
        .order_by(SupportTicket.created_at.desc())
    )
    role = current_user.role.role if current_user.role else None
    if role != AppRole.admin:
        query = query.filter(SupportTicket.created_by == current_user.id)

    rows = query.all()
    return [
        serialize(
            ticket,
            created_by_name=created_name,
            created_by_email=created_email,
            resolved_by_name=resolved_name,
        )
        for ticket, created_name, created_email, resolved_name in rows
    ]


@router.post("/{ticket_id}/resolve", response_model=SupportTicketOut)
def resolve_ticket(
    ticket_id: UUID,
    payload: SupportTicketResolve,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(AppRole.admin)),
) -> SupportTicketOut:
    creator = aliased(User)
    row = (
        db.query(SupportTicket, creator.full_name, creator.email)
        .join(creator, SupportTicket.created_by == creator.id)
        .filter(SupportTicket.id == ticket_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Ticket not found")

    ticket, created_name, created_email = row
    if ticket.status != SupportTicketStatus.open:
        raise HTTPException(status_code=400, detail="Ticket is already resolved")

    ticket.status = SupportTicketStatus.resolved
    ticket.resolution = payload.resolution.strip()
    ticket.resolved_by = current_user.id
    ticket.resolved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ticket)
    return serialize(
        ticket,
        created_by_name=created_name,
        created_by_email=created_email,
        resolved_by_name=current_user.full_name,
    )
