from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.klique import KliqueRequest, Follow
from app.models.contact_link import ContactLink
from app.services import placement
from app.services.crawler import crawl, Candidate

router = APIRouter(tags=["search"])


def _serialize_user_results(db: Session, users: list[User], viewer: User) -> list[dict]:
    if not users:
        return []
    uids = [u.uid for u in users]

    klique_rows = db.query(KliqueRequest).filter(
        or_(
            (KliqueRequest.from_uid == viewer.uid) & (KliqueRequest.to_uid.in_(uids)),
            (KliqueRequest.to_uid == viewer.uid) & (KliqueRequest.from_uid.in_(uids)),
        )
    ).all()
    klique_status_by_uid = {}
    for row in klique_rows:
        other = row.to_uid if row.from_uid == viewer.uid else row.from_uid
        klique_status_by_uid[other] = row.status

    following_uids = {
        f.followee_uid for f in db.query(Follow).filter(
            Follow.follower_uid == viewer.uid, Follow.followee_uid.in_(uids)
        ).all()
    }

    contact_rows = db.query(ContactLink).filter(
        or_(
            (ContactLink.owner_uid == viewer.uid) & (ContactLink.contact_uid.in_(uids)),
            (ContactLink.contact_uid == viewer.uid) & (ContactLink.owner_uid.in_(uids)),
        )
    ).all()
    contact_uids = {(r.contact_uid if r.owner_uid == viewer.uid else r.owner_uid) for r in contact_rows}
    return [
        {
            "uid": u.uid,
            "username": u.username,
            "talent_category": u.interest,
            "business_category": u.business_role,
            "country": u.country,
            "region": u.region,
            "locality": u.locality,
            "klique_status": klique_status_by_uid.get(u.uid),
            "is_following": u.uid in following_uids,
            "is_contact": u.uid in contact_uids,
            "is_me": u.uid == viewer.uid,
        }
        for u in users
    ]


@router.get("/search")
async def search(
    q: str = Query(...),
    type: str = Query(..., pattern="^(username|phone)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if type == "phone":
        uid = placement.strip_plus(q)
        user = db.query(User).filter(User.uid == uid).first()
        users = [user] if user else []
    else:
        users = db.query(User).filter(User.username.ilike(f"%{q}%")).limit(25).all()
    return _serialize_user_results(db, users, current_user)


def _fetch_at_row(db: Session, row: int) -> list[Candidate]:
    users = db.query(User).filter(User.start_row == row).all()
    return [
        Candidate(
            id=u.uid, row=row, field=u.business_role, role="User",
            country=u.country, region=u.region, locality=u.locality,
            language=u.language, interest=u.interest,
        )
        for u in users
    ]


@router.get("/search/klique-suggestions")
async def klique_suggestions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results = crawl(
        searcher_row=current_user.start_row,
        searcher_field=current_user.business_role or "",
        searcher_role="User",
        searcher_country=current_user.country or "",
        searcher_region=current_user.region or "",
        searcher_locality=current_user.locality or "",
        searcher_language=current_user.language or "",
        searcher_interest=current_user.interest or "",
        surface="klique",
        fetch_candidates_at_row=lambda row: _fetch_at_row(db, row),
    )
    return [{"uid": r.candidate.id, "score": r.total} for r in results]


@router.get("/search/nearby")
async def nearby(
    type: str = Query(..., pattern="^(community|group|business)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    results = crawl(
        searcher_row=current_user.start_row,
        searcher_field=current_user.business_role or "",
        searcher_role="User",
        searcher_country=current_user.country or "",
        searcher_region=current_user.region or "",
        searcher_locality=current_user.locality or "",
        searcher_language=current_user.language or "",
        searcher_interest=current_user.interest or "",
        surface="other",
        fetch_candidates_at_row=lambda row: _fetch_at_row(db, row),
    )
    return [{"uid": r.candidate.id, "score": r.total} for r in results]
