"""Hybrid retrieval + smart ranking for LAVA.

Pipeline:  hybrid (BM25-ish FTS + pgvector cosine, fused with RRF)
           -> quality/domain/relevance-aware smart ranking
           -> MMR diversification
           -> evidence pack for the synthesizer.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from . import config
from .db import fetch_all
from .embed import Embedder, to_pgvector
from .text import domain_density, words

_EMBEDDER: Embedder | None = None

STOP = set("""a an the and or but if while of to in on for with without from by as at is are was were be been
what which who how why when where does do did is are can could should would will""".split())


def embedder() -> Embedder:
    global _EMBEDDER
    if _EMBEDDER is None:
        _EMBEDDER = Embedder()
    return _EMBEDDER


@dataclass
class Hit:
    chunk_id: int
    document_id: int
    title: str
    source_id: str
    ordinal: int
    kind: str
    section_path: str | None
    content: str
    vector_score: float = 0.0
    keyword_score: float = 0.0
    fused_score: float = 0.0
    rerank_score: float = 0.0
    final_score: float = 0.0
    quality_score: float = 0.0
    landing_url: str = ""
    published_date: str | None = None
    sub_question: str | None = None
    relevance: str = "unrated"
    meta: dict = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "chunk_id": self.chunk_id, "document_id": self.document_id,
            "title": self.title, "source_id": self.source_id,
            "ordinal": self.ordinal, "kind": self.kind,
            "section_path": self.section_path,
            "content": self.content,
            "vector_score": round(self.vector_score, 4),
            "keyword_score": round(self.keyword_score, 4),
            "fused_score": round(self.fused_score, 6),
            "rerank_score": round(self.rerank_score, 4),
            "final_score": round(self.final_score, 4),
            "quality_score": round(self.quality_score, 4),
            "landing_url": self.landing_url,
            "published_date": str(self.published_date) if self.published_date else None,
            "sub_question": self.sub_question,
            "relevance": self.relevance,
        }


def hybrid_search(question: str, k: int = 24, pool: int = 80,
                  model_name: str | None = None) -> list[Hit]:
    """Run RRF fusion of keyword + vector search in Postgres."""
    qvec = embedder().embed_one(question)
    rows = fetch_all(
        "SELECT * FROM ignis.search_chunks_hybrid(%s, %s::vector, %s, %s, %s)",
        (question, to_pgvector(qvec), k, pool, model_name or config.EMBED_MODEL),
    )
    hits = [Hit(
        chunk_id=r["chunk_id"], document_id=r["document_id"], title=r["title"],
        source_id=r["source_id"], ordinal=r["ordinal"], kind=str(r["kind"]),
        section_path=r["section_path"], content=r["content"],
        vector_score=float(r["vector_score"] or 0),
        keyword_score=float(r["keyword_score"] or 0),
        fused_score=float(r["fused_score"] or 0),
    ) for r in rows]
    return _enrich(hits)


def _enrich(hits: list[Hit]) -> list[Hit]:
    """Attach document metadata (quality, landing URL, date) to hits."""
    if not hits:
        return hits
    ids = list({h.document_id for h in hits})
    rows = fetch_all(
        """SELECT id, quality_score, landing_url, published_date
             FROM ignis.document WHERE id = ANY(%s)""",
        (ids,),
    )
    meta = {r["id"]: r for r in rows}
    for h in hits:
        m = meta.get(h.document_id)
        if m:
            h.quality_score = float(m["quality_score"] or 0)
            h.landing_url = m["landing_url"] or ""
            h.published_date = m["published_date"]
    return hits


# Smart ranking

def stem(word: str) -> str:
    """Light English stemmer, matched to the `english` text-search config.

    Postgres reduces "burning" -> "burn" and "flames" -> "flame" at index time;
    the rerank has to make the same reduction or it scores a real keyword match
    as a miss.
    """
    w = re.sub(r"[^a-z0-9]", "", word.lower())
    if len(w) <= 3 or any(c.isdigit() for c in w):
        return w
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"
    if w.endswith("sses"):
        return w[:-2]
    if w.endswith("ss"):
        return w
    # "analysis"/"analyses" and "basis"/"bases" must reduce to the same stem.
    if w.endswith("sis"):
        return w[:-3] + "s"
    if w.endswith("es"):
        trimmed = w[:-2]
        w = trimmed if re.search(r"(?:s|x|z|ch|sh)$", trimmed) else w[:-1]
    elif w.endswith("s"):
        w = w[:-1]
    if w.endswith("ing") and len(w) > 5:
        w = w[:-3]
    elif w.endswith("edly"):
        w = w[:-4]
    elif w.endswith("ed") and len(w) > 4:
        w = w[:-2]
    elif w.endswith("ly") and len(w) > 4 and w not in ADVERB_KEEP:
        w = w[:-2]
    if w.endswith("e") and len(w) > 4:
        w = w[:-1]
    return w


# Words that end in -ly but are not adverbs; stripping would mangle them.
ADVERB_KEEP = {
    "family", "only", "early", "daily", "likely", "apply", "supply", "reply",
    "multiply", "imply", "italy", "july", "ugly", "fully", "assembly", "anomaly",
}

# Domain synonyms, applied to the query only (see retrieval.ts for the reason).
# Keys and values are stems.
_RAW_SYNONYMS = {
    "smolder": ["smoulder"], "smoulder": ["smolder"],
    "oxidizer": ["oxidiser"], "oxidiser": ["oxidizer"],
    "extinction": ["quench", "suppression", "extinguish", "extinguishment"],
    "quench": ["extinction", "suppression"], "suppress": ["extinction", "quench"],
    "extinguish": ["extinction", "quench"],
    "ignition": ["autoignition"],
    "flammability": ["flammable"], "flammable": ["flammability"],
    "buoyancy": ["buoyant"],
    "radiative": ["radiation"], "radiation": ["radiative"],
    "concentration": ["fraction"],
    "velocity": ["speed", "rate"], "speed": ["velocity", "rate"],
    "efficacy": ["efficiency", "performance"],
    "droplet": ["drop"],
    "microgravity": ["weightlessness"],
    "spacecraft": ["vehicle", "iss"],
    "smoke": ["soot", "aerosol"],
    "soot": ["smoke", "aerosol", "particulate"],
    "aerosol": ["particulate", "particle"],
}


def _build_synonyms() -> dict[str, list[str]]:
    out: dict[str, set[str]] = {}
    for k, vs in _RAW_SYNONYMS.items():
        out.setdefault(stem(k), set()).update(stem(v) for v in vs)
    return {k: sorted(v) for k, v in out.items()}


SYNONYMS = _build_synonyms()


def expand_tokens(tokens: list[str]) -> list[str]:
    """Query tokens plus their domain synonyms, de-duplicated."""
    out = list(dict.fromkeys(tokens))
    for t in tokens:
        for s in SYNONYMS.get(t, []):
            if len(s) > 2 and s not in out:
                out.append(s)
    return out


def _query_terms(question: str) -> set[str]:
    return {w.lower() for w in words(question) if len(w) > 2 and w.lower() not in STOP}


def query_tokens(question: str) -> list[str]:
    """Stemmed, de-duplicated query tokens in order of first appearance."""
    seen: set[str] = set()
    out: list[str] = []
    for w in words(question):
        low = w.lower()
        if len(low) <= 2 or low in STOP:
            continue
        s = stem(low)
        if len(s) > 2 and s not in seen:
            seen.add(s)
            out.append(s)
    return out


def _token_set(text: str) -> set[str]:
    return {stem(w) for w in words(text.lower()) if len(w) > 2}


def _coverage(text: str, tokens: list[str]) -> float:
    """Coverage counting a synonym match at half credit, so an exact hit wins."""
    if not tokens:
        return 0.0
    have = _token_set(text)
    score = 0.0
    for t in tokens:
        if t in have:
            score += 1.0
        elif any(s in have for s in SYNONYMS.get(t, [])):
            score += 0.5
    return score / len(tokens)


def _gate_coverage(text: str, tokens: list[str]) -> float:
    """Coverage of the query's own tokens, a synonym match counting full credit."""
    if not tokens:
        return 0.0
    have = _token_set(text)
    hit = 0
    for t in tokens:
        if t in have or any(s in have for s in SYNONYMS.get(t, [])):
            hit += 1
    return hit / len(tokens)


