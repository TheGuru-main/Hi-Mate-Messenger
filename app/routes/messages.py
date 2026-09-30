import hashlib
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from sqlalchemy import or_
from app.models.klique import KliqueRequest
from app.models.contact_link import ContactLink
from app.dependencies import get_current_user
from app.models.user import User
from app.models.message import Message, Group, GroupEvent
from app.models.notification import Notification
from app.schemas.message import MessageCreate, MessageOut, GroupCreate, GroupOut, GroupUpdate, GroupMembersAdd, EventCreate, EventOut
from app.services import placement
from app.sockets.manager import manager

router = APIRouter(tags=["messages"])


def check_dm_allowed(db: Session, sender: User, receiver: User) -> bool:
    """True = normal DM. False = first-contact 'message request'. Raises 403 if one is already waiting."""
    a, b = sender.uid, receiver.uid
    if a == b:
        return True
    connected = db.query(KliqueRequest).filter(
        KliqueRequest.status == "accepted",
        or_(
            (KliqueRequest.from_uid == a) & (KliqueRequest.to_uid == b),
            (KliqueRequest.from_uid == b) & (KliqueRequest.to_uid == a),
        ),
    ).first()
    if connected:
        return True
    in_contacts = db.query(ContactLink).filter(
        or_(
            (ContactLink.owner_uid == a) & (ContactLink.contact_uid == b),
            (ContactLink.owner_uid == b) & (ContactLink.contact_uid == a),
        )
    ).first()
    if in_contacts:
        return True
    if db.query(Message).filter(Message.sender_uid == b, Message.receiver_uid == a).first():
        return True
    if db.query(Message).filter(Message.sender_uid == a, Message.receiver_uid == b).first():
        raise HTTPException(
            status_code=403,
            detail="Message request sent. You can send more once they reply or you connect (Klique or contacts).",
        )
    return False



