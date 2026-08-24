from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.post import Post
from app.services.lexico_search import search_fusion, SearchCandidate

router = APIRouter(prefix="/search", tags=["search"])


@router.get("/smart")
async def smart_search(
    q: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Free-text search over post content, using the lexico search engine
    (letter grid + word grid + lexico matching + category arrangement).
    Separate from /search (username/phone lookup) and the crawler-based
    Klique/nearby suggestions — this is content search, not people search.
    """
    posts = db.query(Post).filter(Post.content.isnot(None)).limit(500).all()
    candidates = [
        SearchCandidate(id=str(p.id), text=p.content or "", category=p.category)
        for p in posts
    ]
    results = search_fusion(q, candidates)

    posts_by_id = {str(p.id): p for p in posts}
    return [
        {
            "post_id": r.candidate.id,
            "content": posts_by_id[r.candidate.id].content,
            "category": r.candidate.category,
            "lexico_score": r.lexico_score,
            "category_boost": r.category_boost,
            "total": r.total,
        }
        for r in results
    ]