def _exact_overlap(text: str, tokens: list[str]) -> float:
    """Share of the passage that is exactly the query's words (the gate)."""
    if not tokens:
        return 0.0
    have = _token_set(text)
    return sum(1 for t in tokens if t in have) / len(tokens)


def _bigrams(question: str) -> list[str]:
    toks = [stem(w) for w in words(question) if len(w) > 2 and w.lower() not in STOP]
    toks = [t for t in toks if len(t) > 2]
    return list(dict.fromkeys(f"{toks[i]} {toks[i + 1]}" for i in range(len(toks) - 1)))


def _proximity(text: str, bigrams: list[str]) -> float:
    """Fraction of the query's token pairs that occur near each other."""
    if not bigrams:
        return 0.0
    toks = [stem(w) for w in words(text.lower())]
    pos: dict[str, list[int]] = {}
    for i, t in enumerate(toks):
        pos.setdefault(t, []).append(i)
    found = 0
    for bg in bigrams:
        a, b = bg.split(" ", 1)
        pa, pb = pos.get(a), pos.get(b)
        if pa and pb and any(abs(i - j) <= 4 for i in pa for j in pb):
            found += 1
    return found / len(bigrams)


def _lexical_overlap(text: str, terms: set[str]) -> float:
    if not terms:
        return 0.0
    low = text.lower()
    hits = sum(1 for t in terms if t in low)
    return hits / len(terms)


