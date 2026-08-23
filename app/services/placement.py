"""
Hi-Mate GSP placement engine.

Locked formulas:
  L = length of username with spaces stripped
  S = sum of UID digits
  C = first-letter index of username (A=0 ... Z=25)
  start_row = ((L + S - 1) % 64) + 1

These are computed server-side ONLY — a client must never be trusted to
submit its own L/S/C/start_row values.

--- Phase 2 addition: the 220-column Relationship Grid bands ---
Locked index setup (core defined space 0-167 of the 220-column grid):
  0-25    Country Index
  26-51   Region/State/LGA Index
  52-77   Locality/City/Town/Community Index
  78-103  Interest/Hobby Index
  116-141 Language Relationship Index
  142-167 User Data Placement Index
(104-115 and 168-219 are intentionally unused/reserved for future growth.)

Each band is 26 slots (A-Z). A value's column within a band is:
  band_start + first_letter_index(value)
"""
import re

from app.config import get_settings

settings = get_settings()

# Column band boundaries — (start, end_exclusive)
COLUMN_BANDS = {
    "country": (0, 26),
    "region": (26, 52),
    "locality": (52, 78),
    "interest": (78, 104),
    "language": (116, 142),
    "user_data": (142, 168),
}


def strip_plus(phone: str) -> str:
    """UID = phone number with '+' removed."""
    return phone.lstrip("+")


def compute_L(name: str) -> int:
    """Length of the name with all whitespace stripped."""
    cleaned = re.sub(r"\s+", "", name or "")
    return len(cleaned)


def compute_S(uid: str) -> int:
    """Sum of all digits in the UID."""
    return sum(int(ch) for ch in uid if ch.isdigit())


def compute_C(name: str) -> int:
    """First-letter index of the name (A=0). Falls back to 0 if not alphabetic."""
    cleaned = (name or "").strip()
    if not cleaned:
        return 0
    first = cleaned[0].upper()
    if "A" <= first <= "Z":
        return ord(first) - ord("A")
    return 0


def compute_start_row(L: int, S: int) -> int:
    """start_row = ((L + S - 1) % 64) + 1"""
    if L + S <= 0:
        return 1
    return ((L + S - 1) % settings.ROW_RANGE) + 1


def compute_placement(name: str, uid: str) -> dict:
    """
    Full placement bundle for a name+uid pair (user, or group name+group_id).
    Returns L, S, C, start_row — always compute this server-side.
    """
    L = compute_L(name)
    S = compute_S(uid)
    C = compute_C(name)
    start_row = compute_start_row(L, S)
    return {"L": L, "S": S, "C": C, "start_row": start_row}


def mod_row(row: int) -> int:
    """Keep a row value within 1..64 (wraps around)."""
    return ((row - 1) % settings.ROW_RANGE) + 1


def compute_column(band: str, value: str | None) -> int | None:
    """
    Compute a value's column within one of the locked grid bands.
    Returns None if the band is unknown or the value is empty — callers
    should treat None as "this dimension doesn't contribute" (matches
    the locked rule: an empty field is skipped, not penalized).
    """
    if not value:
        return None
    bounds = COLUMN_BANDS.get(band)
    if not bounds:
        return None
    start, end = bounds
    letter_index = compute_C(value)  # reuse first-letter logic
    return start + letter_index


def compute_all_columns(country: str | None, region: str | None, locality: str | None,
                         interest: str | None, language: str | None) -> dict:
    """Convenience bundle — computes every band column for a user/entity at once."""
    return {
        "country_col": compute_column("country", country),
        "region_col": compute_column("region", region),
        "locality_col": compute_column("locality", locality),
        "interest_col": compute_column("interest", interest),
        "language_col": compute_column("language", language),
    }


def column_distance(col_a: int | None, col_b: int | None, band_width: int = 26) -> float | None:
    """
    Distance between two columns WITHIN THE SAME BAND, normalized 0..1
    (0 = identical, 1 = maximally far apart within the 26-slot band).
    Returns None if either column is missing (dimension skipped).
    """
    if col_a is None or col_b is None:
        return None
    raw = abs(col_a - col_b)
    return min(raw, band_width - raw) / (band_width / 2)


def elastic_cloud(L: int, S: int, C: int, radius: int = 2) -> list[tuple[int, int, int]]:
    """
    Elastic Cloud — typo-tolerant neighborhood generation.
    Builds a "cloud" of neighboring (L, S, C) triples by perturbing each
    within +/- radius, including the base cell itself. Used for fuzzy
    search / keyboard candidate-word generation — NOT the same mechanism
    as the crawler's row perturbation.
    """
    cloud = []
    for dl in range(-radius, radius + 1):
        for ds in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                cloud.append((max(0, L + dl), max(0, S + ds), (C + dc) % 26))
    return cloud
