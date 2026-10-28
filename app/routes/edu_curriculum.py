"""Learner APIs for verified curricula, syllabus versions and provenance."""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.edu_practice import EduQuestion, EduQuestionAttempt
from app.models.edu_curriculum import (
    EduCurriculum,
    EduSyllabusVersion,
    EduSyllabusNode,
    EduQuestionSource,
    EduQuestionProvenance,
)

router = APIRouter(prefix="/edu/curriculum", tags=["edu-curriculum"])


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(status_code=404, detail="Not found")


def _curriculum_dict(c):
    return {
        "id": str(c.id),
        "scope_type": c.scope_type,
        "continent": c.continent,
        "country_code": c.country_code,
        "country_name": c.country_name,
        "region_name": c.region_name,
        "school_name": c.school_name,
        "provider_name": c.provider_name,
        "curriculum_name": c.curriculum_name,
        "curriculum_code": c.curriculum_code,
        "education_level": c.education_level,
        "exam_type": c.exam_type,
        "language": c.language,
        "official_url": c.official_url,
        "source_status": c.source_status,
    }


def _version_dict(v):
    return {
        "id": str(v.id),
        "curriculum_id": str(v.curriculum_id),
        "version_label": v.version_label,
        "effective_from": v.effective_from.isoformat() if v.effective_from else None,
        "effective_to": v.effective_to.isoformat() if v.effective_to else None,
        "published_on": v.published_on.isoformat() if v.published_on else None,
        "source_url": v.source_url,
        "import_method": v.import_method,
        "status": v.status,
    }


@router.get("/catalogue")
def catalogue(
    continent: str | None = Query(default=None, max_length=80),
    country_code: str | None = Query(default=None, max_length=3),
    scope_type: str | None = Query(default=None, max_length=24),
    education_level: str | None = Query(default=None, max_length=80),
    exam_type: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=100, ge=1, le=300),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(EduCurriculum).filter(
        EduCurriculum.is_active.is_(True),
        EduCurriculum.source_status == "verified",
    )

    if continent:
        q = q.filter(EduCurriculum.continent.ilike(continent.strip()))
    if country_code:
        q = q.filter(
            EduCurriculum.country_code == country_code.strip().upper()
        )
    if scope_type:
        allowed = ("international", "continent", "country", "region", "school")
        if scope_type not in allowed:
            raise HTTPException(status_code=400, detail="Invalid scope_type")
        q = q.filter(EduCurriculum.scope_type == scope_type)
    if education_level:
        q = q.filter(
            EduCurriculum.education_level.ilike(education_level.strip())
        )
    if exam_type:
        q = q.filter(EduCurriculum.exam_type.ilike(exam_type.strip()))

    rows = q.order_by(
        EduCurriculum.continent,
        EduCurriculum.country_name,
        EduCurriculum.provider_name,
        EduCurriculum.curriculum_name,
    ).limit(limit).all()

    return {"items": [_curriculum_dict(row) for row in rows], "count": len(rows)}