def _freshness(date_str) -> float:
    """A report's publication recency on 0..1; 0.5 when the date is unknown."""
    if not date_str:
        return 0.5
    try:
        year = int(str(date_str)[:4])
    except (TypeError, ValueError):
        return 0.5
    now = datetime.now(timezone.utc).year
    if year < 1950 or year > now + 1:
        return 0.5
    return max(0.0, min(1.0, 1 - (now - year) / 40))


def _provenance(quality: float, date_str) -> float:
    return 0.65 * (quality or 0.0) + 0.35 * _freshness(date_str)


_PHRASE = re.compile(r'"([^"]{4,})"')


def rerank(question: str, hits: list[Hit]) -> list[Hit]:
    """Cheap cross-encoder substitute: coverage + proximity + position."""
    tokens = expand_tokens(query_tokens(question))
    bigrams = _bigrams(question)
    phrases = [p.lower() for p in _PHRASE.findall(question)]
    for h in hits:
        coverage = _coverage(h.content, tokens)
        proximity = _proximity(h.content, bigrams)
        quoted = (sum(1 for p in phrases if p in h.content.lower()) / len(phrases)) if phrases else 0.0
        head = _token_set(h.content[:600])
        head_cov = (sum(1 for t in tokens if t in head) / len(tokens)) if tokens else 0.0
        section = 0.1 if h.kind in ("abstract", "results", "conclusion") else 0.0
        h.rerank_score = round(
            min(1.0, 0.5 * coverage + 0.25 * proximity + 0.1 * head_cov + 0.1 * quoted + section), 4
        )
    return hits


def normalize_fusion(fused: float) -> float:
    """Scale an RRF sum into 0..1 (see retrieval.ts for the ceiling rationale)."""
    return max(0.0, min(1.0, fused / 0.032))


