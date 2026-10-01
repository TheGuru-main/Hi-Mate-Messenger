from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.klique import KliqueRequest, Follow, Fan, Block
from app.models.notification import Notification
from app.services.push import send_push_to_user
from app.schemas.message import KliqueRequestCreate, KliqueActionRequest

router = APIRouter(tags=["klique"])


@router.post("/klique/request")
async def send_klique_request(
    payload: KliqueRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.to_uid == current_user.uid:
        raise HTTPException(status_code=400, detail="Cannot Klique yourself")

    existing = db.query(KliqueRequest).filter(
        KliqueRequest.from_uid == current_user.uid,
        KliqueRequest.to_uid == payload.to_uid,
        KliqueRequest.status == "pending",
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Request already pending")

    request = KliqueRequest(from_uid=current_user.uid, to_uid=payload.to_uid)
    db.add(request)
    db.add(Notification(
        recipient_uid=payload.to_uid, actor_uid=current_user.uid, type="klique_request",
        message=f"{current_user.username} sent you a Klique request",
    ))
    send_push_to_user(db, payload.to_uid, "New Klique request", f"{current_user.username} wants to connect")
    db.commit()
    return {"status": "pending", "request_id": str(request.id)}


@router.post("/klique/accept")
async def accept_klique_request(
    payload: KliqueActionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    request = db.query(KliqueRequest).filter(KliqueRequest.id == payload.request_id).first()
    if not request or request.to_uid != current_user.uid:
        raise HTTPException(status_code=404, detail="Request not found")
    request.status = "accepted"
    db.add(Notification(
        recipient_uid=request.from_uid, actor_uid=current_user.uid, type="klique_accepted",
        message=f"{current_user.username} accepted your Klique request",
    ))
    send_push_to_user(db, request.from_uid, "Klique accepted", f"{current_user.username} accepted your request")
    db.commit()
    return {"status": "accepted"}


@router.get("/klique/pending")
async def list_pending(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(KliqueRequest).filter(
        KliqueRequest.to_uid == current_user.uid,
        KliqueRequest.status == "pending",
    ).all()


@router.get("/klique/list")
async def list_kliques(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(KliqueRequest).filter(
        ((KliqueRequest.from_uid == current_user.uid) | (KliqueRequest.to_uid == current_user.uid)),
        KliqueRequest.status == "accepted",
    ).all()


@router.get("/followers")
async def list_my_followers(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Follow).filter(Follow.followee_uid == current_user.uid).all()
    uids = [r.follower_uid for r in rows]
    if not uids:
        return []
    users = db.query(User).filter(User.uid.in_(uids)).all()
    return [{"uid": u.uid, "username": u.username} for u in users]


@router.post("/follow/{uid}")
async def follow_user(
    uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = db.query(Follow).filter(
        Follow.follower_uid == current_user.uid, Follow.followee_uid == uid
    ).first()
    if existing:
        return {"status": "following"}  # already following — idempotent
    follow = Follow(follower_uid=current_user.uid, followee_uid=uid)
    db.add(follow)
    db.add(Notification(
        recipient_uid=uid, actor_uid=current_user.uid, type="follow",
        message=f"{current_user.username} followed you",
    ))
    send_push_to_user(db, uid, "New follower", f"{current_user.username} followed you")
    db.commit()
    return {"status": "following"}


@router.delete("/follow/{uid}")
async def unfollow_user(
    uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(Follow).filter(
        Follow.follower_uid == current_user.uid, Follow.followee_uid == uid
    ).delete()
    db.commit()
    return {"status": "unfollowed"}


@router.post("/fan/{uid}")
async def become_fan(
    uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    fan = Fan(fan_uid=current_user.uid, target_uid=uid)
    db.add(fan)
    db.commit()
    return {"status": "fan"}


@router.delete("/klique/{uid}")
async def remove_klique(
    uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Cancels a pending request (from either side) or removes an existing
    Klique connection entirely — same endpoint covers both, since the
    frontend just needs "undo whatever Klique state exists with this uid".
    """
    row = db.query(KliqueRequest).filter(
        ((KliqueRequest.from_uid == current_user.uid) & (KliqueRequest.to_uid == uid))
        | ((KliqueRequest.from_uid == uid) & (KliqueRequest.to_uid == current_user.uid))
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="No Klique connection or request found")
    db.delete(row)
    db.commit()
    return {"status": "removed"}


@router.post("/block/{uid}")
async def block_user(
    uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    block = Block(blocker_uid=current_user.uid, blocked_uid=uid)
    db.add(block)
    # Blocking removes any Klique/Follow/Fan state both ways, per locked spec
    db.query(KliqueRequest).filter(
        ((KliqueRequest.from_uid == current_user.uid) & (KliqueRequest.to_uid == uid))
        | ((KliqueRequest.from_uid == uid) & (KliqueRequest.to_uid == current_user.uid))
    ).delete()
    db.query(Follow).filter(
        ((Follow.follower_uid == current_user.uid) & (Follow.followee_uid == uid))
        | ((Follow.follower_uid == uid) & (Follow.followee_uid == current_user.uid))
    ).delete()
    db.add(block)
    db.commit()
    return {"status": "blocked"}
