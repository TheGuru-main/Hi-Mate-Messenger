from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.notification import Notification

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Notification).filter(Notification.recipient_uid == current_user.uid).order_by(Notification.created_at.desc()).limit(50).all()
    return [
        {
            "id": str(n.id), "type": n.type, "message": n.message,
            "actor_uid": n.actor_uid, "is_read": n.is_read,
            "created_at": n.created_at.isoformat(),
        }
        for n in rows
    ]


@router.post("/{notification_id}/read")
async def mark_read(notification_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    n = db.query(Notification).filter(Notification.id == notification_id, Notification.recipient_uid == current_user.uid).first()
    if n:
        n.is_read = True
        db.commit()
    return {"status": "ok"}


@router.post("/read-all")
async def mark_all_read(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db.query(Notification).filter(Notification.recipient_uid == current_user.uid, Notification.is_read == False).update({"is_read": True})
    db.commit()
    return {"status": "ok"}


@router.get("/unread-count")
async def unread_count(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    count = db.query(Notification).filter(Notification.recipient_uid == current_user.uid, Notification.is_read == False).count()
    return {"count": count}
