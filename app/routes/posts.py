from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.post import Post, Comment, Reaction, FEED_CATEGORIES, VALID_REACTIONS
from app.services.crawler import crawl, Candidate

router = APIRouter(tags=["posts"])


class PostCreate(BaseModel):
    category: str
    content: str | None = None
    media_ref: str | None = None


class ReactionCreate(BaseModel):
    emoji: str


class CommentCreate(BaseModel):
    content: str | None = None
    media_ref: str | None = None


@router.post("/posts")
async def create_post(
    payload: PostCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.category not in FEED_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of {sorted(FEED_CATEGORIES)}")

    post = Post(
        author_uid=current_user.uid,
        category=payload.category,
        content=payload.content,
        media_ref=payload.media_ref,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


@router.get("/feed")
async def get_feed(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Feed powered by the relationship-grid crawler — see app/services/crawler.py
    for the locked forward/backward walk + filter cascade.
    """
    def fetch_at_row(row: int) -> list[Candidate]:
        users_at_row = db.query(User).filter(User.start_row == row).all()
        candidates = []
        for u in users_at_row:
            post_count = db.query(Post).filter(Post.author_uid == u.uid).count()
            if post_count == 0:
                continue
            candidates.append(Candidate(
                id=u.uid,
                row=row,
                field=u.business_role,
                role="User",  # Talent/Scout roles parked for now
                country=u.country,
                language=u.language,
            ))
        return candidates

    results = crawl(
        searcher_row=current_user.start_row,
        searcher_field=current_user.business_role or "",
        searcher_role="User",
        searcher_country=current_user.country or "",
        searcher_language=current_user.language or "",
        surface="feed",
        fetch_candidates_at_row=fetch_at_row,
    )

    author_uids = [r.candidate.id for r in results]
    posts = db.query(Post).filter(Post.author_uid.in_(author_uids)).order_by(Post.created_at.desc()).all()
    return posts


@router.post("/posts/{post_id}/react")
async def react_to_post(
    post_id: str,
    payload: ReactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.emoji not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail=f"Emoji must be one of {sorted(VALID_REACTIONS)}")

    existing = db.query(Reaction).filter(
        Reaction.post_id == post_id, Reaction.uid == current_user.uid
    ).first()
    if existing:
        existing.emoji = payload.emoji
    else:
        db.add(Reaction(post_id=post_id, uid=current_user.uid, emoji=payload.emoji))
    db.commit()
    return {"status": "reacted"}


@router.post("/posts/{post_id}/comments")
async def comment_on_post(
    post_id: str,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    comment = Comment(
        post_id=post_id,
        author_uid=current_user.uid,
        content=payload.content,
        media_ref=payload.media_ref,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return comment