@router.get("/catalogue/{curriculum_id}")
def curriculum_detail(
    curriculum_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    curriculum = db.query(EduCurriculum).filter(
        EduCurriculum.id == _uuid(curriculum_id),
        EduCurriculum.is_active.is_(True),
        EduCurriculum.source_status == "verified",
    ).first()

    if curriculum is None:
        raise HTTPException(status_code=404, detail="Curriculum not found")

    versions = db.query(EduSyllabusVersion).filter(
        EduSyllabusVersion.curriculum_id == curriculum.id,
        EduSyllabusVersion.status.in_(("current", "verified")),
    ).order_by(
        EduSyllabusVersion.effective_from.desc().nullslast()
    ).all()

    return {
        "curriculum": _curriculum_dict(curriculum),
        "versions": [_version_dict(v) for v in versions],
    }


@router.get("/versions/{version_id}/syllabus")
def syllabus_nodes(
    version_id: str,
    parent_id: str | None = Query(default=None),
    node_type: str | None = Query(default=None, max_length=24),
    limit: int = Query(default=300, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    version = db.query(EduSyllabusVersion).filter(
        EduSyllabusVersion.id == _uuid(version_id),
        EduSyllabusVersion.status.in_(("current", "verified")),
    ).first()

    if version is None:
        raise HTTPException(
            status_code=404,
            detail="Verified syllabus version not found",
        )

    q = db.query(EduSyllabusNode).filter(
        EduSyllabusNode.syllabus_version_id == version.id
    )

    if parent_id:
        q = q.filter(EduSyllabusNode.parent_id == _uuid(parent_id))
    else:
        q = q.filter(EduSyllabusNode.parent_id.is_(None))

    if node_type:
        allowed = ("subject", "topic", "subtopic", "learning_objective")
        if node_type not in allowed:
            raise HTTPException(status_code=400, detail="Invalid node_type")
        q = q.filter(EduSyllabusNode.node_type == node_type)

    rows = q.order_by(
        EduSyllabusNode.position,
        EduSyllabusNode.title,
    ).limit(limit).all()

    return {
        "version": _version_dict(version),
        "items": [
            {
                "id": str(n.id),
                "parent_id": str(n.parent_id) if n.parent_id else None,
                "node_type": n.node_type,
                "code": n.code,
                "title": n.title,
                "description": n.description,
                "learning_outcomes": n.learning_outcomes or [],
                "position": n.position,
                "source_page": n.source_page,
            }
            for n in rows
        ],
        "count": len(rows),
    }


@router.get("/questions/{question_id}/provenance")
def question_provenance(
    question_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    provenance = db.query(EduQuestionProvenance).filter(
        EduQuestionProvenance.question_id == _uuid(question_id),
        EduQuestionProvenance.review_status == "approved",
        EduQuestionProvenance.alignment_status == "verified",
    ).first()

    if provenance is None:
        raise HTTPException(
            status_code=404,
            detail="Verified question provenance not found",
        )

    node = db.query(EduSyllabusNode).filter(
        EduSyllabusNode.id == provenance.syllabus_node_id
    ).first()

    version = db.query(EduSyllabusVersion).filter(
        EduSyllabusVersion.id == provenance.syllabus_version_id
    ).first()

    source = None
    if provenance.source_id:
        source = db.query(EduQuestionSource).filter(
            EduQuestionSource.id == provenance.source_id
        ).first()

    return {
        "question_id": str(provenance.question_id),
        "generation_method": provenance.generation_method,
        "review_status": provenance.review_status,
        "alignment_status": provenance.alignment_status,
        "syllabus_version": _version_dict(version) if version else None,
        "syllabus_node": (
            {
                "id": str(node.id),
                "node_type": node.node_type,
                "code": node.code,
                "title": node.title,
                "source_page": node.source_page,
            }
            if node else None
        ),
        "source": (
            {
                "id": str(source.id),
                "source_type": source.source_type,
                "title": source.title,
                "publisher": source.publisher,
                "source_url": source.source_url,
                "exam_year": source.exam_year,
                "license_status": source.license_status,
                "verification_status": source.verification_status,
            }
            if source else None
        ),
    }


# EDU_CURRICULUM_SHARED_PRACTICE_V1
class CurriculumPracticeAnswer(BaseModel):
    question_id: str
    selected_option: str = Field(min_length=1, max_length=1)


def _approved_curriculum_question_query(db):
    # Publication requires approved provenance, verified alignment, a verified
    # syllabus version, and a verified source with publishable rights.
    return (
        db.query(EduQuestion, EduQuestionProvenance)
        .join(
            EduQuestionProvenance,
            EduQuestionProvenance.question_id == EduQuestion.id,
        )
        .join(
            EduSyllabusVersion,
            EduSyllabusVersion.id == EduQuestionProvenance.syllabus_version_id,
        )
        .join(
            EduSyllabusNode,
            EduSyllabusNode.id == EduQuestionProvenance.syllabus_node_id,
        )
        .join(
            EduQuestionSource,
            EduQuestionSource.id == EduQuestionProvenance.source_id,
        )
        .filter(
            EduQuestionProvenance.review_status == "approved",
            EduQuestionProvenance.alignment_status == "verified",
            EduSyllabusVersion.status.in_(("verified", "current")),
            EduSyllabusNode.syllabus_version_id == EduSyllabusVersion.id,
            EduQuestionSource.verification_status == "verified",
            EduQuestionSource.license_status.notin_(("restricted", "unknown")),
        )
    )


@router.get("/practice/questions")
def list_curriculum_practice_questions(
    version_id: str | None = Query(default=None),
    node_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = _approved_curriculum_question_query(db)

    if version_id:
        query = query.filter(
            EduQuestionProvenance.syllabus_version_id == _uuid(version_id)
        )
    if node_id:
        query = query.filter(
            EduQuestionProvenance.syllabus_node_id == _uuid(node_id)
        )

    rows = query.order_by(EduQuestion.created_at.desc()).limit(limit).all()

    return {
        "items": [
            {
                "id": str(question.id),
                "question": question.question,
                "options": {
                    "A": question.option_a,
                    "B": question.option_b,
                    "C": question.option_c,
                    "D": question.option_d,
                },
                "syllabus_version_id": str(provenance.syllabus_version_id),
                "syllabus_node_id": str(provenance.syllabus_node_id),
                "generation_method": provenance.generation_method,
            }
            for question, provenance in rows
        ],
        "count": len(rows),
    }


@router.post("/practice/answer")
def answer_curriculum_practice_question(
    payload: CurriculumPracticeAnswer,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    selected = payload.selected_option.strip().upper()
    if selected not in {"A", "B", "C", "D"}:
        raise HTTPException(
            status_code=422,
            detail="Choose A, B, C, or D",
        )

    question_id = _uuid(payload.question_id)
    row = _approved_curriculum_question_query(db).filter(
        EduQuestion.id == question_id
    ).first()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Approved curriculum question not found",
        )

    question, _provenance = row
    correct = selected == question.correct_option

    attempt = EduQuestionAttempt(
        uid=current_user.uid,
        question_id=question.id,
        selected_option=selected,
        is_correct=correct,
    )

    try:
        db.add(attempt)
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Your answer could not be recorded",
        )

    return {
        "question_id": str(question.id),
        "selected_option": selected,
        "is_correct": correct,
        "correct_option": question.correct_option,
        "explanation": question.explanation,
    }

