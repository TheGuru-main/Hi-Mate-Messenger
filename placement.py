"""
Hi-Mate GSP placement engine.

Locked formulas:
  L = length of username with spaces stripped
  S = sum of UID digits
  C = first-letter index of username (A=0 ... Z=25)
  start_row = ((L + S - 1) % 64) + 1

These are computed server-side ONLY — a client must never be trusted to
submit its own L/S/C/start_row values.
"""
import re

from app.config import get_settings

settings = get_settings()


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


def elastic_cloud(L: int, S: int, C: int, radius: int = 2) -> list[tuple[int, int, int]]:
    """
    Elastic Cloud — typo-tolerant neighborhood generation.
    Builds a "cloud" of neighboring (L, S, C) triples by perturbing each
    within +/- radius, including the base cell itself. Used for fuzzy
    search / keyboard candidate-word generation — NOT the same mechanism
    as the crawler's row perturbation below.
    """
    cloud = []
    for dl in range(-radius, radius + 1):
        for ds in range(-radius, radius + 1):
            for dc in range(-radius, radius + 1):
                cloud.append((max(0, L + dl), max(0, S + ds), (C + dc) % 26))
    return cloud
