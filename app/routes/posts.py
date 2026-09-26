from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.post import Post, Comment, Reaction, FEED_CATEGORIES, VALID_REACTIONS
from app.services.crawler import crawl, Candidate
from app.services import storage

router = APIRouter(tags=["posts"])


class PostCreate(BaseModel):
    category: str
    content: str | None = None
    media_refs: list[str] = []


class ReactionCreate(BaseModel):
    emoji: str


class CommentCreate(BaseModel):
    content: str | None = None
    media_ref: str | None = None
    parent_comment_id: str | None = None


def serialize_post(post: Post, author: User | None, comment_count: int) -> dict:
    raw_refs = []
    if post.media_refs:
        raw_refs = [m for m in post.media_refs.split(",") if m]
    elif post.media_ref:
        raw_refs = [post.media_ref]

    media_list = []
    for ref in raw_refs:
        try:
            media_list.append(storage.get_signed_url(ref))
        except Exception:
            media_list.append(ref)  # fall back to the raw ref rather than dropping it entirely
    return {
        "id": str(post.id),
        "author_uid": post.author_uid,
        "author_username": author.username if author else None,
        "author_region": author.region if author else None,
        "author_locality": author.locality if author else None,
        "author_talent_category": author.interest if author else None,
        "category": post.category,
        "content": post.content,
        "media_refs": media_list,
        "comment_count": comment_count,
        "created_at": post.created_at.isoformat() if post.created_at else None,
    }


def serialize_comment(comment: Comment, author: User | None) -> dict:
    return {
        "id": str(comment.id),
        "post_id": str(comment.post_id),
        "parent_comment_id": str(comment.parent_comment_id) if comment.parent_comment_id else None,
        "author_uid": comment.author_uid,
        "author_username": author.username if author else comment.author_uid,
        "content": comment.content,
        "media_ref": comment.media_ref,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


@router.post("/posts")
async def create_post(payload: PostCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.category not in FEED_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of {sorted(FEED_CATEGORIES)}")
    post = Post(
        author_uid=current_user.uid, category=payload.category, content=payload.content,
        media_refs=",".join(payload.media_refs) if payload.media_refs else None,
        identity_version=current_user.identity_version,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return serialize_post(post, current_user, 0)


@router.get("/feed")
async def get_feed(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    def fetch_at_row(row: int) -> list[Candidate]:
        users_at_row = db.query(User).filter(User.start_row == row).all()
        candidates = []
        for u in users_at_row:
            if db.query(Post).filter(Post.author_uid == u.uid).count() == 0:
                continue
            candidates.append(Candidate(
                id=u.uid, row=row, field=u.business_role, role="User", country=u.country,
                region=u.region, locality=u.locality, language=u.language, interest=u.interest,
            ))
        return candidates

    results = crawl(
        searcher_row=current_user.start_row, searcher_field=current_user.business_role or "",
        searcher_role="User", searcher_country=current_user.country or "", searcher_region=current_user.region or "",
        searcher_locality=current_user.locality or "", searcher_language=current_user.language or "",
        searcher_interest=current_user.interest or "", surface="feed", fetch_candidates_at_row=fetch_at_row,
    )

    author_uids = [r.candidate.id for r in results]
    posts = db.query(Post).filter(Post.author_uid.in_(author_uids)).order_by(Post.created_at.desc()).all()
    if not posts:
        return []

    post_ids = [p.id for p in posts]
    authors = {u.uid: u for u in db.query(User).filter(User.uid.in_(author_uids)).all()}
    comment_counts = dict(
        db.query(Comment.post_id, func.count(Comment.id)).filter(Comment.post_id.in_(post_ids)).group_by(Comment.post_id).all()
    )
    return [serialize_post(p, authors.get(p.author_uid), comment_counts.get(p.id, 0)) for p in posts]


@router.delete("/posts/{post_id}")
async def delete_post(post_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.author_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="You can only delete your own posts")
    db.query(Reaction).filter(Reaction.post_id == post_id).delete()
    db.query(Comment).filter(Comment.post_id == post_id).delete()
    db.delete(post)
    db.commit()
    return {"status": "deleted"}


@router.post("/posts/{post_id}/react")
async def react_to_post(post_id: str, payload: ReactionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.emoji not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail=f"Emoji must be one of {sorted(VALID_REACTIONS)}")
    existing = db.query(Reaction).filter(Reaction.post_id == post_id, Reaction.uid == current_user.uid).first()
    if existing:
        existing.emoji = payload.emoji
        existing.identity_version = current_user.identity_version
    else:
        db.add(Reaction(post_id=post_id, uid=current_user.uid, emoji=payload.emoji, identity_version=current_user.identity_version))
    db.commit()
    return {"status": "reacted"}


@router.post("/posts/{post_id}/comments")
async def comment_on_post(post_id: str, payload: CommentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = Comment(
        post_id=post_id, author_uid=current_user.uid, content=payload.content,
        media_ref=payload.media_ref, parent_comment_id=payload.parent_comment_id,
        identity_version=current_user.identity_version,
    )
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return serialize_comment(comment, current_user)


@router.get("/posts/{post_id}/comments")
async def list_comments(post_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    comments = db.query(Comment).filter(Comment.post_id == post_id).order_by(Comment.created_at.asc()).all()
    author_uids = list({c.author_uid for c in comments})
    authors = {u.uid: u for u in db.query(User).filter(User.uid.in_(author_uids)).all()} if author_uids else {}
    return [serialize_comment(c, authors.get(c.author_uid)) for c in comments]


@router.post("/comments/{comment_id}/react")
async def react_to_comment(comment_id: str, payload: ReactionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.emoji not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail=f"Emoji must be one of {sorted(VALID_REACTIONS)}")
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    existing = db.query(Reaction).filter(Reaction.comment_id == comment_id, Reaction.uid == current_user.uid).first()
    if existing:
        existing.emoji = payload.emoji
        existing.identity_version = current_user.identity_version
    else:
        db.add(Reaction(comment_id=comment_id, uid=current_user.uid, emoji=payload.emoji, identity_version=current_user.identity_version))
    db.commit()
    return {"status": "reacted"}
