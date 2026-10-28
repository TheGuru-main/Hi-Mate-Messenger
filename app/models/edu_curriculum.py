"""LOMINII EDU curriculum, syllabus versioning and question provenance."""
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Index,
    Integer, JSON, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class EduCurriculum(Base):
    __tablename__ = "edu_curricula"
    __table_args__ = (
        Index("ix_edu_curricula_scope_country", "scope_type", "country_code"),
        Index("ix_edu_curricula_provider_exam", "provider_name", "exam_type"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope_type = Column(String(24), nullable=False, index=True)
    # international | continent | country | region | school
    continent = Column(String(80), nullable=True, index=True)
    country_code = Column(String(3), nullable=True, index=True)
    country_name = Column(String(100), nullable=True)
    region_name = Column(String(120), nullable=True)
    school_name = Column(String(180), nullable=True)
    provider_name = Column(String(180), nullable=False)
    curriculum_name = Column(String(200), nullable=False)
    curriculum_code = Column(String(80), nullable=True, index=True)
    education_level = Column(String(80), nullable=True)
    exam_type = Column(String(80), nullable=True, index=True)
    language = Column(String(40), nullable=True)
    official_url = Column(Text, nullable=True)
    source_status = Column(String(20), nullable=False, default="draft", index=True)
    is_active = Column(Boolean, nullable=False, default=True, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(
        DateTime, nullable=False, default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class EduSyllabusVersion(Base):
    __tablename__ = "edu_syllabus_versions"
    __table_args__ = (
        UniqueConstraint(
            "curriculum_id", "version_label",
            name="uq_edu_syllabus_curriculum_version",
        ),
        Index("ix_edu_syllabus_version_status", "curriculum_id", "status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    curriculum_id = Column(
        UUID(as_uuid=True), ForeignKey("edu_curricula.id"),
        nullable=False, index=True,
    )
    version_label = Column(String(100), nullable=False)
    effective_from = Column(Date, nullable=True)
    effective_to = Column(Date, nullable=True)
    published_on = Column(Date, nullable=True)
    source_url = Column(Text, nullable=False)
    source_hash = Column(String(128), nullable=True, index=True)
    import_method = Column(String(40), nullable=False, default="manual")
    status = Column(String(20), nullable=False, default="draft", index=True)
    verification_notes = Column(Text, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class EduSyllabusNode(Base):
    __tablename__ = "edu_syllabus_nodes"
    __table_args__ = (
        Index("ix_edu_syllabus_nodes_version_type", "syllabus_version_id", "node_type"),
        Index("ix_edu_syllabus_nodes_parent_position", "parent_id", "position"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    syllabus_version_id = Column(
        UUID(as_uuid=True), ForeignKey("edu_syllabus_versions.id"),
        nullable=False, index=True,
    )
    parent_id = Column(
        UUID(as_uuid=True), ForeignKey("edu_syllabus_nodes.id"),
        nullable=True, index=True,
    )
    node_type = Column(String(24), nullable=False)
    # subject | topic | subtopic | learning_objective
    code = Column(String(100), nullable=True)
    title = Column(String(240), nullable=False)
    description = Column(Text, nullable=True)
    learning_outcomes = Column(JSON, nullable=False, default=list)
    position = Column(Integer, nullable=False, default=0)
    source_page = Column(String(80), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class EduQuestionSource(Base):
    __tablename__ = "edu_question_sources"
    __table_args__ = (
        Index("ix_edu_question_sources_type_status", "source_type", "verification_status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_type = Column(String(32), nullable=False)
    # official_past_paper | official_syllabus | approved_bank
    # ai_assisted | teacher_authored
    title = Column(String(240), nullable=False)
    publisher = Column(String(180), nullable=True)
    source_url = Column(Text, nullable=True)
    exam_year = Column(Integer, nullable=True)
    license_status = Column(String(32), nullable=False, default="unknown")
    # public_domain | licensed | permission_granted | restricted | unknown
    rights_notes = Column(Text, nullable=True)
    source_hash = Column(String(128), nullable=True, index=True)
    verification_status = Column(
        String(20), nullable=False, default="pending", index=True,
    )
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class EduQuestionProvenance(Base):
    __tablename__ = "edu_question_provenance"
    __table_args__ = (
        UniqueConstraint("question_id", name="uq_edu_question_provenance_question"),
        Index("ix_edu_question_provenance_review", "review_status", "alignment_status"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Linked by ID to edu_questions without a DB foreign key.
    question_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    syllabus_version_id = Column(
        UUID(as_uuid=True), ForeignKey("edu_syllabus_versions.id"),
        nullable=False, index=True,
    )
    syllabus_node_id = Column(
        UUID(as_uuid=True), ForeignKey("edu_syllabus_nodes.id"),
        nullable=False, index=True,
    )
    source_id = Column(
        UUID(as_uuid=True), ForeignKey("edu_question_sources.id"),
        nullable=True, index=True,
    )
    generation_method = Column(String(32), nullable=False, default="imported")
    alignment_status = Column(String(20), nullable=False, default="pending")
    review_status = Column(String(20), nullable=False, default="pending")
    reviewer_uid = Column(String, nullable=True)
    review_notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    reviewed_at = Column(DateTime, nullable=True)
