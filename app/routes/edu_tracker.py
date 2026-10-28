"""Edu study tracker (E1): courses/subjects with topic checklists, exam and deadline countdowns, study log with streaks."""

import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.edu import EduCourse, EduTask, EduTopic
from app.models.edu_journal import EduJournalEntry
from app.models.user import User
from app.services import rewards
from app.services.manifest import get_manifest

router = APIRouter(prefix="/edu", tags=["edu-tracker"])

MAX_COURSES = 30
MAX_TOPICS = 300
MAX_TASKS = 200
WEEK_GOAL_MINUTES = 150
STATUSES = ("todo", "learning", "revised", "mastered")
WEIGHT = {"todo": 0, "learning": 25, "revised": 60, "mastered": 100}
TASK_KINDS = ("exam", "test", "assignment", "project")


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail="Not found")


def _iso(dt):
    return (dt.isoformat() + "Z") if dt else None


def _course(db: Session, cid, uid: str) -> EduCourse:
    c = db.query(EduCourse).filter(EduCourse.id == _uuid(cid), EduCourse.uid == uid).first()
    if c is None:
        raise HTTPException(status_code=404, detail="Not found")
    return c


def _streaks(days: set, today):
    cur = 0
    d = today if today in days else today - timedelta(days=1)
    while d in days:
        cur += 1
        d -= timedelta(days=1)
    best, run, prev = 0, 0, None
    for d in sorted(days):
        run = run + 1 if prev is not None and (d - prev).days == 1 else 1
        best = max(best, run)
        prev = d
    return cur, best


def _pct(counts: dict) -> int:
    total = sum(counts.values())
    if not total:
        return 0
    return round(sum(WEIGHT.get(k, 0) * v for k, v in counts.items()) / total)


def _clean_topics(items, limit=100):
    out, seen = [], set()
    for t in items or []:
        t = (t or "").strip()[:120]
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
        if len(out) >= limit:
            break
    return out


def _task_dict(t: EduTask, names: dict) -> dict:
    return {"id": str(t.id), "title": t.title, "kind": t.kind, "due": t.due.isoformat(), "done": bool(t.done),
            "course": names.get(t.course_id)}


@router.get("/overview")
def overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    m = get_manifest(db)
    today = rewards.today_for(m)
    off = timedelta(minutes=int(m.get("day_offset_minutes", 0)))
    since = datetime.utcnow() - timedelta(days=400)
    rows = (db.query(EduJournalEntry.created_at, EduJournalEntry.minutes, EduJournalEntry.course_id)
            .filter(EduJournalEntry.uid == uid, EduJournalEntry.created_at >= since).all())

    days, week_minutes, course_week = set(), 0, {}
    week_start = today - timedelta(days=6)
    for created, minutes, course_id in rows:
        d = (created + off).date()
        days.add(d)
        if d >= week_start:
            mins = int(minutes or 0)
            week_minutes += mins
            if course_id is not None:
                course_week[course_id] = course_week.get(course_id, 0) + mins
    current, best = _streaks(days, today)

    courses = db.query(EduCourse).filter(EduCourse.uid == uid).order_by(EduCourse.created_at.asc()).all()
    counts = {}
    for cid, status, n in (db.query(EduTopic.course_id, EduTopic.status, func.count(EduTopic.id))
                           .filter(EduTopic.uid == uid).group_by(EduTopic.course_id, EduTopic.status).all()):
        counts.setdefault(cid, {s: 0 for s in STATUSES})[status] = int(n)
    out = []
    for c in courses:
        cc = counts.get(c.id, {s: 0 for s in STATUSES})
        out.append({"id": str(c.id), "name": c.name, "code": c.code, "kind": c.kind, "credit_units": c.credit_units,
                    "topics": sum(cc.values()), "mastered": cc.get("mastered", 0), "progress": _pct(cc),
                    "minutes_week": course_week.get(c.id, 0)})

    names = {c.id: c.name for c in courses}
    tasks = (db.query(EduTask).filter(EduTask.uid == uid, EduTask.done.is_(False), EduTask.due <= today + timedelta(days=7))
             .order_by(EduTask.due.asc()).limit(15).all())
    exam = (db.query(EduTask).filter(EduTask.uid == uid, EduTask.done.is_(False), EduTask.kind == "exam", EduTask.due >= today)
            .order_by(EduTask.due.asc()).first())
    return {
        "streak": {"current": current, "best": best, "today_done": today in days},
        "week": {"minutes": week_minutes, "goal": WEEK_GOAL_MINUTES},
        "next_exam": _task_dict(exam, names) if exam else None,
        "due_soon": [_task_dict(t, names) for t in tasks],
        "courses": out,
    }


class CourseIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    code: str | None = Field(default=None, max_length=20)
    kind: str = "subject"
    credit_units: int | None = Field(default=None, ge=0, le=30)
    topics: list[str] = []


@router.post("/courses")
def create_course(payload: CourseIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    if payload.kind not in ("subject", "course"):
        raise HTTPException(status_code=400, detail="Unknown type")
    if (db.query(func.count(EduCourse.id)).filter(EduCourse.uid == uid).scalar() or 0) >= MAX_COURSES:
        raise HTTPException(status_code=400, detail=f"You can add up to {MAX_COURSES} subjects or courses.")
    c = EduCourse(uid=uid, name=payload.name.strip(), code=(payload.code or "").strip() or None,
                  kind=payload.kind, credit_units=payload.credit_units)
    db.add(c)
    db.flush()
    for i, title in enumerate(_clean_topics(payload.topics)):
        db.add(EduTopic(course_id=c.id, uid=uid, title=title, position=i))
    db.commit()
    return {"id": str(c.id)}


@router.get("/courses/{cid}")
def course_detail(cid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    c = _course(db, cid, uid)
    topics = (db.query(EduTopic).filter(EduTopic.course_id == c.id)
              .order_by(EduTopic.position.asc(), EduTopic.updated_at.asc()).all())
    tasks = (db.query(EduTask).filter(EduTask.course_id == c.id, EduTask.uid == uid)
             .order_by(EduTask.done.asc(), EduTask.due.asc()).all())
    minutes = (db.query(func.coalesce(func.sum(EduJournalEntry.minutes), 0))
               .filter(EduJournalEntry.uid == uid, EduJournalEntry.course_id == c.id).scalar())
    recent = (db.query(EduJournalEntry).filter(EduJournalEntry.uid == uid, EduJournalEntry.course_id == c.id)
              .order_by(EduJournalEntry.created_at.desc()).limit(5).all())
    cc = {s: 0 for s in STATUSES}
    for t in topics:
        cc[t.status] = cc.get(t.status, 0) + 1
    return {
        "course": {"id": str(c.id), "name": c.name, "code": c.code, "kind": c.kind, "credit_units": c.credit_units},
        "progress": _pct(cc), "counts": cc,
        "topics": [{"id": str(t.id), "title": t.title, "status": t.status} for t in topics],
        "tasks": [_task_dict(t, {c.id: c.name}) for t in tasks],
        "minutes_total": int(minutes or 0),
        "recent": [{"content": e.content, "minutes": e.minutes, "at": _iso(e.created_at)} for e in recent],
    }


@router.delete("/courses/{cid}")
def delete_course(cid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    c = _course(db, cid, uid)
    db.query(EduTopic).filter(EduTopic.course_id == c.id).delete()
    db.query(EduTask).filter(EduTask.course_id == c.id, EduTask.uid == uid).delete()
    db.query(EduJournalEntry).filter(EduJournalEntry.uid == uid, EduJournalEntry.course_id == c.id).update(
        {"course_id": None, "topic_id": None})
    db.delete(c)
    db.commit()
    return {"deleted": True}


class TopicsIn(BaseModel):
    titles: list[str]


@router.post("/courses/{cid}/topics")
def add_topics(cid: str, payload: TopicsIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    c = _course(db, cid, uid)
    existing = db.query(EduTopic).filter(EduTopic.course_id == c.id).all()
    have = {e.title.lower() for e in existing}
    titles = [t for t in _clean_topics(payload.titles, 50) if t.lower() not in have]
    if len(existing) + len(titles) > MAX_TOPICS:
        raise HTTPException(status_code=400, detail=f"A subject can have up to {MAX_TOPICS} topics.")
    pos = max([e.position for e in existing], default=-1) + 1
    for i, t in enumerate(titles):
        db.add(EduTopic(course_id=c.id, uid=uid, title=t, position=pos + i))
    db.commit()
    return {"added": len(titles)}


class StatusIn(BaseModel):
    status: str


@router.post("/topics/{tid}")
def set_topic(tid: str, payload: StatusIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(EduTopic).filter(EduTopic.id == _uuid(tid), EduTopic.uid == current_user.uid).first()
    if t is None:
        raise HTTPException(status_code=404, detail="Not found")
    if payload.status not in STATUSES:
        raise HTTPException(status_code=400, detail="Unknown status")
    t.status = payload.status
    db.commit()
    return {"status": t.status}


@router.delete("/topics/{tid}")
def delete_topic(tid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(EduTopic).filter(EduTopic.id == _uuid(tid), EduTopic.uid == current_user.uid).first()
    if t is None:
        raise HTTPException(status_code=404, detail="Not found")
    db.query(EduJournalEntry).filter(EduJournalEntry.uid == current_user.uid, EduJournalEntry.topic_id == t.id).update(
        {"topic_id": None})
    db.delete(t)
    db.commit()
    return {"deleted": True}


class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    kind: str = "assignment"
    due: date
    course_id: str | None = None


@router.post("/tasks")
def create_task(payload: TaskIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    if payload.kind not in TASK_KINDS:
        raise HTTPException(status_code=400, detail="Unknown type")
    cid = _course(db, payload.course_id, uid).id if payload.course_id else None
    if (db.query(func.count(EduTask.id)).filter(EduTask.uid == uid).scalar() or 0) >= MAX_TASKS:
        raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_TASKS} deadlines. Delete old ones first.")
    t = EduTask(uid=uid, course_id=cid, title=payload.title.strip(), kind=payload.kind, due=payload.due)
    db.add(t)
    db.commit()
    return {"id": str(t.id)}


@router.post("/tasks/{tid}/toggle")
def toggle_task(tid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(EduTask).filter(EduTask.id == _uuid(tid), EduTask.uid == current_user.uid).first()
    if t is None:
        raise HTTPException(status_code=404, detail="Not found")
    t.done = not t.done
    db.commit()
    return {"done": bool(t.done)}


@router.delete("/tasks/{tid}")
def delete_task(tid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    t = db.query(EduTask).filter(EduTask.id == _uuid(tid), EduTask.uid == current_user.uid).first()
    if t is None:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(t)
    db.commit()
    return {"deleted": True}


class SessionIn(BaseModel):
    content: str = Field(min_length=1, max_length=1000)
    minutes: int | None = Field(default=None, ge=0, le=600)
    course_id: str | None = None
    topic_id: str | None = None


@router.post("/sessions")
def log_session(payload: SessionIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uid = current_user.uid
    course = _course(db, payload.course_id, uid) if payload.course_id else None
    topic = None
    if payload.topic_id:
        topic = db.query(EduTopic).filter(EduTopic.id == _uuid(payload.topic_id), EduTopic.uid == uid).first()
        if topic is None:
            raise HTTPException(status_code=404, detail="Not found")
        if course is not None and topic.course_id != course.id:
            raise HTTPException(status_code=400, detail="That topic belongs to another subject.")
        if course is None:
            course = db.query(EduCourse).filter(EduCourse.id == topic.course_id).first()
        if topic.status == "todo":
            topic.status = "learning"
    entry = EduJournalEntry(uid=uid, content=payload.content.strip(),
                            course_id=course.id if course else None, topic_id=topic.id if topic else None,
                            minutes=payload.minutes)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"id": str(entry.id), "created_at": _iso(entry.created_at)}
