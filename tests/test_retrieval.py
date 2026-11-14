"""Retrieval quality: hybrid search, smart ranking, MMR, claim verification."""
from __future__ import annotations

import pytest

from conftest import needs_db
from lib.retrieve import (Hit, _query_terms, arabic_science_terms, expand_tokens,
                          grade_hits, hybrid_search, is_arabic, mmr_diversify,
                          normalize_fusion, query_tokens, relevance_gate, retrieve,
                          retrieval_query, rerank, smart_rank, stem)


# unit
def _hit(chunk_id: int, content: str, fused: float = 1.0, quality: float = 0.5) -> Hit:
    h = Hit(chunk_id=chunk_id, document_id=chunk_id, title=f"Doc {chunk_id}",
            source_id=str(chunk_id), ordinal=0, kind="body", section_path="Body",
            content=content, fused_score=fused, quality_score=quality)
    return h


def test_query_terms_drops_stopwords():
    terms = _query_terms("How does the flame spread in microgravity?")
    assert "flame" in terms and "microgravity" in terms and "spread" in terms
    assert "how" not in terms and "the" not in terms and "does" not in terms


def test_stemmer_reduces_inflected_forms_to_one_key():
    for forms in (("flame", "flames"), ("burn", "burns", "burning", "burned"),
                  ("spread", "spreads", "spreading"), ("body", "bodies")):
        assert len({stem(f) for f in forms}) == 1


def test_query_tokens_deduplicates_stems():
    assert query_tokens("flames flame burning") == [stem("flame"), stem("burn")]


def test_normalize_fusion_maps_rrf_sum_into_unit_range():
    assert normalize_fusion(0.032) == 1.0
    assert abs(normalize_fusion(0.016) - 0.5) < 1e-9
    assert normalize_fusion(5.0) == 1.0


def test_rerank_prefers_term_coverage():
    q = "flame spread rate microgravity"
    on_topic = _hit(1, "The flame spread rate in microgravity was measured carefully.")
    off_topic = _hit(2, "A budget report about quarterly expenses and staffing levels.")
    rerank(q, [on_topic, off_topic])
    assert on_topic.rerank_score > off_topic.rerank_score


def test_rerank_rewards_quoted_phrases():
    q = 'evidence for "limiting oxygen concentration" limits'
    hit = _hit(1, "The limiting oxygen concentration limits were measured in the chamber.")
    other = _hit(2, "The oxygen was limited by the chamber design and the flow controller.")
    rerank(q, [hit, other])
    assert hit.rerank_score > other.rerank_score


def test_smart_rank_combines_signals_and_sorts():
    q = "flame spread microgravity"
    a = _hit(1, "flame spread microgravity flame spread microgravity", fused=0.9, quality=0.9)
    b = _hit(2, "flame spread microgravity", fused=0.9, quality=0.9)
    c = _hit(3, "unrelated text about accounting", fused=0.1, quality=0.1)
    ranked = smart_rank(rerank(q, [a, b, c]), q)
    assert ranked[0].chunk_id in (1, 2)
    assert ranked[-1].chunk_id == 3
    assert all(0.0 <= h.final_score <= 1.0 for h in ranked)
    assert ranked == sorted(ranked, key=lambda h: h.final_score, reverse=True)


def test_mmr_prefers_diverse_hit_when_equally_relevant():
    q = "flame spread"
    dupes = [_hit(i, "flame spread in microgravity over solid fuel", fused=1.0 - i * 0.01)
             for i in range(1, 6)]
    # Equally relevant to the query, but about a different subtopic.
    distinct = _hit(99, "flame spread and the soot aerosol particle size distribution", fused=0.98)
    out = mmr_diversify(smart_rank(rerank(q, dupes + [distinct]), q), k=3)
    assert len(out) == 3
    assert 99 in [h.chunk_id for h in out], "diverse hit should be selected"


def test_mmr_keeps_relevant_hit_over_irrelevant_diverse_one():
    q = "flame spread"
    strong = _hit(1, "flame spread in microgravity over solid fuel", fused=1.0)
    weak_but_different = _hit(2, "soot aerosol particle size distribution", fused=0.05)
    out = mmr_diversify(smart_rank(rerank(q, [strong, weak_but_different]), q), k=1)
    assert [h.chunk_id for h in out] == [1], "relevance must still dominate diversity"


