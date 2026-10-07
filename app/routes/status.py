from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.klique import KliqueRequest
from app.models.status import (
    Status,
    StatusRecipient,
    DURATION_SECONDS,
)
from app.services import storage


router = APIRouter(tags=["status"])


class StatusCreate(BaseModel):
    content: str | None = None

    # Legacy single-media input.
    media_ref: str | None = None

    # New multi-media input.
    media_refs: list[str] = []

    duration: str
    visibility: str
    recipient_uids: list[str] = []


def get_klique_uids(
    db: Session,
    uid: str,
) -> set[str]:
    rows = db.query(KliqueRequest).filter(
        KliqueRequest.status == "accepted",
        or_(
            KliqueRequest.from_uid == uid,
            KliqueRequest.to_uid == uid,
        ),
    ).all()

    return {
        r.to_uid if r.from_uid == uid else r.from_uid
        for r in rows
    }


@router.post("/status")
async def create_status(
    payload: StatusCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.duration not in DURATION_SECONDS:
        raise HTTPException(
            status_code=400,
            detail=(
                "duration must be one of "
                f"{list(DURATION_SECONDS)}"
            ),
        )

    if payload.visibility not in (
        "global",
        "targeted",
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "visibility must be "
                "'global' or 'targeted'"
            ),
        )

    # Normalize legacy single-media input into the
    # canonical media_refs list.
    media_refs = [
        ref.strip()
        for ref in payload.media_refs
        if isinstance(ref, str) and ref.strip()
    ]

    if payload.media_ref:
        legacy_ref = payload.media_ref.strip()

        if legacy_ref and legacy_ref not in media_refs:
            media_refs.insert(0, legacy_ref)

    if not payload.content and not media_refs:
        raise HTTPException(
            status_code=400,
            detail="Status needs content or media",
        )

    if payload.visibility == "targeted":
        if not payload.recipient_uids:
            raise HTTPException(
                status_code=400,
                detail=(
                    "recipient_uids required "
                    "for targeted share"
                ),
            )

        klique_uids = get_klique_uids(
            db,
            current_user.uid,
        )

        invalid = [
            uid
            for uid in payload.recipient_uids
            if uid not in klique_uids
        ]

        if invalid:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Not a Klique of yours: {invalid}"
                ),
            )

    expires_at = (
        datetime.utcnow()
        + timedelta(
            seconds=DURATION_SECONDS[
                payload.duration
            ]
        )
    )

    status = Status(
        author_uid=current_user.uid,
        content=payload.content,
        media_ref=(
            media_refs[0]
            if media_refs
            else None
        ),
        media_refs=(
            ",".join(media_refs)
            if media_refs
            else None
        ),
        visibility=payload.visibility,
        expires_at=expires_at,
    )

    db.add(status)
    db.flush()

    if payload.visibility == "targeted":
        for uid in payload.recipient_uids:
            db.add(
                StatusRecipient(
                    status_id=status.id,
                    recipient_uid=uid,
                )
            )

    db.commit()
    db.refresh(status)

    return {
        "id": str(status.id),
        "expires_at": status.expires_at.isoformat(),
        "media_refs": media_refs,
    }


@router.get("/status/feed")
async def get_status_feed(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    now = datetime.utcnow()

    klique_uids = get_klique_uids(
        db,
        current_user.uid,
    )

    visible_query = db.query(Status).filter(
        Status.expires_at > now,
        or_(
            Status.author_uid == current_user.uid,
            and_(
                Status.author_uid.in_(klique_uids),
                Status.visibility == "global",
            ),
        ),
    )

    visible = {
        s.id: s
        for s in visible_query.all()
    }

    targeted_ids = [
        r.status_id
        for r in db.query(StatusRecipient).filter(
            StatusRecipient.recipient_uid
            == current_user.uid
        ).all()
    ]

    if targeted_ids:
        for s in db.query(Status).filter(
            Status.id.in_(targeted_ids),
            Status.expires_at > now,
        ).all():
            visible[s.id] = s

    all_statuses = sorted(
        visible.values(),
        key=lambda s: s.created_at,
        reverse=True,
    )

    author_uids = list({
        s.author_uid
        for s in all_statuses
    })

    authors = {
        u.uid: u
        for u in db.query(User).filter(
            User.uid.in_(author_uids)
        ).all()
    }

    grouped: dict[str, list[Status]] = {}

    for s in all_statuses:
        grouped.setdefault(
            s.author_uid,
            [],
        ).append(s)

    author_order = sorted(
        grouped.keys(),
        key=lambda uid: (
            uid != current_user.uid,
            -grouped[uid][0]
                .created_at
                .timestamp(),
        ),
    )

    result = []

    for uid in author_order:
        statuses = []

        for s in grouped[uid]:
            if s.media_refs:
                raw_refs = [
                    ref.strip()
                    for ref in s.media_refs.split(",")
                    if ref.strip()
                ]
            elif s.media_ref:
                raw_refs = [
                    s.media_ref
                ]
            else:
                raw_refs = []

            signed_refs = [
                storage.get_signed_url(ref)
                for ref in raw_refs
            ]

            statuses.append({
                "id": str(s.id),
                "content": s.content,

                # Legacy first-media field.
                "media_ref": (
                    signed_refs[0]
                    if signed_refs
                    else None
                ),

                # Complete media set.
                "media_refs": signed_refs,

                "visibility": s.visibility,
                "created_at": (
                    s.created_at.isoformat()
                ),
                "expires_at": (
                    s.expires_at.isoformat()
                ),
            })

        result.append({
            "author_uid": uid,
            "author_username": (
                authors[uid].username
                if authors.get(uid)
                else uid
            ),
            "is_me": (
                uid == current_user.uid
            ),
            "statuses": statuses,
        })

    return result
