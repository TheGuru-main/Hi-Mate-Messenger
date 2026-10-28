import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class EduCourse(Base):
    __tablename__ = "edu_courses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    uid = Column(String, index=True, nullable=False)
    name = Column(String, nullable=False)
    code = Column(String, nullable=True)
    kind = Column(String, default="subject", nullable=False)        # subject | course
    credit_units = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class EduTopic(Base):
    __tablename__ = "edu_topics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id = Column(UUID(as_uuid=True), index=True, nullable=False)
    uid = Column(String, index=True, nullable=False)
    title = Column(String, nullable=False)
    status = Column(String, default="todo", nullable=False)         # todo | learning | revised | mastered
    position = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class EduTask(Base):
    __tablename__ = "edu_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    uid = Column(String, index=True, nullable=False)
    course_id = Column(UUID(as_uuid=True), index=True, nullable=True)
    title = Column(String, nullable=False)
    kind = Column(String, default="assignment", nullable=False)     # exam | test | assignment | project
    due = Column(Date, nullable=False, index=True)
    done = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