def smart_rank(hits: list[Hit], question: str, *, w_fusion: float = 0.36,
               w_coverage: float = 0.26, w_phrase: float = 0.14,
               w_provenance: float = 0.12, w_domain: float = 0.12) -> list[Hit]:
    """Combine fusion, coverage, proximity, provenance and domain into one score."""
    if not hits:
        return hits
    exact_tokens = query_tokens(question)
    tokens = expand_tokens(exact_tokens)
    bigrams = _bigrams(question)
    for h in hits:
        fusion = normalize_fusion(h.fused_score)
        coverage = _coverage(h.content, tokens)
        phrase = _proximity(h.content, bigrams)
        provenance = _provenance(h.quality_score, h.published_date)
        domain = domain_density(h.content)
        h.final_score = round(
            w_fusion * fusion + w_coverage * coverage + w_phrase * phrase
            + w_provenance * provenance + w_domain * domain,
            6,
        )
        exact = _exact_overlap(h.content, exact_tokens)
        h.meta["factors"] = {
            "fusion": round(w_fusion * fusion, 6), "coverage": round(w_coverage * coverage, 6),
            "phrase": round(w_phrase * phrase, 6), "provenance": round(w_provenance * provenance, 6),
            "domain": round(w_domain * domain, 6), "exact_overlap": round(exact, 4),
            "coverage_raw": round(coverage, 6),
            "gate_coverage": round(_gate_coverage(h.content, exact_tokens), 6),
        }
        h.meta["why"] = _explain(h, exact_tokens)
    hits.sort(key=lambda x: x.final_score, reverse=True)
    return hits


def _explain(h: Hit, tokens: list[str]) -> str:
    """One line a researcher can read: why this passage sits where it does."""
    have = _token_set(h.content)
    matched = [t for t in tokens if t in have]
    f = h.meta.get("factors", {})
    parts: list[str] = []
    if matched:
        parts.append("matches " + ", ".join(matched[:5]))
    if f.get("phrase", 0) >= 0.07:
        parts.append("terms appear together")
    if f.get("fusion", 0) >= 0.18:
        parts.append("strong keyword and vector match")
    if f.get("domain", 0) >= 0.06:
        parts.append("dense combustion vocabulary")
    if not parts:
        parts.append("weak match on the query terms")
    return "; ".join(parts[:2])


RELEVANCE_FLOOR = 0.2


def relevance_gate(hits: list[Hit], question: str) -> list[Hit]:
    """Drop passages that share too little of the query to be evidence.

    Coverage counts a domain synonym at half credit, so a passage that answers
    with "quenching" where the researcher wrote "extinction" still counts. The
    floor is raised for one- and two-word questions.
    """
    tokens = query_tokens(question)
    if not tokens:
        return hits
    floor = 1.0 if len(tokens) <= 2 else RELEVANCE_FLOOR
    def cov(h: Hit) -> float:
        factors = h.meta.get("factors")
        if factors and "gate_coverage" in factors:
            return factors["gate_coverage"]
        return _gate_coverage(h.content, tokens)
    return [h for h in hits if cov(h) >= floor]


def mmr_diversify(hits: list[Hit], k: int, lambda_: float = 0.72) -> list[Hit]:
    """Maximal Marginal Relevance over bag-of-words similarity.

    Prevents the evidence pack from being filled with near-identical chunks
    from one document.
    """
    if len(hits) <= k:
        return hits
    token_sets = [_token_set(h.content) for h in hits]
    selected: list[int] = []
    remaining = list(range(len(hits)))

    def jaccard(a: set[str], b: set[str]) -> float:
        if not a or not b:
            return 0.0
        return len(a & b) / len(a | b)

    while remaining and len(selected) < k:
        best, best_score = None, -math.inf
        for i in remaining:
            sim = max((jaccard(token_sets[i], token_sets[j]) for j in selected), default=0.0)
            score = lambda_ * hits[i].final_score - (1 - lambda_) * sim
            if score > best_score:
                best, best_score = i, score
        selected.append(best)          # type: ignore[arg-type]
        remaining.remove(best)         # type: ignore[arg-type]
    return [hits[i] for i in selected]


def retrieve(question: str, *, k: int = 8, pool: int = 80, diversify: bool = True) -> list[Hit]:
    """Full retrieval path used by both the API and the agent."""
    question = retrieval_query(question)
    hits = hybrid_search(question, k=max(k * 3, 24), pool=pool)
    hits = rerank(question, hits)
    hits = smart_rank(hits, question)
    hits = relevance_gate(hits, question)
    if diversify:
        hits = mmr_diversify(hits, k)
    return hits[:k]


