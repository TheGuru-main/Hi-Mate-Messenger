from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.schemas.user import UserOut, UserUpdate, ContactMatchRequest, ContactMatchResponse, ContactMatch
from app.services import placement

router = APIRouter(tags=["users"])


@router.get("/users/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/users/me", response_model=UserOut)
async def update_me(
    payload: UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    identity_changed = False

    for field_name, value in payload.model_dump(exclude_unset=True).items():
        if field_name in ("username", "phone") and value != getattr(current_user, field_name):
            identity_changed = True
        setattr(current_user, field_name, value)

    if payload.phone:
        current_user.uid = placement.strip_plus(payload.phone)

    if identity_changed:
        # Recalculate placement, bump identity_version. Historical
        # messages/posts keep their OLD identity_version — never recomputed.
        p = placement.compute_placement(current_user.username, current_user.uid)
        current_user.L = p["L"]
        current_user.S = p["S"]
        current_user.C = p["C"]
        current_user.start_row = p["start_row"]
        current_user.identity_version += 1

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/contacts/match", response_model=ContactMatchResponse)
async def match_contacts(
    payload: ContactMatchRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Backend-side phone-to-UID matching. UIDs are never exposed for open
    lookup — this only confirms matches for numbers the caller already
    has in their own phonebook.
    """
    matches = []
    for phone in payload.phone_numbers:
        uid = placement.strip_plus(phone)
        user = db.query(User).filter(User.uid == uid).first()
        if user:
            matches.append(ContactMatch(phone=phone, uid=user.uid, username=user.username))
    return ContactMatchResponse(matches=matches)
