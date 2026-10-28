import os
import uuid
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.edu_curriculum import (
    EduCurriculum,
    EduSyllabusVersion,
    EduSyllabusNode,
    EduQuestionSource,
    EduQuestionProvenance,
)
from app.models.edu_practice import EduQuestion

router = APIRouter(
    prefix="/edu/curriculum/admin",
    tags=["EDU curriculum administration"],
)


def require_admin(user: User) -> str:
    # Read the existing authenticated UID. Never generate or recalculate it.
    uid = user.uid

    configured = {
        item.strip()
        for item in os.getenv("EDU_CURRICULUM_ADMIN_UIDS", "").split(",")
        if item.strip()
    }

    if not configured:
        raise HTTPException(
            status_code=503,
            detail="EDU curriculum administration is not configured",
        )

    if uid not in configured:
        raise HTTPException(status_code=403, detail="EDU administrator access required")

    return uid


class CurriculumCreate(BaseModel):
    scope_type: str
    curriculum_name: str = Field(min_length=1, max_length=200)
    curriculum_code: str | None = Field(default=None, max_length=100)
    continent: str | None = None
    country_code: str | None = Field(default=None, max_length=10)
    country_name: str | None = None
    region_name: str | None = None
    school_name: str | None = None
    provider_name: str | None = None
    education_level: str | None = None
    exam_type: str | None = None
    language: str | None = None
    official_url: str | None = None


class VersionCreate(BaseModel):
    version_label: str = Field(min_length=1, max_length=100)
    effective_from: datetime | None = None
    effective_to: datetime | None = None
    published_on: datetime | None = None
    source_url: str = Field(min_length=1, max_length=2000)
    source_hash: str = Field(min_length=32, max_length=128)
    import_method: str = Field(min_length=1, max_length=100)


class NodeCreate(BaseModel):
    node_type: str
    title: str = Field(min_length=1, max_length=500)
    code: str | None = Field(default=None, max_length=100)
    description: str | None = None
    parent_id: UUID | None = None
    learning_outcomes: list[str] = Field(default_factory=list)
    position: int = Field(default=0, ge=0)
    source_page: str | None = Field(default=None, max_length=100)


class SourceCreate(BaseModel):
    source_type: str
    title: str = Field(min_length=1, max_length=500)
    publisher: str | None = None
    source_url: str = Field(min_length=1, max_length=2000)
    exam_year: int | None = Field(default=None, ge=1900, le=2200)
    license_status: str
    rights_notes: str = Field(min_length=1, max_length=4000)
    source_hash: str = Field(min_length=32, max_length=128)


class SourceReview(BaseModel):
    decision: str
    rights_notes: str = Field(min_length=1, max_length=4000)


class VersionVerification(BaseModel):
    verification_notes: str = Field(min_length=20, max_length=5000)


class ProvenanceReview(BaseModel):
    decision: str
    review_notes: str = Field(min_length=10, max_length=5000)


# EDU_CURRICULUM_QUESTION_INGEST_V1
class CurriculumQuestionCreate(BaseModel):
    syllabus_version_id: UUID
    syllabus_node_id: UUID
    source_id: UUID
    generation_method: str = Field(default="imported", min_length=1, max_length=32)
    question: str = Field(min_length=3, max_length=3000)
    option_a: str = Field(min_length=1, max_length=500)
    option_b: str = Field(min_length=1, max_length=500)
    option_c: str = Field(min_length=1, max_length=500)
    option_d: str = Field(min_length=1, max_length=500)
    correct_option: str = Field(min_length=1, max_length=1)
    explanation: str | None = Field(default=None, max_length=3000)


@router.post("/catalogue", status_code=201)
def create_curriculum(
    payload: CurriculumCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_admin(user)

    allowed_scopes = {
        "international", "continent", "country", "region", "school"
    }
    if payload.scope_type not in allowed_scopes:
        raise HTTPException(status_code=422, detail="Invalid curriculum scope")

    data = payload.model_dump()
    data["source_status"] = "draft"
    data["is_active"] = False

    curriculum = EduCurriculum(**data)
    db.add(curriculum)
    try:
        db.commit()
        db.refresh(curriculum)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Curriculum could not be saved; check for duplicate records",
        )

    return {
        "id": str(curriculum.id),
        "curriculum_name": curriculum.curriculum_name,
        "source_status": curriculum.source_status,
        "is_active": curriculum.is_active,
    }


@router.post("/catalogue/{curriculum_id}/versions", status_code=201)
def create_version(
    curriculum_id: UUID,
    payload: VersionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_admin(user)

    curriculum = db.query(EduCurriculum).filter(
        EduCurriculum.id == curriculum_id
    ).first()
    if not curriculum or curriculum.source_status == "retired":
        raise HTTPException(status_code=404, detail="Curriculum not found")

    if payload.effective_from and payload.effective_to:
        if payload.effective_to < payload.effective_from:
            raise HTTPException(
                status_code=422,
                detail="effective_to cannot precede effective_from",
            )

    version = EduSyllabusVersion(
        curriculum_id=curriculum.id,
        version_label=payload.version_label,
        effective_from=payload.effective_from,
        effective_to=payload.effective_to,
        published_on=payload.published_on,
        source_url=payload.source_url,
        source_hash=payload.source_hash,
        import_method=payload.import_method,
        status="draft",
    )
    db.add(version)
    try:
        db.commit()
        db.refresh(version)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Version could not be saved; check for a duplicate version label",
        )

    return {
        "id": str(version.id),
        "curriculum_id": str(curriculum.id),
        "version_label": version.version_label,
        "status": version.status,
    }


