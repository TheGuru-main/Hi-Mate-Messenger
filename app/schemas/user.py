from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, ConfigDict


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    uid: str
    username: str
    phone: str
    country: Optional[str] = None
    region: Optional[str] = None
    locality: Optional[str] = None
    language: Optional[str] = None
    business_role: Optional[str] = None
    interest: Optional[str] = None
    date_of_birth: Optional[date] = None
    start_row: int
    created_at: datetime


class UserUpdate(BaseModel):
    username: Optional[str] = None
    phone: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None
    locality: Optional[str] = None
    language: Optional[str] = None
    business_role: Optional[str] = None
    interest: Optional[str] = None
    marital_status: Optional[str] = None
    religion: Optional[str] = None
    date_of_birth: Optional[date] = None


class ContactMatchRequest(BaseModel):
    phone_numbers: list[str]


class ContactMatch(BaseModel):
    phone: str
    uid: str
    username: str


class ContactMatchResponse(BaseModel):
    matches: list[ContactMatch]
