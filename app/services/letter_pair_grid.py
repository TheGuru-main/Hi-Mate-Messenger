"""
Hi-Mate secondary Relationship Grid — Country/Username/LGA by full-name
matching. A cell here represents a RELATIONSHIP between two DISTINCT
entities, tied together by the letter pair formed from each entity's
first letter — not a placement index for one entity.

25 schemes, computationally verified to cover all 325 possible unordered
letter pairs across 26 letters, exactly once each, zero collisions.
"""
from dataclasses import dataclass

SCHEMES: dict[int, list[str]] = {
    1: ["AB", "CD", "EF", "GH", "IJ", "KL", "MN", "OP", "QR", "ST", "UV", "WX", "YZ"],
    2: ["BC", "DE", "FG", "HI", "JK", "LM", "NO", "PQ", "RS", "TU", "VZ", "WA", "XY"],
    3: ["AZ", "BY", "CN", "DW", "EV", "FU", "GT", "HS", "IR", "JQ", "KP", "LO", "MX"],
    4: ["ZB", "YC", "ND", "WE", "VF", "UG", "TH", "SI", "RJ", "QK", "PL", "OM", "XA"],
    5: ["AC", "BD", "EH", "FI", "GJ", "KM", "LN", "OQ", "PR", "SU", "TV", "WY", "XZ"],
    6: ["AN", "BO", "CP", "DQ", "ER", "FT", "GS", "HU", "IV", "JW", "KX", "LY", "MZ"],
    7: ["PW", "JX", "HM", "DV", "BN", "QT", "FZ", "KS", "OY", "GL", "AU", "EI", "CR"],
    8: ["VW", "OR", "BP", "MT", "HQ", "DG", "CK", "AY", "IX", "FS", "EN", "JZ", "LU"],
    9: ["BT", "IN", "AS", "DZ", "JM", "EK", "CU", "HR", "VY", "OW", "QX", "FL", "GP"],
    10: ["CS", "NW", "LQ", "FH", "OX", "PZ", "IY", "EU", "BJ", "MR", "GK", "AV", "DT"],
    11: ["GN", "BW", "SZ", "AI", "FO", "LX", "DR", "MQ", "CE", "JU", "HY", "KV", "PT"],
    12: ["JS", "NY", "FQ", "EX", "WZ", "KO", "BU", "IL", "HV", "CT", "GR", "AM", "DP"],
    13: ["AH", "PU", "RW", "SX", "EM", "CL", "GI", "QV", "DY", "TZ", "JO", "BK", "FN"],
    14: ["HP", "GQ", "BV", "CJ", "LS", "DM", "ET", "FY", "AK", "NX", "OU", "RZ", "IW"],
    15: ["NR", "BE", "QW", "OS", "GZ", "LV", "FK", "HJ", "PY", "AT", "IM", "DU", "CX"],
    16: ["HL", "KR", "GX", "SY", "IZ", "JN", "DF", "CV", "OT", "EQ", "UW", "AP", "BM"],
    17: ["PV", "AO", "RY", "NU", "DL", "CW", "JT", "HX", "BS", "QZ", "FM", "EG", "IK"],
    18: ["RX", "QY", "GV", "MU", "DS", "JP", "BF", "AL", "CI", "NZ", "KT", "EO", "HW"],
    19: ["IP", "HK", "BQ", "CM", "AD", "GO", "JL", "RT", "VX", "UY", "NS", "EZ", "FW"],
    20: ["FP", "JY", "BL", "DH", "IO", "NQ", "RV", "KU", "GW", "MS", "AE", "CZ", "TX"],
    21: ["ES", "NP", "AJ", "FR", "UZ", "MV", "HO", "BI", "DX", "KW", "GY", "CQ", "LT"],
    22: ["TY", "KZ", "AR", "HN", "QU", "EL", "MP", "BG", "FX", "JV", "DI", "SW", "CO"],
    23: ["MW", "AG", "LZ", "DO", "RU", "KY", "NV", "FJ", "EP", "BX", "CH", "QS", "IT"],
    24: ["IU", "BH", "OZ", "CF", "EY", "TW", "LR", "DJ", "PX", "AQ", "KN", "GM", "SV"],
    25: ["EJ", "NT", "IQ", "AF", "OV", "BR", "HZ", "PS", "UX", "LW", "DK", "CG", "MY"],
}

# Reverse index: unordered letter pair -> (scheme_id, code as stored)
_PAIR_INDEX: dict[frozenset, tuple[int, str]] = {}
for _scheme_id, _codes in SCHEMES.items():
    for _code in _codes:
        _PAIR_INDEX[frozenset(_code)] = (_scheme_id, _code)


def first_letter(value: str) -> str | None:
    cleaned = (value or "").strip()
    if not cleaned:
        return None
    ch = cleaned[0].upper()
    return ch if "A" <= ch <= "Z" else None


@dataclass
class PairCell:
    scheme_id: int
    code: str
    letter_a: str
    letter_b: str


def resolve_cell(entity_a_value: str, entity_b_value: str) -> PairCell | None:
    """
    Resolve the shared cell for two entities' values (e.g. two usernames,
    two country names, two LGA names) based on their first letters.
    Returns None if either value has no valid first letter, or in the
    (impossible, since all 325 pairs are covered) case a pair isn't claimed.
    A letter paired with itself (same first letter on both sides) has no
    cell — every scheme pairs DISTINCT letters only.
    """
    la = first_letter(entity_a_value)
    lb = first_letter(entity_b_value)
    if not la or not lb or la == lb:
        return None
    entry = _PAIR_INDEX.get(frozenset([la, lb]))
    if not entry:
        return None
    scheme_id, code = entry
    return PairCell(scheme_id=scheme_id, code=code, letter_a=la, letter_b=lb)


def cell_for_letters(letter_a: str, letter_b: str) -> PairCell | None:
    """Same as resolve_cell but takes raw single letters directly."""
    la, lb = letter_a.upper(), letter_b.upper()
    if la == lb:
        return None
    entry = _PAIR_INDEX.get(frozenset([la, lb]))
    if not entry:
        return None
    scheme_id, code = entry
    return PairCell(scheme_id=scheme_id, code=code, letter_a=la, letter_b=lb)
