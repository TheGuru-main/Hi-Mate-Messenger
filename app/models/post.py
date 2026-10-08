import uuid
from datetime import datetime

from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base

# Locked reaction set
VALID_REACTIONS = {"❤️", "👍", "😂", "😮", "😢", "✅", "🙏", "🙋", "👏", "🚀", "🎓", "📍", "💪", "💎"}

# Locked feed categories
FEED_CATEGORIES = {
    "Personal", "Technology", "AI", "Education", "Business", "Medical",
    "Health & Fitness", "Entertainment", "Sports", "News",
    "Religion & Culture", "Lifestyle", "Advertisement",
}


class Post(Base):
    __tablename__ = "posts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    author_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    category = Column(String, nullable=False)  # must be one of FEED_CATEGORIES — validated at the schema layer
    content = Column(Text, nullable=True)
    media_ref = Column(String, nullable=True)  # LEGACY: old single-image posts, kept for backward compat
    media_refs = Column(Text, nullable=True)  # NEW: comma-joined list of media_refs, for multi-image/video posts
    identity_version = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class Comment(Base):
    __tablename__ = "comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(UUID(as_uuid=True), ForeignKey("posts.id"), nullable=False)
    author_uid = Column(String, ForeignKey("users.uid"), nullable=False)
    content = Column(Text, nullable=True)
    media_ref = Column(String, nullable=True)  # video comments capped at 60s, enforced at the schema/route layer
    parent_comment_id = Column(UUID(as_uuid=True), ForeignKey("comments.id"), nullable=True)  # NEW: reply support (flat, one level)
    identity_version = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Reaction(Base):
    __tablename__ = "reactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    post_id = Column(UUID(as_uuid=True), ForeignKey("posts.id"), nullable=True)  # nullable: reaction may target a comment instead
    comment_id = Column(UUID(as_uuid=True), ForeignKey("comments.id"), nullable=True)  # NEW: comment reactions
    uid = Column(String, ForeignKey("users.uid"), nullable=False)
    emoji = Column(String, nullable=False)  # must be in VALID_REACTIONS
    identity_version = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
