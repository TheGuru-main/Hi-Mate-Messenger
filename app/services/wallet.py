"""Byflint wallet + append-only ledger (whole numbers only). Knows nothing about the Sandclock."""

from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.economy import LedgerEntry, Wallet


class InsufficientFunds(Exception):
    pass


def get_wallet(db: Session, uid: str, lock: bool = False) -> Wallet:
    def fetch():
        q = db.query(Wallet).filter(Wallet.user_uid == uid)
        return (q.with_for_update() if lock else q).first()

    w = fetch()
    if w is None:
        db.add(Wallet(user_uid=uid, balance=0, pending=0))
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
        w = fetch()
    return w


def release_due(db: Session, uid: str, now: datetime | None = None) -> int:
    """Move pending credits whose hold has ended into the spendable balance."""
    now = now or datetime.utcnow()
    w = get_wallet(db, uid, lock=True)
    due = (
        db.query(LedgerEntry)
        .filter(LedgerEntry.user_uid == uid, LedgerEntry.status == "pending", LedgerEntry.release_at <= now)
        .with_for_update()
        .all()
    )
    moved = 0
    for e in due:
        e.status = "cleared"
        w.pending -= e.amount
        w.balance += e.amount
        moved += e.amount
    return moved


def credit(db: Session, uid: str, amount: int, kind: str, idem: str, *,
           hold_hours: int = 0, manifest_version: int | None = None, meta: dict | None = None):
    """Idempotent earn. Returns the new entry, or None if this idem key was already used."""
    if amount <= 0:
        return None
    if db.query(LedgerEntry.id).filter(LedgerEntry.idem == idem).first():
        return None
    w = get_wallet(db, uid, lock=True)
    now = datetime.utcnow()
    if hold_hours > 0:
        entry = LedgerEntry(user_uid=uid, amount=amount, kind=kind, idem=idem, status="pending",
                            release_at=now + timedelta(hours=hold_hours),
                            manifest_version=manifest_version, meta=meta)
        w.pending += amount
    else:
        entry = LedgerEntry(user_uid=uid, amount=amount, kind=kind, idem=idem, status="cleared",
                            manifest_version=manifest_version, meta=meta)
        w.balance += amount
    db.add(entry)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return None
    return entry


def debit(db: Session, uid: str, amount: int, kind: str, idem: str, *,
          manifest_version: int | None = None, meta: dict | None = None):
    """Idempotent spend from the spendable balance. Raises InsufficientFunds."""
    if amount <= 0:
        raise ValueError("amount must be positive")
    existing = db.query(LedgerEntry).filter(LedgerEntry.idem == idem).first()
    if existing:
        return existing
    w = get_wallet(db, uid, lock=True)
    if w.balance < amount:
        raise InsufficientFunds()
    w.balance -= amount
    entry = LedgerEntry(user_uid=uid, amount=-amount, kind=kind, idem=idem, status="cleared",
                        manifest_version=manifest_version, meta=meta)
    db.add(entry)
    db.flush()
    return entry


def recent(db: Session, uid: str, limit: int = 30):
    return (
        db.query(LedgerEntry)
        .filter(LedgerEntry.user_uid == uid)
        .order_by(LedgerEntry.created_at.desc())
        .limit(limit)
        .all()
    )
