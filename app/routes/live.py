"""Live sessions (live video / podcast rooms): hub, create or schedule, start/end/cancel, poll (presence + chat), gifts.

Video joins in a later step. Presence is held in memory (fine for one server instance). The host's last-seen time is
stored in the database, so a server restart never ends a stream by mistake."""

import os
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.economy import LedgerEntry
from app.models.klique import Follow, KliqueRequest
from app.models.live import LiveGift, LiveMessage, LiveSession
from app.models.user import User
from app.services import activity_rewards, rewards, wallet as wallet_service
from app.services.manifest import get_manifest

router = APIRouter(prefix="/live", tags=["live"])

PRESENCE_TTL = 45
HOST_GONE_SECONDS = 300
MAX_SCHEDULED = 10
MAX_CREATED_PER_DAY = 10

PRESENCE: dict = {}
LAST_MSG: dict = {}
LAST_GIFT: dict = {}
_last_reap = {"at": 0.0}


def _dev(uid: str) -> bool:
    raw = os.getenv("HIMATE_DEV_UIDS", "")
    return uid in {x.strip().lstrip("+") for x in raw.split(",") if x.strip()}


def _iso(dt):
    return (dt.isoformat() + "Z") if dt else None


def _age_text(sec: int) -> str:
    return f"{sec // 86400}d {(sec % 86400) // 3600}h {(sec % 3600) // 60}m"


def _kliques(db: Session, uid: str) -> set:
    rows = db.query(KliqueRequest.from_uid, KliqueRequest.to_uid).filter(
        KliqueRequest.status == "accepted",
        or_(KliqueRequest.from_uid == uid, KliqueRequest.to_uid == uid),
    ).all()
    return {(t if f == uid else f) for f, t in rows}


def _get(db: Session, sid: str) -> LiveSession:
    try:
        key = uuid.UUID(sid)
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=404, detail="Not found")
    s = db.query(LiveSession).filter(LiveSession.id == key).first()
    if s is None:
        raise HTTPException(status_code=404, detail="Not found")
    return s


def _check_view(db: Session, s: LiveSession, uid: str) -> None:
    if s.host_uid == uid or s.visibility == "public":
        return
    if s.host_uid not in _kliques(db, uid):
        raise HTTPException(status_code=403, detail="This session is for the host's Kliques only.")


def _touch(sid: str, uid: str) -> None:
    PRESENCE.setdefault(sid, {})[uid] = time.time()


def _viewers(sid: str, host_uid: str) -> int:
    now = time.time()
    return sum(1 for u, t in (PRESENCE.get(sid) or {}).items() if u != host_uid and now - t < PRESENCE_TTL)


def _reap(db: Session) -> None:
    """End live sessions whose host has been silent for a while (throttled to once every 30 seconds)."""
    if time.time() - _last_reap["at"] < 30:
        return
    _last_reap["at"] = time.time()
    now = datetime.utcnow()
    changed = False
    for s in db.query(LiveSession).filter(LiveSession.status == "live").all():
        seen = s.host_seen_at or s.started_at or s.created_at
        if (now - seen).total_seconds() > HOST_GONE_SECONDS:
            s.status = "ended"
            s.ended_at = now
            PRESENCE.pop(str(s.id), None)
            db.add(LiveMessage(session_id=s.id, user_uid=s.host_uid, kind="system", content="The host left. This session has ended."))
            changed = True
    if changed:
        db.commit()


def _session_dict(s: LiveSession, hosts: dict, me: str) -> dict:
    sid = str(s.id)
    host = hosts.get(s.host_uid)
    return {
        "id": sid,
        "host_uid": s.host_uid,
        "host_username": host.username if host else None,
        "kind": s.kind,
        "title": s.title,
        "description": s.description,
        "visibility": s.visibility,
        "status": s.status,
        "scheduled_at": _iso(s.scheduled_at),
        "started_at": _iso(s.started_at),
        "viewers": _viewers(sid, s.host_uid) if s.status == "live" else 0,
        "peak_viewers": int(s.peak_viewers or 0),
        "is_host": s.host_uid == me,
    }


def _msg_dict(r: LiveMessage) -> dict:
    return {"id": int(r.id), "uid": r.user_uid, "username": r.username, "kind": r.kind,
            "content": r.content, "at": _iso(r.created_at)}


def _gift_list(m: dict) -> list:
    on = set(m.get("gifts_v1") or [])
    return [{"id": g["id"], "name": g["name"], "cost": int(g["cost"]), "weight": int(g["weight"])}
            for g in m.get("gifts", []) if g["id"] in on]


