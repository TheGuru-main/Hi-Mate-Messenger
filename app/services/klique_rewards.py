"""Klique rewards: one-time Byflint milestones plus Sandclock fill for new Kliques. Safe to call often."""

from datetime import datetime, timedelta

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.economy import LedgerEntry
from app.models.klique import KliqueRequest
from app.models.user import User
from app.services import activity_rewards, reward_rules, rewards, sandclock, wallet


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
    """Returns (paid_now, qualified_count). Each milestone pays once; each Klique fills once."""
    count = qualified_kliques(db, uid, m.get("klique_min_account_age_days", 7))
    today = rewards.today_for(m)
    st = rewards.sandclock_state(db, uid, today)
    fills = m.get("fill") or {}
    paid = 0

    prefix = f"klique_ms:{uid}:"
    claimed = set()
    for (idem,) in db.query(LedgerEntry.idem).filter(LedgerEntry.idem.like(prefix + "%")).all():
        try:
            claimed.add(int(idem[len(prefix):]))
        except ValueError:
            pass
    for d in reward_rules.klique_due(count, claimed, m):
        entry = wallet.credit(
            db, uid, d["payout"], "klique_milestone", f"{prefix}{d['at']}",
            hold_hours=int(m.get("pending_hours", 0)), manifest_version=m["version"],
            meta={"at": d["at"], "count": count},
        )
        if entry is not None:
            paid += d["payout"]
            pct = float((fills.get("klique_milestone") or {}).get(str(d["at"]), 0.0))
            if pct > 0:
                sandclock.add_fill(st, pct, m)

    # fill for newly counted Kliques, capped per day so older accounts don't jump all at once
    per = float(fills.get("klique", 0.0))
    new = count - int(st.klique_filled or 0)
    if per > 0 and new > 0:
        cap = float((m.get("caps") or {}).get("klique_fill_per_day", 1.0))
        row = activity_rewards._counter(db, uid, today, "klique_fill")
        n = min(new, int(max(0.0, cap - row.amount) / per + 1e-9))
        if n > 0:
            sandclock.add_fill(st, n * per, m)
            row.amount += n * per
            st.klique_filled = int(st.klique_filled or 0) + n
    return paid, count
