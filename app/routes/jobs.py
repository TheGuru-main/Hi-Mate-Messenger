"""Jobs board: job opportunities and vacancy statuses, bids with attached portfolio, comments with pins, poster tools."""

import re
import uuid
from datetime import date, datetime, time as dtime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.jobs import JobBid, JobComment, JobPost
from app.models.klique import KliqueRequest
from app.models.portfolio import Credential, PortfolioItem
from app.models.user import User
from app.routes.devtools import _is_dev
from app.routes.portfolio import _cred_dict, _item_dict, _owned_asset, _signed
from app.services import activity_rewards, rewards
from app.services.manifest import get_manifest

router = APIRouter(prefix="/jobs", tags=["jobs"])

JOB_TYPES = {"full_time", "part_time", "contract", "one_off", "internship", "volunteer"}
DURATIONS = {"24h": 86400, "3d": 259200, "1w": 604800}
STATES = {"open", "shortlisting", "filled", "closed"}
BID_STATUSES = {"shortlisted", "hired", "declined"}


def _iso(dt):
    return (dt.isoformat() + "Z") if dt else None


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Not found")


def _job(db: Session, jid) -> JobPost:
    j = db.query(JobPost).filter(JobPost.id == _uuid(jid)).first()
    if j is None:
        raise HTTPException(status_code=404, detail="Not found")
    return j


def _users(db: Session, uids) -> dict:
    uids = {u for u in uids if u}
    if not uids:
        return {}
    return {u.uid: u for u in db.query(User).filter(User.uid.in_(list(uids))).all()}


def _friends(db: Session, uid: str) -> set:
    rows = db.query(KliqueRequest.from_uid, KliqueRequest.to_uid).filter(
        KliqueRequest.status == "accepted",
        or_(KliqueRequest.from_uid == uid, KliqueRequest.to_uid == uid),
    ).all()
    return {(t if f == uid else f) for f, t in rows}


def _kstate(db: Session, me: str, other: str) -> str:
    if me == other:
        return "self"
    r = db.query(KliqueRequest).filter(or_(
        and_(KliqueRequest.from_uid == me, KliqueRequest.to_uid == other),
        and_(KliqueRequest.from_uid == other, KliqueRequest.to_uid == me),
    )).first()
    if r is None:
        return "none"
    if r.status == "accepted":
        return "accepted"
    if r.status == "pending":
        return "pending_out" if r.from_uid == me else "pending_in"
    return "none"


def _csv_uuids(csv):
    out = []
    for part in (csv or "").split(","):
        part = part.strip()
        if part:
            try:
                out.append(uuid.UUID(part))
            except ValueError:
                pass
    return out


def _owned_items(db: Session, uid: str, ids):
    keys = []
    for i in ids:
        try:
            keys.append(uuid.UUID(str(i)))
        except ValueError:
            raise HTTPException(status_code=400, detail="Bad attachment.")
    if not keys:
        return []
    rows = db.query(PortfolioItem).filter(PortfolioItem.id.in_(keys), PortfolioItem.owner_uid == uid).all()
    if len(rows) != len(set(keys)):
        raise HTTPException(status_code=400, detail="Some attachments weren't found.")
    return rows


def _owned_creds(db: Session, uid: str, ids):
    keys = []
    for i in ids:
        try:
            keys.append(uuid.UUID(str(i)))
        except ValueError:
            raise HTTPException(status_code=400, detail="Bad attachment.")
    if not keys:
        return []
    rows = db.query(Credential).filter(Credential.id.in_(keys), Credential.owner_uid == uid).all()
    if len(rows) != len(set(keys)):
        raise HTTPException(status_code=400, detail="Some attachments weren't found.")
    return rows


def _attached(db: Session, owner: str, items_csv, creds_csv):
    ids, cids = _csv_uuids(items_csv), _csv_uuids(creds_csv)
    items = db.query(PortfolioItem).filter(PortfolioItem.id.in_(ids), PortfolioItem.owner_uid == owner).all() if ids else []
    creds = db.query(Credential).filter(Credential.id.in_(cids), Credential.owner_uid == owner).all() if cids else []
    return [_item_dict(i) for i in items], [_cred_dict(c) for c in creds]


