from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services.placement import compute_L, compute_C, elastic_cloud

router = APIRouter(prefix="/search", tags=["search"])


def _text_S(text: str) -> int:
    """
    Text-based S for Elastic Cloud fuzzy matching — NOT the same S used in
    identity placement (which is a UID digit sum). A bare search query has
    no phone number, so comparing it against a user's real UID digit sum
    would be meaningless. Both sides of this comparison use this same
    character-sum fingerprint instead, so a one-character typo only shifts
    S by a small amount, keeping the match within a tight radius.
    """
    cleaned = (text or "").strip().lower()
    return sum(ord(ch) for ch in cleaned) % 1000


@router.get("/fuzzy")
async def fuzzy_username_search(
    q: str = Query(...),
    radius: int = Query(default=2, ge=1, le=4),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Elastic Cloud — typo-tolerant search. Distinct from the crawler's row
    perturbation and from the lexico engine's stem/synonym matching: this
    specifically handles near-miss text-shape (a typo that shifts length,
    character-sum, or first-letter by a small amount).
    """
    L = compute_L(q)
    S = _text_S(q)
    C = compute_C(q)
    cloud = set(elastic_cloud(L, S, C, radius=radius))

    candidates = db.query(User).all()
    matches = []
    for u in candidates:
        fingerprint = (compute_L(u.username), _text_S(u.username), compute_C(u.username))
        if fingerprint in cloud:
            matches.append(u)

    return [{"uid": u.uid, "username": u.username} for u in matches[:25]]
