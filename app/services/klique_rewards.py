"""Klique milestone rewards: one-time payouts when your count of qualified mutual Kliques crosses a milestone."""

from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.economy import LedgerEntry
from app.models.klique import KliqueRequest
from app.models.user import User
from app.services import reward_rules, wallet


def qualified_kliques(db: Session, uid: str, min_days: int) -> int:
    rows = db.query(KliqueRequest.from_uid, KliqueRequest.to_uid).filter(
        KliqueRequest.status == "accepted",
        or_(KliqueRequest.from_uid == uid, KliqueRequest.to_uid == uid),
    ).all()
    others = {(t if f == uid else f) for f, t in rows}
    if not others:
        return 0
    cutoff = datetime.utcnow() - timedelta(days=int(min_days))
    return db.query(User.uid).filter(User.uid.in_(list(others)), User.created_at <= cutoff).count()


def claim_klique_milestones(db: Session, uid: str, m: dict):
    """Returns (paid_now, qualified_count). Safe to call often: each milestone pays once (idempotent key)."""
    if not m.get("klique_milestones"):
        return 0, 0
    count = qualified_kliques(db, uid, m.get("klique_min_account_age_days", 7))
    prefix = f"klique_ms:{uid}:"
    claimed = set()
    for (idem,) in db.query(LedgerEntry.idem).filter(LedgerEntry.idem.like(prefix + "%")).all():
        try:
            claimed.add(int(idem[len(prefix):]))
        except ValueError:
            pass
    paid = 0
    for d in reward_rules.klique_due(count, claimed, m):
        entry = wallet.credit(
            db, uid, d["payout"], "klique_milestone", f"{prefix}{d['at']}",
            hold_hours=int(m.get("pending_hours", 0)), manifest_version=m["version"],
            meta={"at": d["at"], "count": count},
        )
        if entry is not None:
            paid += d["payout"]
    return paid, count
