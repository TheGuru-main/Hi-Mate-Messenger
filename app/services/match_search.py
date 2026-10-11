"""LiveSports search v2: stronger club tokenizer/lexicography, scoped search
(live / upcoming / past), and the last-N-days finished matches feed.

Additive: news.tokenize_club_name / news.search_live_sports are left untouched.
"""

import asyncio
import difflib
import re
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from app.services import news
from app.services.match_detail import _state_of, build_goals

RECENT_FRESH = 300          # seconds a recent-matches list is served without refresh
RECENT_STALE = 6 * 3600     # served instantly (and refreshed behind the scenes) up to this age
MIN_SCORE = 30.0
MAX_RESULTS = 60

# ------------------------------------------------------------------ lexicon

STOP_WORDS = {"fc", "cf", "sc", "afc", "ac", "fk", "bk", "sk", "cd", "ud", "sd", "club", "football", "the"}

# token-level normalisation (applied to both queries and provider names)
TOKEN_ALIASES = {
    "utd": "united", "man": "manchester", "atl": "atletico", "atleti": "atletico",
    "ath": "athletic", "intl": "international", "st": "saint", "bor": "borussia",
    "dep": "deportivo", "rm": "real madrid",
}

# whole-query nicknames -> alternate names to also search for (extend freely)
NICKNAMES = {
    "man u": ["manchester united"], "man utd": ["manchester united"], "man united": ["manchester united"],
    "mufc": ["manchester united"], "man city": ["manchester city"], "mcfc": ["manchester city"],
    "spurs": ["tottenham", "tottenham hotspur"], "barca": ["barcelona"], "juve": ["juventus"],
    "psg": ["paris saint germain", "paris sg"], "atleti": ["atletico madrid"], "wolves": ["wolverhampton"],
    "gunners": ["arsenal"], "villa": ["aston villa"], "forest": ["nottingham forest"],
    "palace": ["crystal palace"], "hammers": ["west ham"], "magpies": ["newcastle"],
    "toffees": ["everton"], "foxes": ["leicester"], "bayern": ["bayern munich", "bayern munchen"],
    "dortmund": ["borussia dortmund"], "gladbach": ["monchengladbach", "borussia monchengladbach"],
    "inter": ["inter milan", "internazionale"], "real": ["real madrid"],
    "super eagles": ["nigeria"], "super falcons": ["nigeria"], "black stars": ["ghana"],
    "bafana bafana": ["south africa"], "indomitable lions": ["cameroon"], "pharaohs": ["egypt"],
    "teranga lions": ["senegal"], "elephants": ["ivory coast", "cote divoire"],
    "three lions": ["england"], "la roja": ["spain"], "selecao": ["brazil"], "les bleus": ["france"],
}


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.lower().replace("&", " and ")


def normalize(text: str) -> str:
    text = re.sub(r"['’`]", "", _fold(text))
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text).split())


def tokenize(text: str) -> list[str]:
    out = []
    for tok in normalize(text).split():
        if tok in STOP_WORDS:
            continue
        out.extend(TOKEN_ALIASES.get(tok, tok).split())
    return out


def query_variants(query: str) -> list[list[str]]:
    """The query itself plus nickname expansions, each as a token list."""
    norm = normalize(query)
    variants = [tokenize(query)]
    for alt in NICKNAMES.get(norm, []):
        variants.append(tokenize(alt))
    return [v for v in variants if v]


# ------------------------------------------------------------------ scoring

def score_name(q_tokens: list[str], name: str) -> float:
    t_tokens = tokenize(name)
    if not q_tokens or not t_tokens:
        return 0.0
    q_text, t_text = " ".join(q_tokens), " ".join(t_tokens)

    if q_text == t_text:
        return 100.0
    if set(q_tokens) == set(t_tokens):
        return 95.0
    if t_text.startswith(q_text):
        return 90.0
    if f" {q_text} " in f" {t_text} ":
        return 85.0

    used, total, strong = set(), 0.0, False
    for i, qt in enumerate(q_tokens):
        last = i == len(q_tokens) - 1
        best_j, best_w = None, 0.0
        for j, tt in enumerate(t_tokens):
            if j in used:
                continue
            if qt == tt:
                w = 1.0
            elif (len(qt) >= 2 or last) and tt.startswith(qt):
                w = 0.92
            elif len(qt) >= 4 and len(tt) >= 4:
                ratio = difflib.SequenceMatcher(None, qt, tt).ratio()
                if ratio < 0.8:
                    continue
                w = 0.8 * ratio
            else:
                continue
            if w > best_w:
                best_j, best_w = j, w
        if best_j is not None:
            used.add(best_j)
            total += best_w
            if len(qt) >= 3:
                strong = True
    if not strong:
        return 0.0
    return 80.0 * (total / len(q_tokens))


def score_match(variants: list[list[str]], match: dict) -> tuple[float, str]:
    best, kind = 0.0, ""
    for q_tokens in variants:
        for team in (match.get("home_team"), match.get("away_team")):
            s = score_name(q_tokens, team or "")
            if s > best:
                best, kind = s, "team"
        for field in (match.get("league"), match.get("country")):
            s = min(score_name(q_tokens, field or ""), 100.0) * 0.55
            if s > best:
                best, kind = s, "league"
    return best, kind


# ------------------------------------------------------------------ caching (stale-while-revalidate)