def _balance(db: Session, uid: str) -> int:
    wallet_service.release_due(db, uid)
    return int(wallet_service.get_wallet(db, uid).balance)


@router.get("/hub")
def hub(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _reap(db)
    uid = current_user.uid
    now = datetime.utcnow()
    m = get_manifest(db)
    friends = _kliques(db, uid)

    def visible(s):
        return s.visibility == "public" or s.host_uid == uid or s.host_uid in friends

    live = [s for s in db.query(LiveSession).filter(LiveSession.status == "live")
            .order_by(LiveSession.started_at.desc()).limit(60).all() if visible(s)]
    upcoming = [s for s in db.query(LiveSession)
                .filter(LiveSession.status == "scheduled", LiveSession.scheduled_at >= now - timedelta(hours=2))
                .order_by(LiveSession.scheduled_at.asc()).limit(60).all() if visible(s)]
    host_ids = {s.host_uid for s in live + upcoming} or {""}
    hosts = {u.uid: u for u in db.query(User).filter(User.uid.in_(host_ids)).all()}

    g = m["gates"]["host_livestream"]
    followers = db.query(Follow).filter(Follow.followee_uid == uid).count()
    kliques = len(friends)
    dev = _dev(uid)
    return {
        "live": [_session_dict(s, hosts, uid) for s in live],
        "upcoming": [_session_dict(s, hosts, uid) for s in upcoming],
        "gate": {
            "followers": followers, "kliques": kliques,
            "need_followers": int(g["followers"]), "need_kliques": int(g["mutual_kliques"]),
            "ok": dev or (followers >= int(g["followers"]) and kliques >= int(g["mutual_kliques"])),
        },
        "gifts": _gift_list(m),
    }


class SessionIn(BaseModel):
    kind: str = "live"
    title: str = Field(min_length=3, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    visibility: str = "public"
    go_now: bool = True
    scheduled_at: datetime | None = None


@router.post("/sessions")
def create_session(payload: SessionIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    m = get_manifest(db)
    kind = payload.kind.strip().lower()
    if kind not in ("live", "podcast"):
        raise HTTPException(status_code=400, detail="Unknown session type")
    if payload.visibility not in ("public", "kliques"):
        raise HTTPException(status_code=400, detail="Unknown visibility")

    g = m["gates"]["host_livestream"]
    followers = db.query(Follow).filter(Follow.followee_uid == uid).count()
    kliques = len(_kliques(db, uid))
    if not _dev(uid) and (followers < int(g["followers"]) or kliques < int(g["mutual_kliques"])):
        raise HTTPException(
            status_code=403,
            detail=f"Hosting unlocks at {g['followers']} followers and {g['mutual_kliques']} mutual Kliques "
                   f"(you have {followers} and {kliques}).",
        )

    now = datetime.utcnow()
    sched = None
    if not payload.go_now:
        sched = payload.scheduled_at
        if sched is None:
            raise HTTPException(status_code=400, detail="Pick a date and time.")
        if sched.tzinfo is not None:
            sched = sched.astimezone(timezone.utc).replace(tzinfo=None)
        if sched < now + timedelta(minutes=5):
            raise HTTPException(status_code=400, detail="Schedule at least 5 minutes ahead.")
        if sched > now + timedelta(days=30):
            raise HTTPException(status_code=400, detail="You can schedule up to 30 days ahead.")
    if payload.go_now and db.query(LiveSession).filter(LiveSession.host_uid == uid, LiveSession.status == "live").first():
        raise HTTPException(status_code=400, detail="You're already live. End that stream first.")
    if db.query(LiveSession).filter(LiveSession.host_uid == uid, LiveSession.status == "scheduled").count() >= MAX_SCHEDULED:
        raise HTTPException(status_code=400, detail=f"You can have up to {MAX_SCHEDULED} scheduled sessions.")

    counter = activity_rewards._counter(db, uid, rewards.today_for(m), "live_created")
    if counter.amount + 1 > MAX_CREATED_PER_DAY:
        raise HTTPException(status_code=400, detail="Daily session limit reached.")
    counter.amount += 1

    s = LiveSession(
        host_uid=uid, kind=kind, title=payload.title.strip(),
        description=(payload.description or "").strip() or None,
        visibility=payload.visibility,
        status="live" if payload.go_now else "scheduled",
        scheduled_at=sched, started_at=now if payload.go_now else None,
        host_seen_at=now if payload.go_now else None,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _session_dict(s, {uid: current_user}, uid)


def _host_session(db: Session, sid: str, uid: str) -> LiveSession:
    s = _get(db, sid)
    if s.host_uid != uid:
        raise HTTPException(status_code=403, detail="Only the host can do that.")
    return s


@router.post("/sessions/{sid}/start")
def start_session(sid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    s = _host_session(db, sid, uid)
    if s.status != "scheduled":
        raise HTTPException(status_code=400, detail="This session isn't waiting to start.")
    if db.query(LiveSession).filter(LiveSession.host_uid == uid, LiveSession.status == "live").first():
        raise HTTPException(status_code=400, detail="You're already live. End that stream first.")
    now = datetime.utcnow()
    s.status = "live"
    s.started_at = now
    s.host_seen_at = now
    db.add(LiveMessage(session_id=s.id, user_uid=uid, username=current_user.username, kind="system", content="The session started."))
    db.commit()
    return _session_dict(s, {uid: current_user}, uid)


@router.post("/sessions/{sid}/end")
def end_session(sid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    s = _host_session(db, sid, uid)
    if s.status != "live":
        raise HTTPException(status_code=400, detail="This session isn't live.")
    s.status = "ended"
    s.ended_at = datetime.utcnow()
    PRESENCE.pop(str(s.id), None)
    db.add(LiveMessage(session_id=s.id, user_uid=uid, username=current_user.username, kind="system", content="The session has ended."))
    db.commit()
    return _session_dict(s, {uid: current_user}, uid)


@router.post("/sessions/{sid}/cancel")
def cancel_session(sid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    s = _host_session(db, sid, uid)
    if s.status != "scheduled":
        raise HTTPException(status_code=400, detail="Only a scheduled session can be cancelled.")
    s.status = "cancelled"
    db.commit()
    return _session_dict(s, {uid: current_user}, uid)


@router.get("/sessions/{sid}")
def session_details(sid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    s = _get(db, sid)
    _check_view(db, s, uid)
    m = get_manifest(db)
    balance = _balance(db, uid)
    db.commit()
    host = db.query(User).filter(User.uid == s.host_uid).first()
    d = _session_dict(s, {s.host_uid: host} if host else {}, uid)
    d["gifts"] = _gift_list(m)
    d["balance"] = balance
    return d


class PollIn(BaseModel):
    after: int = 0


@router.post("/sessions/{sid}/poll")
def poll(sid: str, payload: PollIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    _reap(db)
    s = _get(db, sid)
    _check_view(db, s, uid)
    now = datetime.utcnow()
    viewers = 0
    if s.status == "live":
        _touch(sid, uid)
        viewers = _viewers(sid, s.host_uid)
        dirty = False
        if uid == s.host_uid and (s.host_seen_at is None or (now - s.host_seen_at).total_seconds() > 30):
            s.host_seen_at = now
            dirty = True
        if viewers > int(s.peak_viewers or 0):
            s.peak_viewers = viewers
            dirty = True
        if dirty:
            db.commit()
    q = db.query(LiveMessage).filter(LiveMessage.session_id == s.id)
    if payload.after > 0:
        rows = q.filter(LiveMessage.id > payload.after).order_by(LiveMessage.id.asc()).limit(100).all()
    else:
        rows = list(reversed(q.order_by(LiveMessage.id.desc()).limit(50).all()))
    return {"status": s.status, "viewers": viewers, "messages": [_msg_dict(r) for r in rows]}


class MsgIn(BaseModel):
    content: str = Field(min_length=1, max_length=300)


@router.post("/sessions/{sid}/messages")
def post_message(sid: str, payload: MsgIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    s = _get(db, sid)
    _check_view(db, s, uid)
    if s.status != "live":
        raise HTTPException(status_code=400, detail="Chat opens when the session is live.")
    now = time.time()
    if now - LAST_MSG.get(uid, 0.0) < 1.0:
        raise HTTPException(status_code=429, detail="Slow down a little.")
    LAST_MSG[uid] = now
    text = payload.content.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write something first.")
    row = LiveMessage(session_id=s.id, user_uid=uid, username=current_user.username, kind="chat", content=text[:300])
    db.add(row)
    db.commit()
    db.refresh(row)
    return _msg_dict(row)


class GiftIn(BaseModel):
    gift_id: str
    request_id: str = Field(min_length=8, max_length=64)


@router.post("/sessions/{sid}/gift")
def send_gift(sid: str, payload: GiftIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    s = _get(db, sid)
    _check_view(db, s, uid)
    if s.status != "live":
        raise HTTPException(status_code=400, detail="Gifts open when the session is live.")
    if s.host_uid == uid:
        raise HTTPException(status_code=400, detail="You can't gift your own session.")

    m = get_manifest(db)
    gift = next((g for g in m.get("gifts", []) if g["id"] == payload.gift_id and g["id"] in (m.get("gifts_v1") or [])), None)
    if gift is None:
        raise HTTPException(status_code=400, detail="That gift isn't available yet.")

    if db.query(LiveGift.id).filter(LiveGift.request_id == payload.request_id).first():
        return {"ok": True, "duplicate": True, "balance": _balance(db, uid),
                "gift": {"id": gift["id"], "name": gift["name"], "cost": int(gift["cost"])}}

    need = int(m["gates"]["gift_min_account_age_seconds"])
    age = (datetime.utcnow() - (current_user.created_at or datetime.utcnow())).total_seconds()
    if age < need and not _dev(uid):
        raise HTTPException(
            status_code=403,
            detail=f"Gifts unlock when your account is {_age_text(need)} old. About {_age_text(int(need - age))} to go.",
        )

    rules = m["gift_rules"]
    now = time.time()
    if now - LAST_GIFT.get(uid, 0.0) < float(rules["min_seconds_between_gifts"]):
        raise HTTPException(status_code=429, detail="Easy there. Wait a moment between gifts.")

    cost = int(gift["cost"])
    today = rewards.today_for(m)
    per_host = activity_rewards._counter(db, uid, today, f"gift_to:{s.host_uid}")
    spent = activity_rewards._counter(db, uid, today, "gift_spend")
    cap_host = int(m["gates"]["gift_daily_cap_per_host"])
    cap_total = int(rules["daily_spend_cap"])
    if per_host.amount + cost > cap_host:
        raise HTTPException(status_code=400, detail=f"Daily limit for this host: {cap_host:,} B.")
    if spent.amount + cost > cap_total:
        raise HTTPException(status_code=400, detail=f"Daily gift limit: {cap_total:,} B.")

    try:
        wallet_service.debit(
            db, uid, cost, "gift_sent", f"gift:{payload.request_id}", manifest_version=m["version"],
            meta={"gift": gift["id"], "session": str(s.id), "host": s.host_uid},
        )
    except wallet_service.InsufficientFunds:
        db.rollback()
        raise HTTPException(status_code=402, detail="Not enough Available Byflints. Pending rewards can't be spent yet.")

    host_gets = cost * int(m["gift_host_share_pct"]) // 100
    wallet_service.credit(
        db, s.host_uid, host_gets, "gift_received", f"giftrecv:{payload.request_id}",
        hold_hours=int(rules["host_credit_hold_hours"]), manifest_version=m["version"],
        meta={"gift": gift["id"], "session": str(s.id), "from": uid},
    )
    burn = cost - host_gets
    if burn > 0:
        db.add(LedgerEntry(user_uid="system:burn", amount=burn, kind="gift_burn", idem=f"giftburn:{payload.request_id}",
                           status="cleared", manifest_version=m["version"], meta={"session": str(s.id)}))
    db.add(LiveGift(session_id=s.id, host_uid=s.host_uid, sender_uid=uid, gift_id=gift["id"], cost=cost,
                    weight=int(gift["weight"]), request_id=payload.request_id))
    db.add(LiveMessage(session_id=s.id, user_uid=uid, username=current_user.username, kind="gift",
                       content=f"sent a {gift['name']}"))
    per_host.amount += cost
    spent.amount += cost
    LAST_GIFT[uid] = now
    balance = _balance(db, uid)
    db.commit()
    return {"ok": True, "balance": balance, "gift": {"id": gift["id"], "name": gift["name"], "cost": cost}}


@router.get("/sessions/{sid}/supporters")
def supporters(sid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = _get(db, sid)
    _check_view(db, s, current_user.uid)
    rows = (
        db.query(LiveGift.sender_uid, func.sum(LiveGift.weight), func.count(LiveGift.id))
        .filter(LiveGift.session_id == s.id)
        .group_by(LiveGift.sender_uid)
        .order_by(func.sum(LiveGift.weight).desc())
        .limit(20)
        .all()
    )
    names = {u.uid: u.username for u in db.query(User).filter(User.uid.in_([r[0] for r in rows] or [""])).all()}
    return [{"uid": r[0], "username": names.get(r[0]), "points": int(r[1] or 0), "gifts": int(r[2] or 0)} for r in rows]