def test_mmr_returns_all_when_under_budget():
    hits = [_hit(i, f"content {i}") for i in range(3)]
    assert len(mmr_diversify(hits, k=10)) == 3


def test_grade_hits_labels_heuristic_relevance():
    q = "flame spread microgravity"
    good = _hit(1, "flame spread microgravity was studied extensively in this experiment")
    bad = _hit(2, "the committee approved the annual budget for facilities")
    rerank(q, [good, bad])
    graded = grade_hits(q, [good, bad])
    labels = {h.chunk_id: h.relevance for h in graded}
    assert labels[1] == "relevant"
    assert labels[2] == "irrelevant"


# db
@needs_db
def test_hybrid_search_returns_relevant_hits():
    hits = hybrid_search("flame spread in microgravity", k=10)
    assert hits, "corpus should return hits"
    assert all(h.content.strip() for h in hits)
    assert all(h.document_id > 0 and h.chunk_id > 0 for h in hits)
    # Fusion is a rank-based score, so it must be positive and descending.
    fused = [h.fused_score for h in hits]
    assert all(f > 0 for f in fused)
    assert fused == sorted(fused, reverse=True)


@needs_db
def test_retrieve_enriches_document_metadata():
    hits = retrieve("limiting oxygen concentration spacecraft", k=5)
    assert hits
    assert all(h.title for h in hits)
    assert all(h.landing_url.startswith("https://ntrs.nasa.gov") for h in hits)
    assert all(h.quality_score >= 0 for h in hits)


@needs_db
def test_retrieve_scores_are_normalized():
    hits = retrieve("soot and smoke particle formation", k=6)
    assert hits
    assert all(0.0 <= h.final_score <= 1.0 for h in hits)
    # retrieve() applies MMR after ranking, so the returned order is
    # deliberately not score-sorted; ranking itself must still be.
    ranked = smart_rank(rerank("soot and smoke particle formation", hits),
                        "soot and smoke particle formation")
    assert [h.final_score for h in ranked] == sorted(
        (h.final_score for h in ranked), reverse=True)


@needs_db
def test_retrieve_diversifies_documents():
    hits = retrieve("fire safety in spacecraft", k=8)
    # MMR should not hand back eight chunks from a single document.
    assert len({h.document_id for h in hits}) >= 2


@needs_db
def test_retrieve_is_question_sensitive():
    spread = retrieve("flame spread rate over solid fuel", k=5)
    smoke = retrieve("smoke detector particle size spacecraft", k=5)
    assert {h.chunk_id for h in spread} != {h.chunk_id for h in smoke}


@needs_db
def test_hybrid_search_handles_no_match():
    hits = hybrid_search("zzzzqqq nonexistent gibberish token xyzzy", k=5)
    # Keyword side returns nothing; vector side may return weak neighbours.
    assert isinstance(hits, list)


# cross-lingual + relevance gate (parity with the Worker)

def test_arabic_terms_map_to_english():
    out = arabic_science_terms("السناج و الهيبتان و تركيز الأكسجين")
    assert "soot" in out and "heptane" in out and "oxygen concentration" in out


def test_arabic_phrase_maps_before_single_word():
    out = arabic_science_terms("انتشار اللهب في الجاذبية الصغرى")
    assert "flame spread" in out and "microgravity" in out


def test_retrieval_query_leaves_latin_untouched():
    assert retrieval_query("flame spread rate") == "flame spread rate"
    assert "microgravity" in retrieval_query("الجاذبية الصغرى")
    assert is_arabic("تجربة SAFFIRE") is True


def test_synonym_expansion_bridges_domain_terms():
    expanded = expand_tokens(query_tokens("smolder extinction"))
    assert stem("smoulder") in expanded
    assert stem("quench") in expanded


def test_relevance_gate_drops_off_topic_passage():
    q = "soot volume fraction"
    on_topic = _hit(1, "The soot volume fraction was measured.")
    off_topic = _hit(2, "A study of medieval poetry and its meter.")
    kept = relevance_gate([on_topic, off_topic], q)
    assert [h.chunk_id for h in kept] == [1]


def test_smart_rank_exposes_factors_and_reason():
    h = _hit(1, "the soot volume fraction grew with pressure")
    smart_rank([h], "soot volume fraction")
    assert "factors" in h.meta and "exact_overlap" in h.meta["factors"]
    assert "soot" in h.meta["why"]