_cache: dict = {}
_inflight: dict = {}


async def _refresh(key, loader):
    try:
        data = await loader()
        _cache[key] = (time.time(), data)
        return data
    finally:
        _inflight.pop(key, None)


async def _background(key, loader):
    try:
        await _refresh(key, loader)
    except Exception:
        pass


async def _swr(key, loader, fresh: int, stale: int):
    hit = _cache.get(key)
    age = time.time() - hit[0] if hit else None
    if hit and age < fresh:
        return hit[1]
    if hit and age < stale:
        if key not in _inflight:
            _inflight[key] = asyncio.create_task(_background(key, loader))
        return hit[1]
    task = _inflight.get(key)
    if task is None:
        task = asyncio.create_task(_refresh(key, loader))
        _inflight[key] = task
    return await task


# ------------------------------------------------------------------ recent (past) matches

def _compact_goals(ev: dict) -> list[dict]:
    return [
        {"side": g["side"], "player": g["player"], "minute": g["minute"], "type": g["type"]}
        for g in build_goals(ev)
    ]


async def _load_recent(days: int, tz_name: str) -> list[dict]:
    try:
        user_tz = ZoneInfo(tz_name)
    except Exception:
        user_tz, tz_name = timezone.utc, "UTC"
    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(user_tz)
    events = await news._allsports_request({
        "met": "Fixtures",
        "from": (now_local - timedelta(days=days)).date().isoformat(),
        "to": now_local.date().isoformat(),
        "timezone": tz_name,
    })
    cutoff = now_utc - timedelta(days=days)
    out = []
    for ev in events:
        if _state_of(ev) != "finished":
            continue
        starting_at = news._event_starting_at_utc(ev, tz_name)
        if not starting_at:
            continue
        try:
            kickoff = datetime.fromisoformat(str(starting_at).replace("Z", "+00:00"))
        except ValueError:
            continue
        if kickoff > now_utc or kickoff < cutoff:
            continue
        mapped = news._map_event(ev, upcoming=False, display_timezone=tz_name)
        mapped["finished"] = True
        mapped["minute"] = "FT"
        mapped["goals"] = _compact_goals(ev)
        out.append(mapped)
    out.sort(key=lambda r: r.get("starting_at") or "", reverse=True)
    return out


def _clamp_days(days) -> int:
    try:
        return max(1, min(int(days), 7))
    except (TypeError, ValueError):
        return 3


async def fetch_recent_fixtures(days: int = 3, display_timezone: str = "UTC") -> list[dict]:
    days = _clamp_days(days)
    tz_name = news._valid_timezone(display_timezone)
    return await _swr(
        f"recent:{days}:{tz_name}",
        lambda: _load_recent(days, tz_name),
        RECENT_FRESH, RECENT_STALE,
    )


async def find_recent_fixture(fixture_id) -> dict | None:
    """Used by the room-join route so past matches can open a room too."""
    try:
        for m in await fetch_recent_fixtures(3, "UTC"):
            if str(m.get("fixture_id")) == str(fixture_id):
                return m
    except Exception:
        pass
    return None


# ------------------------------------------------------------------ scoped search

def _tag(items, scope):
    out = []
    for m in items:
        d = dict(m)
        d["scope"] = scope
        out.append(d)
    return out


_SCOPE_ORDER = {"live": 0, "upcoming": 1, "past": 2}


async def search(query: str, scope: str = "all", days: int = 3, display_timezone: str = "UTC") -> list[dict]:
    scope = scope if scope in ("all", "live", "upcoming", "past") else "all"
    days = _clamp_days(days)
    variants = query_variants(query)

    if scope == "past" and not variants:
        return _tag(await fetch_recent_fixtures(days, display_timezone), "past")[:MAX_RESULTS]
    if not variants:
        return []

    jobs = {}
    if scope in ("all", "live"):
        jobs["live"] = news.fetch_live_fixtures()
    if scope in ("all", "upcoming"):
        jobs["upcoming"] = news.fetch_upcoming_fixtures(hours=168, display_timezone=display_timezone)
    if scope in ("all", "past"):
        jobs["past"] = fetch_recent_fixtures(days, display_timezone)

    names = list(jobs)
    gathered = await asyncio.gather(*jobs.values(), return_exceptions=True)
    sources = dict(zip(names, gathered))
    if all(isinstance(v, Exception) for v in sources.values()):
        raise next(iter(sources.values()))

    seen, results = set(), []
    for name in ("live", "upcoming", "past"):
        items = sources.get(name)
        if not items or isinstance(items, Exception):
            continue
        for m in _tag(items, name):
            fid = str(m.get("fixture_id") or "")
            if not fid or fid in seen:
                continue
            seen.add(fid)
            score, kind = score_match(variants, m)
            if score < MIN_SCORE:
                continue
            m["_search_score"] = round(score, 1)
            m["matched_on"] = kind
            results.append(m)

    def epoch(m):
        try:
            return datetime.fromisoformat(str(m.get("starting_at")).replace("Z", "+00:00")).timestamp()
        except Exception:
            return 0.0

    def order(m):
        t = epoch(m)
        # live/upcoming: soonest first; past: newest first
        return (-m["_search_score"], _SCOPE_ORDER[m["scope"]], -t if m["scope"] == "past" else t)

    results.sort(key=order)
    return results[:MAX_RESULTS]
