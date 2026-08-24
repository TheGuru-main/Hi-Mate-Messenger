"""
Hi-Mate relationship-grid crawler.

Locked walk formula (part of the core K=250 relationship-grid calc,
not crawler-only):
  At every step k (0..250):
    forward  row = start_row + k*5   (D=5, one jump per step)
    backward: 5 steps of D=1 happen for every 1 forward step
              -> by k=250, backward has taken 5*250 = 1,250 total unit steps

Filter order (strict tiers, NOT an additive weighted sum):
  1. Nearest (proximity, row axis)
  2. Category (Talent Field / Business field, exact match)
  3. Role (hierarchy-based HARD FILTER — non-hierarchy roles excluded entirely)
  4. Sibling-field (last tier)

Location (20) and Language (15) use real column distance within their
grid bands — exact match = full weight, near-miss = partial credit,
missing value on either side = dimension skipped (no penalty).

Interest (10) — PROPOSED weight, not part of the originally locked
ranking table (which only specified Relationship/Category/Role/Location/
Language/Reacted/Freshness/Sibling-field). Flagged for confirmation.
"""
from dataclasses import dataclass, field
from typing import Callable

from app.config import get_settings
from app.services.placement import compute_column, column_distance

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

ROLE_HIERARCHY = {
    "Talent": ["Scout", "Talent", "Mini Org"],
    "Scout": ["Talent", "Mini Org", "Big Org"],
    "Mini Org": ["Talent", "Big Org", "Scout"],
    "Big Org": ["Mini Org", "Scout", "Talent"],
    "User": ["Talent", "Scout", "Mini Org", "Big Org", "User"],
}
ROLE_POSITION_SCORES = [20, 15, 10]

SIBLING_CLUSTERS = [
    {"T", "F", "H", "M", "L"},
]

# PROPOSED — not locked. Interest/Hobby band weight.
INTEREST_WEIGHT = 10


def mod_row(row: int) -> int:
    return ((row - 1) % ROW_RANGE) + 1


def role_match(searcher_role: str, candidate_role: str) -> int | None:
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
    region: str | None = None
    locality: str | None = None
    language: str | None = None
    interest: str | None = None
    reacted: bool = False
    created_at_score: float = 0.0


@dataclass
class ScoredResult:
    candidate: Candidate
    distance: int
    scores: dict
    total: float


def _band_score(weight: float, col_a: int | None, col_b: int | None) -> float:
    dist = column_distance(col_a, col_b)
    if dist is None:
        return 0.0
    return weight * (1 - dist)


def crawl(
    searcher_row: int,
    searcher_field: str,
    searcher_role: str,
    searcher_country: str,
    searcher_region: str,
    searcher_locality: str,
    searcher_language: str,
    surface: str,
    fetch_candidates_at_row: Callable[[int], list[Candidate]],
    searcher_interest: str = "",
) -> list[ScoredResult]:
    cap = SURFACE_CAPS.get(surface, SURFACE_CAPS["other"])
    seen_ids: set[str] = set()
    results: list[ScoredResult] = []

    s_country_col = compute_column("country", searcher_country)
    s_region_col = compute_column("region", searcher_region)
    s_locality_col = compute_column("locality", searcher_locality)
    s_language_col = compute_column("language", searcher_language)
    s_interest_col = compute_column("interest", searcher_interest)

    def score_candidate(cand: Candidate, row: int) -> ScoredResult:
        distance = min(abs(row - searcher_row), ROW_RANGE - abs(row - searcher_row))
        proximity = max(0.0, 50 * (1 - distance / ROW_RANGE))
        category = 40 if cand.field == searcher_field else (5 if sibling_of(cand.field or "", searcher_field) else 0)

        c_country_col = compute_column("country", cand.country)
        c_region_col = compute_column("region", cand.region)
        c_locality_col = compute_column("locality", cand.locality)
        location = (
            _band_score(20 / 3, s_country_col, c_country_col)
            + _band_score(20 / 3, s_region_col, c_region_col)
            + _band_score(20 / 3, s_locality_col, c_locality_col)
        )

        c_language_col = compute_column("language", cand.language)
        language = _band_score(15, s_language_col, c_language_col)

        c_interest_col = compute_column("interest", cand.interest)
        interest = _band_score(INTEREST_WEIGHT, s_interest_col, c_interest_col)

        reacted = 10 if cand.reacted else 0
        freshness = min(5.0, cand.created_at_score)
        role_score = role_match(searcher_role, cand.role or "") or 0
        total = proximity + category + location + language + interest + reacted + freshness + role_score
        return ScoredResult(
            candidate=cand,
            distance=distance,
            scores={
                "proximity": proximity,
                "category": category,
                "role": role_score,
                "location": location,
                "language": language,
                "interest": interest,
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
                    continue
                seen_ids.add(cand.id)
                results.append(score_candidate(cand, row))

    results.sort(
        key=lambda r: (
            r.distance,
            -r.scores["category"],
            -r.scores["role"],
            -r.total,
        )
    )
    return results