def _job_dict(j: JobPost, users: dict, bids=None) -> dict:
    p = users.get(j.poster_uid)
    return {
        "id": str(j.id), "kind": j.kind, "title": j.title,
        "category_type": j.category_type, "category_code": j.category_code, "job_type": j.job_type,
        "country": j.country, "region": j.region, "locality": j.locality, "remote": bool(j.remote),
        "description": j.description, "requirements": j.requirements, "pay_text": j.pay_text,
        "deadline": j.deadline.isoformat() if j.deadline else None,
        "state": j.state, "expires_at": _iso(j.expires_at), "created_at": _iso(j.created_at),
        "poster_uid": j.poster_uid, "poster_username": p.username if p else None,
        "media": [_signed(r) for r in (j.media_refs or "").split(",") if r],
        "bids": bids,
    }


@router.get("")
def list_jobs(kind: str | None = None, scope: str = "global", q: str | None = None, mine: bool = False,
              offset: int = 0, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    now = datetime.utcnow()
    query = db.query(JobPost)
    if mine:
        query = query.filter(JobPost.poster_uid == current_user.uid)
    else:
        query = query.filter(JobPost.state != "closed", or_(JobPost.expires_at.is_(None), JobPost.expires_at > now))
        if scope == "country" and current_user.country:
            query = query.filter(or_(JobPost.country == current_user.country, JobPost.remote.is_(True)))
        elif scope == "community" and current_user.locality:
            query = query.filter(JobPost.locality == current_user.locality)
    if kind in ("opportunity", "status"):
        query = query.filter(JobPost.kind == kind)
    term = (q or "").strip()[:50]
    if term:
        like = f"%{term}%"
        query = query.filter(or_(JobPost.title.ilike(like), JobPost.description.ilike(like)))
    rows = query.order_by(JobPost.created_at.desc()).offset(max(0, offset)).limit(30).all()
    users = _users(db, {r.poster_uid for r in rows})
    counts = {}
    if rows:
        counts = dict(db.query(JobBid.job_id, func.count(JobBid.id))
                      .filter(JobBid.job_id.in_([r.id for r in rows])).group_by(JobBid.job_id).all())
    return [_job_dict(r, users, counts.get(r.id, 0) if r.poster_uid == current_user.uid else None) for r in rows]


class JobIn(BaseModel):
    kind: str = "opportunity"
    title: str = Field(min_length=3, max_length=120)
    category_type: str | None = None
    category_code: str | None = Field(default=None, max_length=2)
    job_type: str | None = None
    remote: bool = False
    description: str | None = Field(default=None, max_length=3000)
    requirements: str | None = Field(default=None, max_length=2000)
    pay_text: str | None = Field(default=None, max_length=80)
    deadline: date | None = None
    duration: str | None = None
    media_refs: list[str] = []


@router.post("")
def create_job(payload: JobIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    m = get_manifest(db)
    cfg = m["jobs"]
    kind = payload.kind.strip().lower()
    if kind not in ("opportunity", "status"):
        raise HTTPException(status_code=400, detail="Unknown post type")
    age_days = (datetime.utcnow() - (current_user.created_at or datetime.utcnow())).days
    if age_days < int(cfg["poster_min_account_age_days"]) and not _is_dev(uid):
        raise HTTPException(status_code=403, detail=f"Posting opens when your account is {cfg['poster_min_account_age_days']} days old.")
    if payload.category_type not in (None, "talent", "business"):
        raise HTTPException(status_code=400, detail="Unknown category type")
    code = (payload.category_code or "").strip().upper()[:1] or None

    now = datetime.utcnow()
    expires = None
    job_type = None
    if kind == "opportunity":
        job_type = (payload.job_type or "").strip().lower()
        if job_type not in JOB_TYPES:
            raise HTTPException(status_code=400, detail="Pick a job type.")
        if len((payload.description or "").strip()) < 10:
            raise HTTPException(status_code=400, detail="Describe the job (at least 10 characters).")
        if payload.deadline:
            if payload.deadline < now.date():
                raise HTTPException(status_code=400, detail="The deadline is in the past.")
            expires = datetime.combine(payload.deadline, dtime(23, 59, 59))
    else:
        dur = payload.duration or "3d"
        if dur not in DURATIONS:
            raise HTTPException(status_code=400, detail="Pick how long the status stays up.")
        expires = now + timedelta(seconds=DURATIONS[dur])
    refs = [r.strip() for r in payload.media_refs if r and r.strip()][:3]
    for ref in refs:
        _owned_asset(db, ref, uid, ("image/", "video/"))

    counter = activity_rewards._counter(db, uid, rewards.today_for(m), "job_posts")
    if counter.amount + 1 > int(cfg["posts_per_day"]):
        raise HTTPException(status_code=400, detail=f"Daily posting limit reached ({cfg['posts_per_day']}).")
    counter.amount += 1

    job = JobPost(
        poster_uid=uid, kind=kind, title=payload.title.strip(),
        category_type=payload.category_type, category_code=code, job_type=job_type,
        country=current_user.country, region=current_user.region, locality=current_user.locality,
        remote=bool(payload.remote),
        description=(payload.description or "").strip() or None,
        requirements=(payload.requirements or "").strip() or None,
        pay_text=(payload.pay_text or "").strip() or None,
        deadline=payload.deadline if kind == "opportunity" else None,
        media_refs=",".join(refs) or None, state="open", expires_at=expires,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _job_dict(job, {uid: current_user}, 0)


def _bid_dict(db: Session, b: JobBid, users: dict) -> dict:
    items, creds = _attached(db, b.bidder_uid, b.item_ids, b.cred_ids)
    u = users.get(b.bidder_uid)
    return {"id": str(b.id), "bidder_uid": b.bidder_uid, "bidder_username": u.username if u else None,
            "proposal": b.proposal, "rate_text": b.rate_text, "status": b.status,
            "items": items, "credentials": creds, "created_at": _iso(b.created_at)}


def _comment_dict(db: Session, c: JobComment, users: dict) -> dict:
    items, _ = _attached(db, c.author_uid, c.item_ids, "")
    u = users.get(c.author_uid)
    mentions = []
    for mu in (c.mention_uids or "").split(","):
        if mu and users.get(mu):
            mentions.append({"uid": mu, "username": users[mu].username})
    return {"id": str(c.id), "author_uid": c.author_uid, "author_username": u.username if u else None,
            "content": c.content, "items": items, "mentions": mentions, "pinned": bool(c.pinned),
            "created_at": _iso(c.created_at)}


@router.get("/{jid}")
def job_detail(jid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    j = _job(db, jid)
    is_poster = j.poster_uid == uid
    bids = db.query(JobBid).filter(JobBid.job_id == j.id).order_by(JobBid.created_at.asc()).all()
    comments = (db.query(JobComment).filter(JobComment.job_id == j.id)
                .order_by(JobComment.pinned.desc(), JobComment.created_at.asc()).limit(150).all())
    ids = {j.poster_uid} | {b.bidder_uid for b in bids} | {c.author_uid for c in comments}
    for c in comments:
        ids |= {x for x in (c.mention_uids or "").split(",") if x}
    users = _users(db, ids)
    mine = next((b for b in bids if b.bidder_uid == uid), None)
    return {
        "job": _job_dict(j, users, len(bids) if is_poster else None),
        "is_poster": is_poster,
        "poster_klique": _kstate(db, uid, j.poster_uid),
        "my_bid": _bid_dict(db, mine, users) if mine else None,
        "bids": [_bid_dict(db, b, users) for b in bids] if is_poster else [],
        "comments": [_comment_dict(db, c, users) for c in comments],
    }


class StateIn(BaseModel):
    state: str


@router.post("/{jid}/state")
def set_state(jid: str, payload: StateIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    j = _job(db, jid)
    if j.poster_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="Only the poster can do that.")
    if payload.state not in STATES:
        raise HTTPException(status_code=400, detail="Unknown status")
    j.state = payload.state
    db.commit()
    return {"state": j.state}


class BidIn(BaseModel):
    proposal: str = Field(min_length=10, max_length=2000)
    rate_text: str | None = Field(default=None, max_length=60)
    item_ids: list[str] = []
    cred_ids: list[str] = []


@router.post("/{jid}/bids")
def create_bid(jid: str, payload: BidIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    j = _job(db, jid)
    m = get_manifest(db)
    cfg = m["jobs"]
    if j.poster_uid == uid:
        raise HTTPException(status_code=400, detail="You can't bid on your own post.")
    if j.state not in ("open", "shortlisting") or (j.expires_at and j.expires_at < datetime.utcnow()):
        raise HTTPException(status_code=400, detail="This post isn't taking bids.")
    if db.query(JobBid.id).filter(JobBid.job_id == j.id, JobBid.bidder_uid == uid).first():
        raise HTTPException(status_code=400, detail="You already bid on this.")
    items = _owned_items(db, uid, payload.item_ids)
    creds = _owned_creds(db, uid, payload.cred_ids)
    if len(items) + len(creds) > int(cfg["bid_max_attachments"]):
        raise HTTPException(status_code=400, detail=f"You can attach up to {cfg['bid_max_attachments']}.")
    counter = activity_rewards._counter(db, uid, rewards.today_for(m), "job_bids")
    if counter.amount + 1 > int(cfg["bids_per_day"]):
        raise HTTPException(status_code=400, detail=f"Daily bid limit reached ({cfg['bids_per_day']}).")
    counter.amount += 1
    db.add(JobBid(
        job_id=j.id, bidder_uid=uid, proposal=payload.proposal.strip(),
        rate_text=(payload.rate_text or "").strip() or None,
        item_ids=",".join(str(i.id) for i in items) or None,
        cred_ids=",".join(str(c.id) for c in creds) or None,
    ))
    db.commit()
    return {"ok": True}


@router.delete("/{jid}/bids/mine")
def withdraw_bid(jid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    j = _job(db, jid)
    db.query(JobBid).filter(JobBid.job_id == j.id, JobBid.bidder_uid == current_user.uid).delete()
    db.commit()
    return {"ok": True}


class BidStatusIn(BaseModel):
    status: str


@router.post("/{jid}/bids/{bid_id}/status")
def set_bid_status(jid: str, bid_id: str, payload: BidStatusIn, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    j = _job(db, jid)
    if j.poster_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="Only the poster can do that.")
    if payload.status not in BID_STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    b = db.query(JobBid).filter(JobBid.id == _uuid(bid_id), JobBid.job_id == j.id).first()
    if b is None:
        raise HTTPException(status_code=404, detail="Not found")
    b.status = payload.status
    db.commit()
    return {"status": b.status}


class CommentIn(BaseModel):
    content: str = Field(min_length=1, max_length=800)
    item_ids: list[str] = []


@router.post("/{jid}/comments")
def add_comment(jid: str, payload: CommentIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    j = _job(db, jid)
    m = get_manifest(db)
    text = payload.content.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write something first.")
    items = _owned_items(db, uid, payload.item_ids)
    if len(items) > 3:
        raise HTTPException(status_code=400, detail="You can pin up to 3 portfolio items.")
    counter = activity_rewards._counter(db, uid, rewards.today_for(m), "job_comments")
    if counter.amount + 1 > 40:
        raise HTTPException(status_code=400, detail="Daily comment limit reached.")
    counter.amount += 1
    names = {n.lower() for n in re.findall(r"@([A-Za-z0-9_.\-]{2,30})", text)}
    mention_uids = []
    if names:
        friends = _friends(db, uid)
        if friends:
            for u in db.query(User).filter(User.uid.in_(list(friends))).all():
                if (u.username or "").lower() in names:
                    mention_uids.append(u.uid)
    db.add(JobComment(job_id=j.id, author_uid=uid, content=text,
                      item_ids=",".join(str(i.id) for i in items) or None,
                      mention_uids=",".join(mention_uids[:5]) or None))
    db.commit()
    return {"ok": True}


@router.post("/{jid}/comments/{cid}/pin")
def pin_comment(jid: str, cid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    j = _job(db, jid)
    if j.poster_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="Only the poster can do that.")
    c = db.query(JobComment).filter(JobComment.id == _uuid(cid), JobComment.job_id == j.id).first()
    if c is None:
        raise HTTPException(status_code=404, detail="Not found")
    if not c.pinned:
        limit = int(get_manifest(db)["jobs"]["comment_pins_max"])
        if db.query(JobComment).filter(JobComment.job_id == j.id, JobComment.pinned.is_(True)).count() >= limit:
            raise HTTPException(status_code=400, detail=f"You can pin up to {limit} comments.")
    c.pinned = not c.pinned
    db.commit()
    return {"pinned": bool(c.pinned)}


@router.delete("/{jid}/comments/{cid}")
def delete_comment(jid: str, cid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    j = _job(db, jid)
    c = db.query(JobComment).filter(JobComment.id == _uuid(cid), JobComment.job_id == j.id).first()
    if c is None:
        raise HTTPException(status_code=404, detail="Not found")
    if c.author_uid != current_user.uid and j.poster_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="Not allowed.")
    db.delete(c)
    db.commit()
    return {"ok": True}
