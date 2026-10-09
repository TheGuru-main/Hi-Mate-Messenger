from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.post import Post, PostMention, Comment, Reaction, FEED_CATEGORIES, VALID_REACTIONS
from app.services.crawler import crawl, Candidate
from app.services import storage
from app.models.klique import KliqueRequest, Follow

router = APIRouter(tags=["posts"])

GEM_EMOJI = "💎"


class PostCreate(BaseModel):
    category: str
    content: str | None = None
    media_refs: list[str] = []
    mentioned_uids: list[str] = []


class ReactionCreate(BaseModel):
    emoji: str


class CommentCreate(BaseModel):
    content: str | None = None
    media_ref: str | None = None
    parent_comment_id: str | None = None


def bulk_reaction_data(db: Session, post_ids: list, viewer_uid: str) -> dict:
    """Returns {post_id: {'counts': {emoji: n}, 'my_reaction': str|None, 'my_gem': bool}}"""
    if not post_ids:
        return {}
    rows = db.query(Reaction).filter(Reaction.post_id.in_(post_ids)).all()
    result = {pid: {"counts": {}, "my_reaction": None, "my_gem": False} for pid in post_ids}
    for r in rows:
        entry = result.get(r.post_id)
        if entry is None:
            continue
        entry["counts"][r.emoji] = entry["counts"].get(r.emoji, 0) + 1
        if r.uid == viewer_uid:
            if r.emoji == GEM_EMOJI:
                entry["my_gem"] = True
            else:
                entry["my_reaction"] = r.emoji
    return result


def _is_video_ref(ref: str) -> bool:
    return ref.lower().split("?")[0].endswith((".mp4", ".mov", ".m4v"))


def _post_has_video(post: Post) -> bool:
    refs = [m for m in (post.media_refs or "").split(",") if m]
    if not refs and post.media_ref:
        refs = [post.media_ref]
    return any(_is_video_ref(r) for r in refs)


def bulk_relation_data(db: Session, author_uids: list, viewer_uid: str) -> dict:
    """{author_uid: {'klique_status': str|None, 'is_following': bool}} from the viewer's side."""
    uids = [u for u in set(author_uids) if u != viewer_uid]
    result = {u: {"klique_status": None, "is_following": False} for u in uids}
    if not uids:
        return result
    klique_rows = db.query(KliqueRequest).filter(
        or_(
            (KliqueRequest.from_uid == viewer_uid) & (KliqueRequest.to_uid.in_(uids)),
            (KliqueRequest.to_uid == viewer_uid) & (KliqueRequest.from_uid.in_(uids)),
        )
    ).all()
    for row in klique_rows:
        other = row.to_uid if row.from_uid == viewer_uid else row.from_uid
        if other in result:
            result[other]["klique_status"] = row.status
    for rel in db.query(Follow).filter(Follow.follower_uid == viewer_uid, Follow.followee_uid.in_(uids)).all():
        if rel.followee_uid in result:
            result[rel.followee_uid]["is_following"] = True
    return result



