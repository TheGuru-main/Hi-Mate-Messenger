"""Profile summary numbers (Kliques, followers, following, gems received, gigs completed) and Edu details."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.jobs import JobBid, JobPost
from app.models.klique import Follow, KliqueRequest
from app.models.post import Post, Reaction
from app.models.user import User

router = APIRouter(tags=["profile-extras"])

GEM = "💎"
SCORE_COMPLETED = 100
SCORE_WON = 250


def _friends(db: Session, uid: str) -> set:
    rows = db.query(KliqueRequest.from_uid, KliqueRequest.to_uid).filter(
        KliqueRequest.status == "accepted",
        or_(KliqueRequest.from_uid == uid, KliqueRequest.to_uid == uid),
    ).all()
    return {(t if f == uid else f) for f, t in rows}


@router.get("/profile-extras/{uid}")
def profile_extras(uid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.uid == uid).first()
    if user is None:
        raise HTTPException(status_code=404, detail="Not found")
    friends = _friends(db, uid)
    followers = db.query(func.count(Follow.id)).filter(Follow.followee_uid == uid).scalar() or 0
    following = db.query(func.count(Follow.id)).filter(Follow.follower_uid == uid).scalar() or 0
    gems = (
        db.query(func.count(Reaction.id))
        .join(Post, Post.id == Reaction.post_id)
        .filter(Post.author_uid == uid, Reaction.emoji == GEM)
        .scalar() or 0
    )
    completed = (
        db.query(func.count(JobBid.id))
        .join(JobPost, JobPost.id == JobBid.job_id)
        .filter(JobBid.bidder_uid == uid, JobBid.status == "hired", JobPost.state.in_(["filled", "closed"]))
        .scalar() or 0
    )
    won = 0   # contest wins arrive with paid contests
    edu = None
    if uid == current_user.uid or current_user.uid in friends:
        edu = {
            "level": user.education_level, "school": user.edu_school_name, "class": user.edu_class,
            "stage": user.edu_stage, "name": user.edu_display_name,
        }
    return {
        "kliques": len(friends), "followers": int(followers), "following": int(following),
        "gems": int(gems), "gigs_completed": int(completed),
        "gig_score": int(completed) * SCORE_COMPLETED + won * SCORE_WON,
        "edu": edu,
    }