def grade_hits(question: str, hits: list[Hit], llm=None) -> list[Hit]:
    """Assign relevance labels; uses the LLM when available, else heuristics."""
    terms = _query_terms(question)
    for h in hits:
        if llm is not None and getattr(llm, "available", False):
            continue  # LLM grading is done batched in agent.py
        score = 0.6 * h.rerank_score + 0.4 * _lexical_overlap(h.content, terms)
        h.relevance = "relevant" if score >= 0.45 else ("partial" if score >= 0.22 else "irrelevant")
    return hits


# Cross-lingual query handling (parity with the Worker's llm.ts). The corpus and
# its index are English, so an Arabic question is mapped through this pinned
# lexicon before it is searched.
AR_SCIENCE_LEXICON = [
    ("الجاذبية الصغرى", "microgravity"), ("انعدام الجاذبية", "microgravity"),
    ("سرعة انتشار اللهب", "flame spread rate"), ("معدل انتشار اللهب", "flame spread rate"),
    ("انتشار اللهب", "flame spread"), ("قابلية الاشتعال", "flammability"),
    ("معدل الاحتراق", "burning rate"), ("سرعة الاحتراق", "burning rate"),
    ("درجة حرارة الاشتعال", "ignition temperature"),
    ("زمن تأخر الإشعال", "ignition delay time"), ("تأخر الإشعال", "ignition delay"),
    ("الاشتعال التلقائي", "autoignition"), ("حد الأكسجين", "limiting oxygen"),
    ("تركيز الأكسجين", "oxygen concentration"), ("نسبة الأكسجين", "oxygen concentration"),
    ("الأكسجين", "oxygen"), ("الهيبتان", "heptane"), ("الهكسان", "hexane"),
    ("الميثانول", "methanol"), ("الإيثانول", "ethanol"), ("الديكان", "decane"),
    ("الإيثيلين", "ethylene"), ("الميثان", "methane"), ("البروبان", "propane"),
    ("القطرات", "droplets"), ("قطرة", "droplet"), ("السناج", "soot"), ("الهباب", "soot"),
    ("الدخان", "smoke"), ("الألسنة اللهبية", "flames"), ("اللهب", "flame"),
    ("الاحتراق", "combustion"), ("الاشتعال", "ignition"), ("الانطفاء", "extinction"),
    ("الإطفاء", "suppression"), ("الإخماد", "suppression"), ("الانتشار", "spread"),
    ("الطفو", "buoyancy"), ("الحمل الحراري", "convection"), ("الإشعاع", "radiation"),
    ("الانحلال الحراري", "pyrolysis"), ("الحرارة", "temperature"), ("الضغط", "pressure"),
    ("السرعة", "velocity"), ("الوقود", "fuel"), ("الجسيمات", "particles"),
    ("الرذاذ", "aerosol"), ("سلامة الحرائق", "fire safety"),
    ("حرائق المركبات الفضائية", "spacecraft fire"), ("محطة الفضاء الدولية", "ISS"),
    ("المركبة الفضائية", "spacecraft"), ("الجاذبية", "gravity"),
    ("التجربة", "experiment"), ("تجربة", "experiment"), ("البيانات", "data"),
    ("القياسات", "measurements"), ("قياس", "measurement"), ("النتائج", "results"),
    ("دراسة", "study"), ("بحث", "research"),
]

_ARABIC_RE = re.compile(r"[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]")


def is_arabic(text: str) -> bool:
    return bool(_ARABIC_RE.search(text))


def arabic_science_terms(text: str) -> str:
    """Replace known Arabic science terms with their English equivalents."""
    out = text
    for ar, en in AR_SCIENCE_LEXICON:
        out = out.replace(ar, f" {en} ")
    return re.sub(r"\s+", " ", out).strip()


def retrieval_query(question: str) -> str:
    """An English query for the corpus when the question is not in Latin script."""
    return arabic_science_terms(question) if is_arabic(question) else question
