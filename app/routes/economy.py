"""Byflint wallet, ledger, manifest and daily check-in."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.economy import LedgerEntry
from app.models.klique import Follow, KliqueRequest
from app.models.user import User
from app.services import rewards, wallet as wallet_service
from app.services.manifest import get_manifest

router = APIRouter(prefix="/economy", tags=["economy"])


def _wallet_payload(db: Session, uid: str, m: dict) -> dict:
    wallet_service.release_due(db, uid)
    w = wallet_service.get_wallet(db, uid)
    balance, pending = int(w.balance), int(w.pending)
    followers = db.query(Follow).filter(Follow.followee_uid == uid).count()
    kliques = db.query(KliqueRequest).filter(
        KliqueRequest.status == "accepted",
        or_(KliqueRequest.from_uid == uid, KliqueRequest.to_uid == uid),
    ).count()
    today = rewards.today_for(m)
    done = db.query(LedgerEntry.id).filter(LedgerEntry.idem == f"checkin:{uid}:{today.isoformat()}").first() is not None
    nxt = db.query(func.min(LedgerEntry.release_at)).filter(
        LedgerEntry.user_uid == uid, LedgerEntry.status == "pending").scalar()
    db.commit()
    rate = float(m["currency"]["naira_per_byflint"])
    return {
        "balance": balance,
        "pending": pending,
        "naira_value": round(balance * rate, 2),
        "pending_naira": round(pending * rate, 2),
        "checked_in": done,
        "followers": followers,
        "kliques": kliques,
        "next_release_at": nxt.isoformat() if nxt else None,
    }


@router.get("/manifest")
def manifest_view(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return get_manifest(db)


@router.get("/wallet")
def wallet_view(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _wallet_payload(db, current_user.uid, get_manifest(db))


@router.get("/ledger")
def ledger_view(limit: int = 30, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = wallet_service.recent(db, current_user.uid, max(1, min(limit, 100)))
    return [
        {
            "amount": int(r.amount),
            "kind": r.kind,
            "status": r.status,
            "release_at": r.release_at.isoformat() if r.release_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/checkin")
def checkin_view(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = rewards.checkin(db, current_user.uid)
    return {"checkin": result, "wallet": _wallet_payload(db, current_user.uid, get_manifest(db))}
