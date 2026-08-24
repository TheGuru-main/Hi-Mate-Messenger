"""
Hi-Mate lexico search engine — SEARCH SUPPORT ONLY.

This is a separate architecture from the user-relationship crawler
(app/services/crawler.py). It powers free-text search over content
(posts, usernames, categories) — not user-to-user relationship placement.
Uses Hi-Mate's own category map/cell mapping — distinct from Shop Near
Me's and RECCORD DB's separate mappings, per project boundaries.

Pipeline (locked shape):
  Letter grid  -> Word grid -> Lexico matching/arrangement -> Semantic/category arrangement

1. LETTER GRID (26x1, per language)
   Each letter of a token resolves to a fixed cell (a-z -> 0-25).
   Multi-language ready: a language code selects the alphabet used.
   Currently English is implemented; the other languages from the GSP
   Keyboard's locked layouts (Yoruba, Igbo, Hausa, French, Arabic,
   Chinese-Pinyin, Spanish, Portuguese, Swahili, ...) are stubbed for
   extension up to the keyboard's full 15-language set — see
   LANGUAGE_ALPHABETS below.

2. WORD GRID (26x26)
   A word resolves to a (L, S) cell:
     L = length of the word
     S = sum of character codes in the word
   This gives exact structural matching between query tokens and indexed
   content tokens, independent of meaning.

3. LEXICO MATCHING
   exact word -> exact phrase -> word-order match -> partial phrase ->
   stem/variant -> related lexical form (synonym/dialect expansion)

4. SEMANTIC/CATEGORY ARRANGEMENT
   After lexico matching produces candidates, a category-intent detector
   (against Hi-Mate's OWN locked Feed Categories, not Shop Near Me's
   category list) re-ranks them by how well they match what the user
   actually means.
"""
import re
from dataclasses import dataclass

# ---------- 1. Letter grid (multi-language ready) ----------

LANGUAGE_ALPHABETS = {
    "en": "abcdefghijklmnopqrstuvwxyz",
    # Stubs for the GSP Keyboard's other locked languages — fill in as
    # each language's own letter grid is defined. Falls back to English
    # if a language isn't in this map yet.
    "yo": None,  # Yoruba
    "ig": None,  # Igbo
    "ha": None,  # Hausa
    "fr": None,  # French
    "ar": None,  # Arabic
    "zh": None,  # Chinese (Pinyin)
    "es": None,  # Spanish
    "pt": None,  # Portuguese
    "sw": None,  # Swahili
}


def letter_cell(letter: str, language: str = "en") -> int | None:
    """Resolve a single letter to its fixed 0-25 cell for the given language."""
    alphabet = LANGUAGE_ALPHABETS.get(language) or LANGUAGE_ALPHABETS["en"]
    letter = letter.lower()
    idx = alphabet.find(letter)
    return idx if idx >= 0 else None


def letter_sequence(word: str, language: str = "en") -> list[int | None]:
    """Every letter of a word resolved to its grid cell, in order."""
    return [letter_cell(ch, language) for ch in word if ch.isalpha()]


# ---------- 2. Word grid (26x26, structural) ----------

def word_grid_cell(word: str) -> tuple[int, int]:
    """
    (L, S) structural cell for a word:
      L = word length
      S = sum of character codes, folded into 0-25 for a real grid column
    """
    clean = word.strip().lower()
    if not clean:
        return (0, 0)
    L = len(clean)
    S = sum(ord(ch) for ch in clean) % 26
    return (min(L, 25), S)


def word_grid_distance(cell_a: tuple[int, int], cell_b: tuple[int, int]) -> int:
    """Manhattan distance between two word-grid cells — smaller = structurally closer."""
    return abs(cell_a[0] - cell_b[0]) + abs(cell_a[1] - cell_b[1])


# ---------- 3. Lexico matching ----------

def tokenize(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-zA-Z0-9]+", text.lower()) if t]


def stem(word: str) -> str:
    """Light suffix-stripping stemmer — same shape as Shop Near Me's, kept simple on purpose."""
    w = word.lower()
    if len(w) > 4 and w.endswith("ing"):
        return w[:-3]
    if len(w) > 4 and w.endswith("ed"):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


# Synonym/related-term expansion — Hi-Mate's own starter set, separate
# from Shop Near Me's DIALECT_MAP/DICTIONARY. Extend as needed.
RELATED_TERMS: dict[str, list[str]] = {
    "footballer": ["football", "soccer player", "player"],
    "football": ["soccer", "footballer"],
    "soccer": ["football"],
    "musician": ["singer", "artist", "performer"],
    "developer": ["programmer", "coder", "software engineer"],
    "tailor": ["fashionista", "fashion designer"],
    "photographer": ["photography", "camera work"],
}


