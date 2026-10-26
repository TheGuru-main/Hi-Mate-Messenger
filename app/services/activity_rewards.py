"""Rewards for feed activity: likes, gems, comments and posts.

Every call is idempotent (ledger idem key), capped per day (economy_counters) and must never break the request
that triggered it. Byflints = base x Sandclock colour boost, held pending; fill goes to the Sandclock."""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.economy import DailyCounter, LedgerEntry
from app.models.media_asset import MediaAsset
from app.models.post import Post
from app.services import reward_rules, rewards, sandclock, wallet
from app.services.manifest import get_manifest

VOICE_BITRATE_BPS = 40000   # only used when a recording carries no length header


def _counter(db: Session, uid: str, day, key: str) -> DailyCounter:
    def fetch():
        return (
            db.query(DailyCounter)
            .filter(DailyCounter.user_uid == uid, DailyCounter.day == day, DailyCounter.key == key)
            .with_for_update()
            .first()
        )

    row = fetch()
    if row is None:
        db.add(DailyCounter(user_uid=uid, day=day, key=key, amount=0.0))
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
        row = fetch()
    return row


def _apply(db, uid, kind, idem, base_b, fill_pct, gates=(), social_b=False, social_fill=False, meta=None, b_caps=()):
    """gates: (counter_key, limit, cost) hard limits. social_b / social_fill clip to the shared daily caps."""
    m = get_manifest(db)
    today = rewards.today_for(m)
    caps = m.get("caps", {})

    if db.query(LedgerEntry.id).filter(LedgerEntry.idem == idem).first():
        return None

    gate_rows = []
    for key, limit, cost in gates:
        row = _counter(db, uid, today, key)
        if row.amount + cost > limit + 1e-9:
            db.rollback()
            return None
        gate_rows.append((row, cost))
    b_row = _counter(db, uid, today, "social_b") if social_b else None
    f_row = _counter(db, uid, today, "social_fill") if social_fill else None
    cap_rows = [(_counter(db, uid, today, key), int(limit)) for key, limit in b_caps]

    st = rewards.sandclock_state(db, uid, today)
    sandclock.apply_decay(st, m, today)
    amount = int(base_b * sandclock.boost(st.color, m))
    if b_row is not None:
        room = int(caps.get("social_byflint_per_day", 15000) - b_row.amount)
        amount = max(0, min(amount, room))
    for row, limit in cap_rows:
        amount = max(0, min(amount, int(limit - row.amount)))
    if amount <= 0:
        db.rollback()
        return None

    fill = float(fill_pct or 0.0)
    if f_row is not None:
        room = float(caps.get("social_fill_pct_per_day", 5.0)) - f_row.amount
        fill = max(0.0, min(fill, room))

    entry = wallet.credit(
        db, uid, amount, kind, idem,
        hold_hours=int(m.get("pending_hours", 0)), manifest_version=m["version"], meta=meta,
    )
    if entry is None:
        db.rollback()
        return None

    if fill > 0:
        sandclock.add_fill(st, fill, m)
    sandclock.mark_active(st, today)
    for row, cost in gate_rows:
        row.amount += cost
    if b_row is not None:
        b_row.amount += amount
    for row, limit in cap_rows:
        row.amount += amount
    if f_row is not None:
        f_row.amount += fill
    db.commit()
    return {"amount": amount, "fill": fill}


def reaction(db: Session, uid: str, post_id, is_gem: bool):
    p = db.query(Post).filter(Post.id == post_id).first()
    if p is None or p.author_uid == uid:
        return None
    m = get_manifest(db)
    meta = {"post": str(p.id), "author": p.author_uid}
    if is_gem:
        return _apply(db, uid, "spot_gem", f"gem:{uid}:{p.id}", m["rewards"]["spot_gem"],
                      m["fill"].get("spot_gem", 0.0), meta=meta)
    return _apply(db, uid, "like", f"like:{uid}:{p.id}", m["rewards"]["like"], m["fill"]["like"],
                  social_b=True, social_fill=True, meta=meta)


