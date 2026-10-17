import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class PortfolioItem(Base):
    __tablename__ = "portfolio_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_uid = Column(String, index=True, nullable=False)
    kind = Column(String, nullable=False)              # video | audio | image | document | link | code | product
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    category_type = Column(String, nullable=True)      # talent | business
    category_code = Column(String, nullable=True)      # single-letter code
    media_ref = Column(String, nullable=True)
    link_url = Column(String, nullable=True)
    visibility = Column(String, default="public", nullable=False)   # public | kliques | private
    pinned = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class Credential(Base):
    __tablename__ = "user_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_uid = Column(String, index=True, nullable=False)
    ctype = Column(String, nullable=False)             # work | talent
    title = Column(String, nullable=False)
    org = Column(String, nullable=True)                # employer or issuer
    start_year = Column(Integer, nullable=True)
    end_year = Column(Integer, nullable=True)          # empty on a work credential = present
    description = Column(Text, nullable=True)
    proof_ref = Column(String, nullable=True)
    status = Column(String, default="self_declared", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
