"""
Hi-Mate relationship-grid crawler.

Locked walk formula (part of the core K=250 relationship-grid calc,
not crawler-only):
  At every step k (0..250):
    forward  row = start_row + k*5   (D=5, one jump per step)
    backward: 5 steps of D=1 happen for every 1 forward step
              -> by k=250, backward has taken 5*250 = 1,250 total unit steps

Filter order (strict tiers, NOT an additive weighted sum):
  1. Nearest (proximity)
  2. Category (Talent Field / Business field, exact match)
  3. Role (hierarchy-based HARD FILTER — non-hierarchy roles excluded entirely)
  4. Sibling-field (last tier)

Role hierarchy is a real filter: a candidate whose role isn't in the
searcher's hierarchy list is excluded from results, not just down-weighted.
"""
from dataclasses import dataclass, field
from typing import Callable

from app.config import get_settings

settings = get_settings()

ROW_RANGE = settings.ROW_RANGE
FORWARD_D = settings.FORWARD_D
BACKWARD_D = settings.BACKWARD_D
SHARED_K = settings.RELATIONSHIP_K

SURFACE_CAPS = {
    "feed": settings.CAP_FEED,
    "klique": settings.CAP_KLIQUE,
    "other": settings.CAP_OTHER,
}

# Role hierarchy — closest-to-farthest per role. Position drives the Role
# score (20 / 15 / 10). A role NOT in this list is excluded entirely.
ROLE_HIERARCHY = {
    "Talent": ["Scout", "Talent", "Mini Org"],  # Big Org reached only via mediation, not direct
    "Scout": ["Talent", "Mini Org", "Big Org"],
    "Mini Org": ["Talent", "Big Org", "Scout"],
    "Big Org": ["Mini Org", "Scout", "Talent"],  # "hot talent" modeled as Talent
    "User": ["Talent", "Scout", "Mini Org", "Big Org", "User"],  # unrestricted, per current assumption
}
ROLE_POSITION_SCORES = [20, 15, 10]

# Sibling-field clusters (adjacent fields, smaller relevance bonus)
SIBLING_CLUSTERS = [
    {"T", "F", "H", "M", "L"},  # tailor - fashionista - fashion house - musician - model
]


def mod_row(row: int) -> int:
    return ((row - 1) % ROW_RANGE) + 1


def role_match(searcher_role: str, candidate_role: str) -> int | None:
    """Returns the Role score, or None if the candidate's role isn't in the
    searcher's hierarchy at all (meaning: EXCLUDE this candidate)."""
    order = ROLE_HIERARCHY.get(searcher_role, [])
    if candidate_role not in order:
        return None
    idx = order.index(candidate_role)
    return ROLE_POSITION_SCORES[idx] if idx < len(ROLE_POSITION_SCORES) else 5


def sibling_of(field_a: str, field_b: str) -> bool:
    if field_a == field_b:
        return False
    return any(field_a in c and field_b in c for c in SIBLING_CLUSTERS)


@dataclass
class WalkStep:
    k: int
    forward_row: int
    backward_rows: list[int] = field(default_factory=list)


def walk_steps(start_row: int, max_k: int = SHARED_K):
    """
    Generator yielding each step of the locked forward/backward walk.
    Forward: one jump of 5 per step k.
    Backward: 5 unit-steps of 1 per the SAME step k (5x more frequent).
    """
    for k in range(0, max_k + 1):
        forward_row = mod_row(start_row + k * FORWARD_D)
        backward_rows = []
        if k > 0:
            for j in range(1, 6):
                step_num = 5 * (k - 1) + j
                backward_rows.append(mod_row(start_row - step_num * BACKWARD_D))
        yield WalkStep(k=k, forward_row=forward_row, backward_rows=backward_rows)


@dataclass
class Candidate:
    id: str
    row: int
    field: str | None = None
    role: str | None = None
    country: str | None = None
    language: str | None = None
    reacted: bool = False
    created_at_score: float = 0.0  # freshness input, higher = fresher


@dataclass
class ScoredResult:
    candidate: Candidate
    distance: int
    scores: dict
    total: float


def crawl(
    searcher_row: int,
    searcher_field: str,
    searcher_role: str,
    searcher_country: str,
    searcher_language: str,
    surface: str,
    fetch_candidates_at_row: Callable[[int], list[Candidate]],
) -> list[ScoredResult]:
    """
    Runs the locked crawler walk and returns ranked, capped results.

    `fetch_candidates_at_row` is injected so this stays a pure algorithm —
    the caller wires it to a real DB query (e.g. "SELECT * FROM users WHERE
    start_row = :row").
    """
    cap = SURFACE_CAPS.get(surface, SURFACE_CAPS["other"])
    seen_ids: set[str] = set()
    results: list[ScoredResult] = []

    def score_candidate(cand: Candidate, row: int) -> ScoredResult:
        distance = min(abs(row - searcher_row), ROW_RANGE - abs(row - searcher_row))
        proximity = max(0.0, 50 * (1 - distance / ROW_RANGE))
        category = 40 if cand.field == searcher_field else (5 if sibling_of(cand.field or "", searcher_field) else 0)
        location = 20 if cand.country == searcher_country else 0
        language = 15 if cand.language == searcher_language else 0
        reacted = 10 if cand.reacted else 0
        freshness = min(5.0, cand.created_at_score)
        role_score = role_match(searcher_role, cand.role or "") or 0
        total = proximity + category + location + language + reacted + freshness + role_score
        return ScoredResult(
            candidate=cand,
            distance=distance,
            scores={
                "proximity": proximity,
                "category": category,
                "role": role_score,
                "location": location,
                "language": language,
                "reacted": reacted,
                "freshness": freshness,
            },
            total=total,
        )

    for step in walk_steps(searcher_row):
        if len(results) >= cap:
            break
        rows_this_step = [step.forward_row] + step.backward_rows
        for row in rows_this_step:
            if len(results) >= cap:
                break
            for cand in fetch_candidates_at_row(row):
                if cand.id in seen_ids or len(results) >= cap:
                    continue
                role_score = role_match(searcher_role, cand.role or "")
                if role_score is None:
                    continue  # HARD FILTER — not in hierarchy, excluded entirely
                seen_ids.add(cand.id)
                results.append(score_candidate(cand, row))

    # Strict tiered sort: nearest -> category -> role -> (remaining as tiebreak)
    results.sort(
        key=lambda r: (
            r.distance,
            -r.scores["category"],
            -r.scores["role"],
            -r.total,
        )
    )
    return results