@router.post("/versions/{version_id}/nodes", status_code=201)
def create_syllabus_node(
    version_id: UUID,
    payload: NodeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_admin(user)

    version = db.query(EduSyllabusVersion).filter(
        EduSyllabusVersion.id == version_id
    ).first()
    if not version or version.status != "draft":
        raise HTTPException(
            status_code=404,
            detail="Draft syllabus version not found",
        )

    allowed_types = {
        "subject", "topic", "subtopic", "learning_objective"
    }
    if payload.node_type not in allowed_types:
        raise HTTPException(status_code=422, detail="Invalid syllabus node type")

    if payload.parent_id:
        parent = db.query(EduSyllabusNode).filter(
            EduSyllabusNode.id == payload.parent_id,
            EduSyllabusNode.syllabus_version_id == version_id,
        ).first()
        if not parent:
            raise HTTPException(
                status_code=422,
                detail="Parent node must belong to this syllabus version",
            )

    node = EduSyllabusNode(
        syllabus_version_id=version_id,
        parent_id=payload.parent_id,
        node_type=payload.node_type,
        code=payload.code,
        title=payload.title,
        description=payload.description,
        learning_outcomes=payload.learning_outcomes,
        position=payload.position,
        source_page=payload.source_page,
    )
    db.add(node)
    db.commit()
    db.refresh(node)

    return {
        "id": str(node.id),
        "syllabus_version_id": str(version_id),
        "node_type": node.node_type,
        "title": node.title,
    }


@router.post("/sources", status_code=201)
def register_question_source(
    payload: SourceCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_admin(user)

    allowed_types = {
        "official_past_paper",
        "official_syllabus",
        "approved_bank",
        "ai_assisted",
        "teacher_authored",
    }
    allowed_licenses = {
        "public_domain",
        "licensed",
        "permission_granted",
        "restricted",
        "unknown",
    }

    if payload.source_type not in allowed_types:
        raise HTTPException(status_code=422, detail="Invalid source type")
    if payload.license_status not in allowed_licenses:
        raise HTTPException(status_code=422, detail="Invalid license status")

    source = EduQuestionSource(
        **payload.model_dump(),
        verification_status="pending",
    )
    db.add(source)
    db.commit()
    db.refresh(source)

    return {
        "id": str(source.id),
        "title": source.title,
        "verification_status": source.verification_status,
        "license_status": source.license_status,
    }


@router.post("/sources/{source_id}/review")
def review_question_source(
    source_id: UUID,
    payload: SourceReview,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    require_admin(user)

    if payload.decision not in {"verified", "rejected"}:
        raise HTTPException(
            status_code=422,
            detail="Decision must be verified or rejected",
        )

    source = db.query(EduQuestionSource).filter(
        EduQuestionSource.id == source_id
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="Question source not found")

    if payload.decision == "verified" and source.license_status in {
        "restricted", "unknown"
    }:
        raise HTTPException(
            status_code=422,
            detail="Restricted or unknown rights must be resolved before verification",
        )

    source.verification_status = payload.decision
    source.rights_notes = payload.rights_notes
    db.commit()

    return {
        "id": str(source.id),
        "verification_status": source.verification_status,
    }


@router.post("/versions/{version_id}/verify")
def verify_syllabus_version(
    version_id: UUID,
    payload: VersionVerification,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    reviewer_uid = require_admin(user)

    version = db.query(EduSyllabusVersion).filter(
        EduSyllabusVersion.id == version_id
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Syllabus version not found")

    if version.status not in {"draft", "verified", "current"}:
        raise HTTPException(
            status_code=409,
            detail="This syllabus version cannot be verified in its current state",
        )

    nodes = db.query(EduSyllabusNode).filter(
        EduSyllabusNode.syllabus_version_id == version_id
    ).count()
    if nodes == 0:
        raise HTTPException(
            status_code=422,
            detail="A syllabus must contain nodes before verification",
        )

    if not version.source_url or not version.source_hash:
        raise HTTPException(
            status_code=422,
            detail="Source URL and source hash are required",
        )

    # Explicit human review is required; merely importing nodes is not verification.
    version.status = "verified"
    version.verification_notes = (
        payload.verification_notes.strip()
        + "\nReviewed by authorized UID: "
        + reviewer_uid
    )
    version.verified_at = datetime.utcnow()

    db.commit()

    return {
        "id": str(version.id),
        "status": version.status,
        "node_count": nodes,
        "message": "Version verified by an authorized administrator",
    }


@router.post("/questions", status_code=201)
def create_curriculum_question(
    payload: CurriculumQuestionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # EDU_CURRICULUM_QUESTION_INGEST_V1
    creator_uid = require_admin(user)

    correct = payload.correct_option.strip().upper()
    if correct not in {"A", "B", "C", "D"}:
        raise HTTPException(
            status_code=422,
            detail="Correct option must be A, B, C, or D",
        )

    version = db.query(EduSyllabusVersion).filter(
        EduSyllabusVersion.id == payload.syllabus_version_id,
        EduSyllabusVersion.status.in_(("verified", "current")),
    ).first()
    if version is None:
        raise HTTPException(
            status_code=422,
            detail="Question must map to a verified syllabus version",
        )

    node = db.query(EduSyllabusNode).filter(
        EduSyllabusNode.id == payload.syllabus_node_id,
        EduSyllabusNode.syllabus_version_id == version.id,
    ).first()
    if node is None:
        raise HTTPException(
            status_code=422,
            detail="Syllabus node must belong to the selected version",
        )

    source = db.query(EduQuestionSource).filter(
        EduQuestionSource.id == payload.source_id
    ).first()
    if source is None or source.verification_status != "verified":
        raise HTTPException(
            status_code=422,
            detail="Question source must be verified before ingestion",
        )
    if source.license_status in {"restricted", "unknown"}:
        raise HTTPException(
            status_code=422,
            detail="Question source rights do not permit publication",
        )

    question = EduQuestion(
        uid=creator_uid,
        course_id=None,
        topic_id=None,
        question=payload.question.strip(),
        option_a=payload.option_a.strip(),
        option_b=payload.option_b.strip(),
        option_c=payload.option_c.strip(),
        option_d=payload.option_d.strip(),
        correct_option=correct,
        explanation=(payload.explanation or "").strip() or None,
    )

    provenance = EduQuestionProvenance(
        question_id=question.id or uuid.uuid4(),
        syllabus_version_id=version.id,
        syllabus_node_id=node.id,
        source_id=source.id,
        generation_method=payload.generation_method.strip(),
        alignment_status="pending",
        review_status="pending",
    )

    # Assign the same UUID explicitly to both rows.
    question.id = provenance.question_id

    try:
        db.add(question)
        db.add(provenance)
        db.commit()
        db.refresh(question)
        db.refresh(provenance)
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Question could not be saved; no partial question was retained",
        )

    return {
        "question_id": str(question.id),
        "syllabus_version_id": str(version.id),
        "syllabus_node_id": str(node.id),
        "review_status": provenance.review_status,
        "alignment_status": provenance.alignment_status,
        "message": "Question created; administrator review is still required",
    }


@router.post("/questions/{question_id}/review")
def review_question_provenance(
    question_id: UUID,
    payload: ProvenanceReview,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    reviewer_uid = require_admin(user)

    if payload.decision not in {"approved", "rejected"}:
        raise HTTPException(
            status_code=422,
            detail="Decision must be approved or rejected",
        )

    provenance = db.query(EduQuestionProvenance).filter(
        EduQuestionProvenance.question_id == question_id
    ).first()
    if not provenance:
        raise HTTPException(
            status_code=404,
            detail="Question provenance record not found",
        )

    question = db.query(EduQuestion).filter(
        EduQuestion.id == question_id
    ).first()
    if question is None:
        raise HTTPException(
            status_code=422,
            detail="The referenced question does not exist",
        )

    if payload.decision == "approved":
        version = db.query(EduSyllabusVersion).filter(
            EduSyllabusVersion.id == provenance.syllabus_version_id
        ).first()
        node = db.query(EduSyllabusNode).filter(
            EduSyllabusNode.id == provenance.syllabus_node_id,
            EduSyllabusNode.syllabus_version_id == provenance.syllabus_version_id,
        ).first()

        if not version or version.status not in {"verified", "current"}:
            raise HTTPException(
                status_code=422,
                detail="Question must map to a verified syllabus version",
            )
        if not node:
            raise HTTPException(
                status_code=422,
                detail="Question must map to a node in that syllabus version",
            )

        if not provenance.source_id:
            raise HTTPException(
                status_code=422,
                detail="A verified question source is required for approval",
            )

        source = db.query(EduQuestionSource).filter(
            EduQuestionSource.id == provenance.source_id
        ).first()
        if (
            not source
            or source.verification_status != "verified"
            or source.license_status in {"restricted", "unknown"}
        ):
            raise HTTPException(
                status_code=422,
                detail="Question source and publication rights must be verified first",
            )

        provenance.alignment_status = "verified"
        provenance.review_status = "approved"
    else:
        provenance.alignment_status = "rejected"
        provenance.review_status = "rejected"

    provenance.reviewer_uid = reviewer_uid
    provenance.review_notes = payload.review_notes.strip()
    provenance.reviewed_at = datetime.utcnow()

    db.commit()

    return {
        "question_id": str(question_id),
        "alignment_status": provenance.alignment_status,
        "review_status": provenance.review_status,
    }
