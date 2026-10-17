"""Sandclock: current state (with any decay charged) and the app-open heartbeat."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.services import rewards, sandclock as engine
from app.services.manifest import get_manifest

router = APIRouter(prefix="/sandclock", tags=["sandclock"])


@router.get("/me")
def sandclock_me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    m = get_manifest(db)
    today = rewards.today_for(m)
    st = rewards.sandclock_state(db, current_user.uid, today)
    engine.apply_decay(st, m, today)
    view = engine.view(st, m, today)
    db.commit()
    return view


@router.post("/active")
def sandclock_active(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return rewards.mark_active(db, current_user.uid)
