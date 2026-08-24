from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services import placement
from app.services.crawler import crawl, Candidate

router = APIRouter(tags=["search"])


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
        return [user] if user else []
    return db.query(User).filter(User.username.ilike(f"%{q}%")).limit(25).all()


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
