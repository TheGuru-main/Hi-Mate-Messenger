from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.klique import KliqueRequest, Follow, Fan, Block
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


@router.post("/follow/{uid}")
async def follow_user(
    uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    follow = Follow(follower_uid=current_user.uid, followee_uid=uid)
    db.add(follow)
    db.commit()
    return {"status": "following"}


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
