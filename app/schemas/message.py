from datetime import datetime
from uuid import UUID
from typing import Optional, Literal
from pydantic import BaseModel, ConfigDict, model_validator

MessageType = Literal["text", "image", "video", "voice", "document"]


class MessageCreate(BaseModel):
    receiver_uid: Optional[str] = None
    group_id: Optional[str] = None
    type: MessageType
    content: Optional[str] = None
    media_ref: Optional[str] = None
    reply_to: Optional[str] = None

    @model_validator(mode="after")
    def exactly_one_target(self):
        if bool(self.receiver_uid) == bool(self.group_id):
            raise ValueError("Provide exactly one of receiver_uid or group_id")
        return self


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sender_uid: str
    receiver_uid: Optional[str] = None
    group_id: Optional[str] = None
    type: str
    content: Optional[str] = None
    media_ref: Optional[str] = None
    created_at: datetime


class GroupCreate(BaseModel):
    name: str
    member_uids: list[str]
    group_uid: str  # 8 digits, chosen by the creator — feeds the placement S value
    description: str | None = None
    purpose: str | None = None


class GroupUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    purpose: str | None = None
    visibility: str | None = None


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    group_id: str
    name: str
    description: str | None = None
    purpose: str | None = None
    member_uids: list[str]
    pending_uids: list[str] = []
    visibility: str = "private"
    created_by_uid: str
    start_row: int
    created_at: datetime


class GroupMembersAdd(BaseModel):
    member_uids: list[str]


class EventCreate(BaseModel):
    title: str
    description: str | None = None
    start_time: datetime


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    group_id: str
    title: str
    description: str | None = None
    start_time: datetime
    created_by_uid: str
    created_at: datetime


class KliqueRequestCreate(BaseModel):
    to_uid: str


class KliqueActionRequest(BaseModel):
    request_id: str
