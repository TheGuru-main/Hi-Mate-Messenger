from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.pairwise_relationship import PairwiseRelationship
from app.services.letter_pair_grid import resolve_cell

router = APIRouter(prefix="/pairwise", tags=["pairwise-grid"])


class PairwiseCreate(BaseModel):
    other_uid: str
    relationship_type: str | None = None


@router.post("/link")
async def create_pairwise_link(
    payload: PairwiseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    other = db.query(User).filter(User.uid == payload.other_uid).first()
    if not other:
        raise HTTPException(status_code=404, detail="Other user not found")

    cell = resolve_cell(current_user.username, other.username)
    if not cell:
        raise HTTPException(
            status_code=422,
            detail="Could not resolve a shared cell (identical first letters have no pairwise cell)",
        )

    link = PairwiseRelationship(
        entity_a_uid=current_user.uid,
        entity_b_uid=other.uid,
        scheme_id=cell.scheme_id,
        cell_code=cell.code,
        relationship_type=payload.relationship_type,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return {
        "id": str(link.id),
        "cell_code": cell.code,
        "scheme_id": cell.scheme_id,
        "letters": [cell.letter_a, cell.letter_b],
    }


@router.get("/cell/{code}")
async def get_relationships_at_cell(
    code: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Everyone/everything filed at a given letter-pair cell."""
    links = db.query(PairwiseRelationship).filter(
        PairwiseRelationship.cell_code == code.upper()
    ).all()
    return [
        {
            "id": str(l.id),
            "entity_a_uid": l.entity_a_uid,
            "entity_b_uid": l.entity_b_uid,
            "relationship_type": l.relationship_type,
        }
        for l in links
    ]
