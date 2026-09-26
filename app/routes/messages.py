import hashlib
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.message import Message, Group, GroupEvent
from app.schemas.message import MessageCreate, MessageOut, GroupCreate, GroupOut, GroupUpdate, GroupMembersAdd, EventCreate, EventOut
from app.services import placement
from app.sockets.manager import manager

router = APIRouter(tags=["messages"])


@router.post("/messages", response_model=MessageOut)
async def send_message(
    payload: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if payload.receiver_uid:
        receiver = db.query(User).filter(User.uid == payload.receiver_uid).first()
        if not receiver:
            raise HTTPException(status_code=404, detail="Receiver not found")
        cell_row = receiver.start_row
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
    raw = f"{current_user.uid}-{time.time()}"
    group_id = hashlib.sha256(raw.encode()).hexdigest()[:16]

    p = placement.compute_placement(payload.name, group_id)

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
    if current_user.uid not in group.member_uids:
        group.member_uids = group.member_uids + [current_user.uid]
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
