"""Orchestrates one activity into its two independent effects: Byflints (wallet) and fill (Sandclock)."""

from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.economy import SandclockState
from app.services import sandclock, wallet
from app.services.manifest import get_manifest


def today_for(m: dict, now: datetime | None = None):
    now = now or datetime.utcnow()
    return (now + timedelta(minutes=int(m.get("day_offset_minutes", 0)))).date()


def sandclock_state(db: Session, uid: str, today, lock: bool = True) -> SandclockState:
    def fetch():
        q = db.query(SandclockState).filter(SandclockState.user_uid == uid)
        return (q.with_for_update() if lock else q).first()

    st = fetch()
    if st is None:
        db.add(SandclockState(user_uid=uid, color=1, fill=0.0, level=0, last_active_day=today, decay_steps=0))
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
        st = fetch()
    return st


def mark_active(db: Session, uid: str) -> dict:
    """App-open heartbeat: charge any decay that is due, then reset the idle clock. No reward, no fill."""
    m = get_manifest(db)
    today = today_for(m)
    st = sandclock_state(db, uid, today)
    sandclock.apply_decay(st, m, today)
    sandclock.mark_active(st, today)
    view = sandclock.view(st, m, today)
    db.commit()
    return view


def checkin(db: Session, uid: str) -> dict:
    """Daily check-in: base Byflints x colour boost (held pending), +fill, resets decay. Once per day."""
    m = get_manifest(db)
    today = today_for(m)
    st = sandclock_state(db, uid, today)
    sandclock.apply_decay(st, m, today)

    b = sandclock.boost(st.color, m)
    base = int(m["checkin"]["byflint"])
    amount = int(base * b)
    entry = wallet.credit(
        db, uid, amount, "checkin", f"checkin:{uid}:{today.isoformat()}",
        hold_hours=int(m.get("pending_hours", 0)), manifest_version=m["version"],
        meta={"base": base, "boost": b},
    )
    fresh = entry is not None
    if fresh:
        sandclock.add_fill(st, float(m["checkin"]["fill_pct"]), m)
    sandclock.mark_active(st, today)
    view = sandclock.view(st, m, today)
    db.commit()
    return {"already": not fresh, "amount": amount if fresh else 0, "sandclock": view}