@router.post("/messages", response_model=MessageOut)
async def send_message(
    payload: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    is_request = False
    if payload.receiver_uid:
        receiver = db.query(User).filter(User.uid == payload.receiver_uid).first()
        if not receiver:
            raise HTTPException(status_code=404, detail="Receiver not found")
        cell_row = receiver.start_row
        is_request = check_dm_allowed(db, current_user, receiver)
    else:
        group = db.query(Group).filter(Group.group_id == payload.group_id).first()
        if not group:
            raise HTTPException(status_code=404, detail="Group not found")
        if current_user.uid not in group.member_uids:
            raise HTTPException(status_code=403, detail="Not a member of this group")
        cell_row = group.start_row

    message = Message(
        sender_uid=current_user.uid,
        receiver_uid=payload.receiver_uid,
        group_id=payload.group_id,
        type=payload.type,
        content=payload.content,
        media_ref=payload.media_ref,
        reply_to=payload.reply_to,
        cell_row=cell_row,
        identity_version=current_user.identity_version,
    )
    db.add(message)
    db.commit()
    db.refresh(message)
    if payload.receiver_uid and is_request:
        db.add(Notification(
            recipient_uid=payload.receiver_uid, actor_uid=current_user.uid, type="message_request",
            message=f"{current_user.username} sent you a message request",
        ))
        db.commit()

    # Real-time push — payload matches MessageOut shape so the client can
    # render it directly without a re-fetch.
    push_payload = {
        "type": "message",
        "id": str(message.id),
        "sender_uid": message.sender_uid,
        "receiver_uid": message.receiver_uid,
        "group_id": message.group_id,
        "message_type": message.type,
        "content": message.content,
        "media_ref": message.media_ref,
        "created_at": message.created_at.isoformat(),
    }

    if payload.receiver_uid:
        await manager.send_to_user(payload.receiver_uid, push_payload)
        # Also echo to the sender's other connected devices, if any
        await manager.send_to_user(current_user.uid, push_payload)
    else:
        # Group: single shared envelope, fan out to every member
        await manager.send_to_group(group.member_uids, push_payload)

    return message


@router.get("/conversations")
async def list_conversations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    msgs = (
        db.query(Message)
        .filter(Message.group_id.is_(None))
        .filter((Message.sender_uid == current_user.uid) | (Message.receiver_uid == current_user.uid))
        .order_by(Message.created_at.desc())
        .limit(500)
        .all()
    )
    latest = {}
    for m in msgs:
        other = m.receiver_uid if m.sender_uid == current_user.uid else m.sender_uid
        if other and other not in latest:
            latest[other] = m
    if not latest:
        return []
    users = {u.uid: u for u in db.query(User).filter(User.uid.in_(list(latest.keys()))).all()}
    return [
        {
            "uid": uid,
            "username": users[uid].username if uid in users else uid,
            "last_message": m.content if m.type == "text" else f"[{m.type}]",
            "last_message_at": m.created_at.isoformat() if m.created_at else None,
            "sent_by_me": m.sender_uid == current_user.uid,
        }
        for uid, m in latest.items()
    ]


@router.get("/messages/{conversation_id}", response_model=list[MessageOut])
async def get_messages(
    conversation_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """conversation_id is either a receiver's uid (1:1) or a group_id."""
    messages = (
        db.query(Message)
        .filter(
            (Message.receiver_uid == conversation_id) | (Message.group_id == conversation_id)
        )
        .order_by(Message.created_at.desc())
        .limit(50)
        .all()
    )
    return messages


@router.post("/groups", response_model=GroupOut)
async def create_group(
    payload: GroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # group_id = creator_uid + timestamp hash, per locked spec
    if not payload.group_uid.isdigit() or len(payload.group_uid) != 8:
        raise HTTPException(status_code=400, detail="group_uid must be exactly 8 digits")
    if db.query(Group).filter(Group.creator_group_uid == payload.group_uid).first():
        raise HTTPException(status_code=400, detail="That group UID is already taken — pick another 8-digit number")


    raw = f"{current_user.uid}-{time.time()}"
    group_id = hashlib.sha256(raw.encode()).hexdigest()[:16]

    p = placement.compute_placement(payload.name, payload.group_uid)

    members = list(set(payload.member_uids + [current_user.uid]))

    group = Group(
        group_id=group_id,
        name=payload.name,
        description=payload.description,
        purpose=payload.purpose,
        L=p["L"],
        S=p["S"],
        start_row=p["start_row"],
        member_uids=members,
        created_by_uid=current_user.uid,
        creator_group_uid=payload.group_uid,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


@router.get("/groups/mine", response_model=list[GroupOut])
async def list_my_groups(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Group).filter(Group.member_uids.contains([current_user.uid])).order_by(Group.created_at.desc()).all()


@router.post("/groups/{group_id}/members", response_model=GroupOut)
async def add_group_members(
    group_id: str, payload: GroupMembersAdd,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    group = db.query(Group).filter(Group.group_id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if current_user.uid not in group.member_uids:
        raise HTTPException(status_code=403, detail="Not a member of this group")
    group.member_uids = list(set(group.member_uids + payload.member_uids))
    db.commit()
    db.refresh(group)
    return group


@router.post("/groups/{group_id}/join", response_model=GroupOut)
async def join_group_by_link(
    group_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    group = db.query(Group).filter(Group.group_id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if current_user.uid in group.member_uids or current_user.uid in group.pending_uids:
        return group
    if group.visibility == "public":
        group.member_uids = group.member_uids + [current_user.uid]
    else:
        group.pending_uids = group.pending_uids + [current_user.uid]
        db.add(Notification(
            recipient_uid=group.created_by_uid, actor_uid=current_user.uid, type="group_join_request",
            message=f"{current_user.username} wants to join \"{group.name}\"",
        ))
    db.commit()
    db.refresh(group)
    return group


@router.get("/groups/{group_id}/pending")
async def list_pending_members(
    group_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    group = db.query(Group).filter(Group.group_id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.created_by_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="Only the group creator can view pending requests")
    if not group.pending_uids:
        return []
    users = db.query(User).filter(User.uid.in_(group.pending_uids)).all()
    return [{"uid": u.uid, "username": u.username} for u in users]


@router.post("/groups/{group_id}/approve/{uid}", response_model=GroupOut)
async def approve_pending_member(
    group_id: str, uid: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    group = db.query(Group).filter(Group.group_id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.created_by_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="Only the group creator can approve members")
    if uid in group.pending_uids:
        group.pending_uids = [u for u in group.pending_uids if u != uid]
        group.member_uids = group.member_uids + [uid]
        db.add(Notification(
            recipient_uid=uid, actor_uid=current_user.uid, type="group_approved",
            message=f"You were approved to join \"{group.name}\"",
        ))
        db.commit()
        db.refresh(group)
    return group


@router.post("/groups/{group_id}/events", response_model=EventOut)
async def create_group_event(
    group_id: str, payload: EventCreate,
    db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    group = db.query(Group).filter(Group.group_id == group_id).first()
    if not group or current_user.uid not in group.member_uids:
        raise HTTPException(status_code=403, detail="Not a member of this group")
    event = GroupEvent(
        group_id=group_id, title=payload.title, description=payload.description,
        start_time=payload.start_time, created_by_uid=current_user.uid,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return {**event.__dict__, "id": str(event.id)}


@router.get("/groups/{group_id}/events", response_model=list[EventOut])
async def list_group_events(
    group_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user),
):
    group = db.query(Group).filter(Group.group_id == group_id).first()
    if not group or current_user.uid not in group.member_uids:
        raise HTTPException(status_code=403, detail="Not a member of this group")
    events = db.query(GroupEvent).filter(GroupEvent.group_id == group_id).order_by(GroupEvent.start_time.asc()).all()
    return [{**e.__dict__, "id": str(e.id)} for e in events]


@router.get("/groups/{group_id}", response_model=GroupOut)
async def get_group(group_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    group = db.query(Group).filter(Group.group_id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if current_user.uid not in group.member_uids:
        raise HTTPException(status_code=403, detail="Not a member of this group")
    return group


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(
    group_id: str,
    payload: GroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    group = db.query(Group).filter(Group.group_id == group_id).first()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    if group.created_by_uid != current_user.uid:
        raise HTTPException(status_code=403, detail="Only the group creator can edit its details")
    for field_name, value in payload.model_dump(exclude_unset=True).items():
        setattr(group, field_name, value)
    db.commit()
    db.refresh(group)
    return group