def expand_tokens(tokens: list[str]) -> set[str]:
    """Expand query tokens with stems and related terms — this is the
    'stem/variant' and 'related lexical form' steps of lexico matching."""
    expanded = set(tokens)
    for tok in tokens:
        expanded.add(stem(tok))
        if tok in RELATED_TERMS:
            expanded.update(RELATED_TERMS[tok])
    return expanded


@dataclass
class LexicoMatch:
    exact_word: bool = False
    exact_phrase: bool = False
    word_order: bool = False
    partial_phrase: bool = False
    stem_variant: bool = False
    related_form: bool = False

    def score(self) -> float:
        # Weighted so more precise matches always outrank looser ones —
        # a real exact phrase always beats a pile of related-form hits.
        return (
            (30 if self.exact_phrase else 0)
            + (20 if self.exact_word else 0)
            + (12 if self.word_order else 0)
            + (8 if self.partial_phrase else 0)
            + (5 if self.stem_variant else 0)
            + (2 if self.related_form else 0)
        )


def lexico_match(query: str, target: str) -> LexicoMatch:
    q_tokens = tokenize(query)
    t_tokens = tokenize(target)
    q_expanded = expand_tokens(q_tokens)
    t_text = " ".join(t_tokens)
    q_text = " ".join(q_tokens)

    match = LexicoMatch()
    if q_text and q_text == t_text:
        match.exact_phrase = True
    elif q_text and q_text in t_text:
        match.partial_phrase = True

    if set(q_tokens) & set(t_tokens):
        match.exact_word = True
    if q_tokens and all(tok in t_tokens for tok in q_tokens):
        # crude word-order check: tokens appear in the same relative order
        positions = [t_tokens.index(tok) for tok in q_tokens if tok in t_tokens]
        if positions == sorted(positions):
            match.word_order = True

    stems_t = {stem(t) for t in t_tokens}
    if any(stem(q) in stems_t for q in q_tokens):
        match.stem_variant = True

    if q_expanded & set(t_tokens):
        match.related_form = True

    return match


# ---------- 4. Semantic/category arrangement ----------
# Hi-Mate's OWN locked Feed Categories — distinct from Shop Near Me's category list.
FEED_CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Technology": ["tech", "software", "developer", "app", "code", "programming"],
    "AI": ["ai", "artificial intelligence", "machine learning", "model"],
    "Education": ["school", "education", "learning", "course", "study"],
    "Business": ["business", "startup", "entrepreneur", "company"],
    "Medical": ["medical", "health", "doctor", "hospital", "clinic"],
    "Health & Fitness": ["fitness", "gym", "workout", "health", "exercise"],
    "Entertainment": ["entertainment", "movie", "music", "show", "celebrity"],
    "Sports": ["sport", "football", "soccer", "basketball", "match", "league", "player"],
    "News": ["news", "breaking", "headline", "report"],
    "Religion & Culture": ["religion", "culture", "faith", "tradition"],
    "Lifestyle": ["lifestyle", "fashion", "travel", "food"],
    "Advertisement": ["ad", "advertisement", "promo", "sponsored"],
    "Personal": ["personal", "life", "family", "friend"],
}


def detect_category(query: str) -> str | None:
    """Best-guess Feed Category for a search query, using Hi-Mate's own keyword map."""
    tokens = set(tokenize(query))
    scores: dict[str, int] = {}
    for category, keywords in FEED_CATEGORY_KEYWORDS.items():
        for kw in keywords:
            kw_tokens = set(tokenize(kw))
            if kw_tokens & tokens:
                scores[category] = scores.get(category, 0) + 1
    if not scores:
        return None
    return max(scores.items(), key=lambda item: item[1])[0]


# ---------- Search fusion ----------

@dataclass
class SearchCandidate:
    id: str
    text: str          # the searchable text (post content, username, etc.)
    category: str | None = None


@dataclass
class SearchResult:
    candidate: SearchCandidate
    lexico_score: float
    category_boost: float
    total: float


def search_fusion(query: str, candidates: list[SearchCandidate], limit: int = 25) -> list[SearchResult]:
    """
    Full pipeline: lexico matching against every candidate, then a
    category boost if the candidate's category matches the query's
    detected intent domain. This is search support only — no user
    placement, no relationship-grid coordinates involved.
    """
    intended_category = detect_category(query)
    results: list[SearchResult] = []

    for cand in candidates:
        match = lexico_match(query, cand.text)
        lexico_score = match.score()

        category_boost = 0.0
        if intended_category and cand.category:
            category_boost = 25.0 if cand.category == intended_category else 0.0

        total = lexico_score + category_boost
        if total > 0:
            results.append(SearchResult(candidate=cand, lexico_score=lexico_score, category_boost=category_boost, total=total))

    results.sort(key=lambda r: r.total, reverse=True)
    return results[:limit]