def comment(db: Session, uid: str, c):
    p = db.query(Post).filter(Post.id == c.post_id).first()
    if p is None or p.author_uid == uid:
        return None
    if len((c.content or "").strip()) < 3 and not c.media_ref:
        return None
    m = get_manifest(db)
    cap = int(m.get("caps", {}).get("comments_per_target_per_day", 3))
    return _apply(db, uid, "comment", f"comment:{c.id}", m["rewards"]["comment"], m["fill"]["comment"],
                  gates=[(f"cmt:{p.author_uid}", cap, 1)], social_b=True, social_fill=True,
                  meta={"post": str(p.id), "author": p.author_uid})


def _audio_seconds(a):
    if a.duration_seconds:
        return float(a.duration_seconds)
    if a.size_bytes:
        return min(a.size_bytes * 8.0 / VOICE_BITRATE_BPS, 3600.0)
    return None


SHARE_PREFIX = "🔁 Shared:"


def _share_post(db, p, uid, m):
    """A feed share creates a new post. Sharing is unlimited; Byflints stop at caps.share_byflint_per_day."""
    original = (p.content or "")[len(SHARE_PREFIX):].strip()
    if original and db.query(Post.id).filter(Post.author_uid == uid, Post.id != p.id, Post.content == original).first():
        return None   # sharing your own post earns nothing
    refs = [r for r in (p.media_refs or "").split(",") if r]
    if refs and db.query(MediaAsset.id).filter(MediaAsset.media_ref.in_(refs), MediaAsset.owner_uid == uid).first():
        return None
    cap = int(m.get("caps", {}).get("share_byflint_per_day", 117))
    return _apply(db, uid, "share", f"share:{uid}:{p.id}", m["rewards"]["share"], 0.0,
                  b_caps=[("share_b", cap)], meta={"post": str(p.id)})


def post(db: Session, p, uid: str):
    m = get_manifest(db)
    pr = m["post_rewards"]
    if (p.content or "").startswith(SHARE_PREFIX):
        return _share_post(db, p, uid, m)
    refs = [r for r in (p.media_refs or "").split(",") if r]
    if not refs and p.media_ref:
        refs = [p.media_ref]
    assets = {}
    if refs:
        for a in db.query(MediaAsset).filter(MediaAsset.media_ref.in_(refs), MediaAsset.owner_uid == uid).all():
            assets[a.media_ref] = a
    videos, audios, images = [], [], 0
    for r in refs:
        a = assets.get(r)
        if a is None:
            continue
        ct = (a.content_type or "").lower()
        if ct.startswith("video/"):
            videos.append(a)
        elif ct.startswith("audio/"):
            audios.append(a)
        elif ct.startswith("image/"):
            images += 1

    for i, a in enumerate(videos):
        secs = a.duration_seconds
        base = reward_rules.video_reward(secs, m) if secs else 0
        if base > 0:
            _apply(db, uid, "post_video", f"post_video:{p.id}:{i}", base, 0.0,
                   gates=[("videos", pr["video"]["cap_per_day"], 1)],
                   meta={"post": str(p.id), "seconds": secs})
    for i, a in enumerate(audios):
        secs = _audio_seconds(a)
        base = reward_rules.voice_reward(secs, m) if secs else 0
        if base > 0:
            _apply(db, uid, "post_voice", f"post_voice:{p.id}:{i}", base, 0.0,
                   gates=[("voice", pr["voice"]["cap_per_day"], 1)],
                   meta={"post": str(p.id), "seconds": round(secs, 1)})
    if not videos and not audios and (len((p.content or "").strip()) >= 3 or images > 0):
        _apply(db, uid, "post_text", f"post_text:{p.id}", reward_rules.text_reward(m), 0.0,
               gates=[("text", pr["text"]["cap_per_day"], 1)], meta={"post": str(p.id)})


def share(db: Session, uid: str, post_id):
    """Sharing is unlimited; the Byflints from it stop at caps.share_byflint_per_day (117) per account per day."""
    p = db.query(Post).filter(Post.id == post_id).first()
    if p is None or p.author_uid == uid:
        return None
    m = get_manifest(db)
    cap = int(m.get("caps", {}).get("share_byflint_per_day", 117))
    return _apply(db, uid, "share", f"share:{uid}:{p.id}", m["rewards"]["share"], 0.0,
                  b_caps=[("share_b", cap)], meta={"post": str(p.id), "author": p.author_uid})
