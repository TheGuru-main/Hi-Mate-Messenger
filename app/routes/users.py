from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.post import Post, Comment, Reaction
from app.models.klique import KliqueRequest, Follow
from app.schemas.user import UserOut, UserUpdate, ContactMatchRequest, ContactMatchResponse, ContactMatch
from app.services import placement
from app.routes.posts import serialize_post

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
    matches = []
    for phone in payload.phone_numbers:
        uid = placement.strip_plus(phone)
        user = db.query(User).filter(User.uid == uid).first()
        if user:
            matches.append(ContactMatch(phone=phone, uid=user.uid, username=user.username))
    return ContactMatchResponse(matches=matches)


@router.get("/users/{uid}/profile")
async def get_user_profile(uid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target = db.query(User).filter(User.uid == uid).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    post_count = db.query(Post).filter(Post.author_uid == uid).count()

    klique_row = db.query(KliqueRequest).filter(
        ((KliqueRequest.from_uid == current_user.uid) & (KliqueRequest.to_uid == uid))
        | ((KliqueRequest.from_uid == uid) & (KliqueRequest.to_uid == current_user.uid))
    ).first()
    klique_status = klique_row.status if klique_row else None

    is_following = db.query(Follow).filter(
        Follow.follower_uid == current_user.uid, Follow.followee_uid == uid
    ).first() is not None

    return {
        "uid": target.uid,
        "username": target.username,
        "talent_category": target.interest,
        "business_category": target.business_role,
        "country": target.country,
        "region": target.region,
        "locality": target.locality,
        "date_of_birth": target.date_of_birth.isoformat() if target.date_of_birth else None,
        "joined_at": target.created_at.isoformat() if target.created_at else None,
        "post_count": post_count,
        "klique_status": klique_status,
        "is_following": is_following,
        "is_me": target.uid == current_user.uid,
    }


@router.get("/users/{uid}/posts")
async def get_user_posts(uid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target = db.query(User).filter(User.uid == uid).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    posts = db.query(Post).filter(Post.author_uid == uid).order_by(Post.created_at.desc()).all()
    if not posts:
        return []
    post_ids = [p.id for p in posts]
    comment_counts = dict(
        db.query(Comment.post_id, func.count(Comment.id)).filter(Comment.post_id.in_(post_ids)).group_by(Comment.post_id).all()
    )
    return [serialize_post(p, target, comment_counts.get(p.id, 0)) for p in posts]


@router.get("/users/{uid}/liked-posts")
async def get_user_liked_posts(uid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    reaction_rows = db.query(Reaction).filter(Reaction.uid == uid, Reaction.post_id.isnot(None)).all()
    post_ids = [r.post_id for r in reaction_rows]
    if not post_ids:
        return []
    posts = db.query(Post).filter(Post.id.in_(post_ids)).order_by(Post.created_at.desc()).all()
    author_uids = list({p.author_uid for p in posts})
    authors = {u.uid: u for u in db.query(User).filter(User.uid.in_(author_uids)).all()}
    comment_counts = dict(
        db.query(Comment.post_id, func.count(Comment.id)).filter(Comment.post_id.in_([p.id for p in posts])).group_by(Comment.post_id).all()
    )
    return [serialize_post(p, authors.get(p.author_uid), comment_counts.get(p.id, 0)) for p in posts]


@router.get("/users/{uid}/shared-posts")
async def get_user_shared_posts(uid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target = db.query(User).filter(User.uid == uid).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    posts = db.query(Post).filter(Post.author_uid == uid, Post.content.like("🔁 Shared:%")).order_by(Post.created_at.desc()).all()
    if not posts:
        return []
    post_ids = [p.id for p in posts]
    comment_counts = dict(
        db.query(Comment.post_id, func.count(Comment.id)).filter(Comment.post_id.in_(post_ids)).group_by(Comment.post_id).all()
    )
    return [serialize_post(p, target, comment_counts.get(p.id, 0)) for p in posts]
