import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class JobPost(Base):
    __tablename__ = "job_posts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    poster_uid = Column(String, index=True, nullable=False)
    kind = Column(String, default="opportunity", nullable=False)        # opportunity | status
    title = Column(String, nullable=False)
    category_type = Column(String, nullable=True)
    category_code = Column(String, nullable=True)
    job_type = Column(String, nullable=True)
    country = Column(String, nullable=True)
    region = Column(String, nullable=True)
    locality = Column(String, nullable=True)
    remote = Column(Boolean, default=False, nullable=False)
    description = Column(Text, nullable=True)
    requirements = Column(Text, nullable=True)
    pay_text = Column(String, nullable=True)
    deadline = Column(Date, nullable=True)
    media_refs = Column(Text, nullable=True)
    state = Column(String, default="open", nullable=False, index=True)   # open | shortlisting | filled | closed
    expires_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class JobBid(Base):
    __tablename__ = "job_bids"
    __table_args__ = (UniqueConstraint("job_id", "bidder_uid", name="uq_job_bid"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), index=True, nullable=False)
    bidder_uid = Column(String, index=True, nullable=False)
    proposal = Column(Text, nullable=False)
    rate_text = Column(String, nullable=True)
    item_ids = Column(Text, nullable=True)
    cred_ids = Column(Text, nullable=True)
    status = Column(String, default="submitted", nullable=False)         # submitted | shortlisted | hired | declined
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class JobComment(Base):
    __tablename__ = "job_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id = Column(UUID(as_uuid=True), index=True, nullable=False)
    author_uid = Column(String, index=True, nullable=False)
    content = Column(Text, nullable=False)
    item_ids = Column(Text, nullable=True)
    mention_uids = Column(Text, nullable=True)
    pinned = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