def serialize_post(db: Session, post: Post, author: User | None, comment_count: int, reaction_data: dict | None = None, relation: dict | None = None) -> dict:
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
            media_list.append(ref)

    rd = reaction_data or {"counts": {}, "my_reaction": None, "my_gem": False}
    gem_count = rd["counts"].get(GEM_EMOJI, 0)
    emoji_counts = {k: v for k, v in rd["counts"].items() if k != GEM_EMOJI}

    mention_rows = db.query(PostMention, User).join(
        User, User.uid == PostMention.mentioned_uid
    ).filter(PostMention.post_id == post.id).all()

    return {
        "id": str(post.id),
        "author_uid": post.author_uid,
        "author_username": author.username if author else None,
        "author_profile_image_ref": (
            storage.get_signed_url(author.profile_image_ref)
            if author and author.profile_image_ref
            else None
        ),
        "author_region": author.region if author else None,
        "author_locality": author.locality if author else None,
        "author_talent_category": author.interest if author else None,
        "category": post.category,
        "content": post.content,
        "mentions": [
            {"uid": user.uid, "username": user.username}
            for _, user in mention_rows
        ],
        "media_refs": media_list,
        "comment_count": comment_count,
        "reaction_counts": emoji_counts,
        "my_reaction": rd["my_reaction"],
        "gem_count": gem_count,
        "my_gem": rd["my_gem"],
        "author_klique_status": (relation or {}).get("klique_status"),
        "author_is_following": bool((relation or {}).get("is_following")),
        "created_at": post.created_at.isoformat() if post.created_at else None,
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
    db.flush()

    mention_uids = list(dict.fromkeys(
        uid for uid in payload.mentioned_uids
        if uid and uid != current_user.uid
    ))

    if mention_uids:
        valid_users = {
            u.uid
            for u in db.query(User).filter(User.uid.in_(mention_uids)).all()
        }

        for uid in mention_uids:
            if uid in valid_users:
                db.add(
                    PostMention(
                        post_id=post.id,
                        mentioned_uid=uid,
                    )
                )

    db.commit()
    db.refresh(post)
    return serialize_post(db, post, current_user, 0)


@router.delete("/posts/{post_id}")
async def delete_post(post_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    post = db.query(Post).filter(Post.id == post_id).first()
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    if post.author_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="You can only delete your own posts")
    db.query(PostMention).filter(PostMention.post_id == post_id).delete()
    db.query(Reaction).filter(Reaction.post_id == post_id).delete()
    db.query(Comment).filter(Comment.post_id == post_id).delete()
    db.delete(post)
    db.commit()
    return {"status": "deleted"}


@router.get("/feed")
async def get_feed(media: str | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    if media == "video":
        posts = [p for p in posts if _post_has_video(p)]
    if not posts:
        return []

    post_ids = [p.id for p in posts]
    authors = {u.uid: u for u in db.query(User).filter(User.uid.in_(author_uids)).all()}
    comment_counts = dict(
        db.query(Comment.post_id, func.count(Comment.id)).filter(Comment.post_id.in_(post_ids)).group_by(Comment.post_id).all()
    )
    reaction_data = bulk_reaction_data(db, post_ids, current_user.uid)
    relations = bulk_relation_data(db, author_uids, current_user.uid)

    return [
        serialize_post(db, p, authors.get(p.author_uid), comment_counts.get(p.id, 0), reaction_data.get(p.id), relations.get(p.author_uid))
        for p in posts
    ]


@router.post("/posts/{post_id}/react")
async def react_to_post(
    post_id: str,
    payload: ReactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.emoji not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail=f"Emoji must be one of {sorted(VALID_REACTIONS)}")

    is_gem = payload.emoji == GEM_EMOJI

    # Gem and regular emoji reactions occupy SEPARATE slots — a user can have
    # at most one regular emoji reaction AND independently one gem, at the same time.
    if is_gem:
        existing = db.query(Reaction).filter(
            Reaction.post_id == post_id, Reaction.uid == current_user.uid, Reaction.emoji == GEM_EMOJI
        ).first()
    else:
        existing = db.query(Reaction).filter(
            Reaction.post_id == post_id, Reaction.uid == current_user.uid, Reaction.emoji != GEM_EMOJI
        ).first()

    if existing and existing.emoji == payload.emoji:
        # Re-tapping the SAME reaction removes it (toggle off)
        db.delete(existing)
        db.commit()
        return {"status": "removed"}
    elif existing:
        # Switching to a different (non-gem) reaction
        existing.emoji = payload.emoji
        existing.identity_version = current_user.identity_version
        db.commit()
        return {"status": "reacted"}
    else:
        db.add(Reaction(
            post_id=post_id, uid=current_user.uid, emoji=payload.emoji,
            identity_version=current_user.identity_version,
        ))
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
    return {
        "id": str(comment.id), "post_id": str(comment.post_id),
        "parent_comment_id": str(comment.parent_comment_id) if comment.parent_comment_id else None,
        "author_uid": comment.author_uid, "author_username": current_user.username,
        "content": comment.content, "media_ref": comment.media_ref,
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


@router.get("/posts/{post_id}/comments")
async def list_comments(post_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    comments = db.query(Comment).filter(Comment.post_id == post_id).order_by(Comment.created_at.asc()).all()
    author_uids = list({c.author_uid for c in comments})
    authors = {u.uid: u for u in db.query(User).filter(User.uid.in_(author_uids)).all()} if author_uids else {}
    return [
        {
            "id": str(c.id), "post_id": str(c.post_id),
            "parent_comment_id": str(c.parent_comment_id) if c.parent_comment_id else None,
            "author_uid": c.author_uid,
            "author_username": authors[c.author_uid].username if authors.get(c.author_uid) else c.author_uid,
            "content": c.content, "media_ref": c.media_ref,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in comments
    ]


@router.post("/comments/{comment_id}/react")
async def react_to_comment(comment_id: str, payload: ReactionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if payload.emoji not in VALID_REACTIONS:
        raise HTTPException(status_code=400, detail=f"Emoji must be one of {sorted(VALID_REACTIONS)}")
    comment = db.query(Comment).filter(Comment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    existing = db.query(Reaction).filter(Reaction.comment_id == comment_id, Reaction.uid == current_user.uid).first()
    if existing and existing.emoji == payload.emoji:
        db.delete(existing)
        db.commit()
        return {"status": "removed"}
    elif existing:
        existing.emoji = payload.emoji
        existing.identity_version = current_user.identity_version
        db.commit()
        return {"status": "reacted"}
    else:
        db.add(Reaction(comment_id=comment_id, uid=current_user.uid, emoji=payload.emoji, identity_version=current_user.identity_version))
        db.commit()
        return {"status": "reacted"}
