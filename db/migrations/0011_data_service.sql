-- ============================================================================
-- LAVA - one normalized data service for every page
-- Migration 0011
--
-- The audit found the same quantity reported with different counts, units and
-- ranges across pages because each page aggregated `finding` differently, and
-- that condition rows were mixed into outcome statistics. These views become
-- the single place counts, units and ranges are derived, so every page agrees.
--
--   dataset_row  one row per candidate value, with its role and provenance
--   dataset      one row per metric, with a role breakdown
--   finding_public  the candidate rows with their source layer for the UI
--
-- Weak rows (a quote that does not carry its own number) are excluded from the
-- normalized service; they stay in `finding` so search still finds them.
-- ============================================================================

DROP VIEW IF EXISTS ignis.dataset_row;
CREATE VIEW ignis.dataset_row AS
  SELECT f.id AS finding_id,
    replace(lower(f.metric), ' '::text, '_'::text) AS dataset_key,
    f.metric,
    f.value AS raw_value,
    f.unit AS raw_unit,
    f.value * ignis.unit_factor(f.metric, f.unit) AS value,
    ignis.unit_canonical(f.metric) AS unit,
    f.value_max * ignis.unit_factor(f.metric, f.unit) AS value_max,
    f.statement,
    f.evidence_quote,
    f.confidence,
    f.extraction_method,
    f.role,
    f.review_status,
    f.source_layer,
    f.psi_investigation_id,
    f.document_id,
    d.source_id AS document_source_id,
    d.title AS document_title,
    d.landing_url,
    e.code AS experiment_code,
    e.name AS experiment_name
   FROM ignis.finding f
     LEFT JOIN ignis.document d ON d.id = f.document_id
     LEFT JOIN LATERAL ( SELECT x.code, x.name
           FROM ignis.experiment_document ed
             JOIN ignis.experiment x ON x.id = ed.experiment_id
          WHERE ed.document_id = f.document_id
          ORDER BY x.code LIMIT 1) e ON true
  WHERE f.metric IS NOT NULL AND f.value IS NOT NULL
    AND f.role IS DISTINCT FROM 'statement'
    AND f.review_status IS DISTINCT FROM 'flagged';

DROP VIEW IF EXISTS ignis.dataset;
CREATE VIEW ignis.dataset AS
  SELECT replace(lower(metric), ' '::text, '_'::text) AS key,
    metric AS name,
    ignis.unit_canonical(metric) AS canonical_unit,
    count(*) AS value_count,
    count(*) FILTER (WHERE role = 'outcome')   AS outcome_count,
    count(*) FILTER (WHERE role = 'condition') AS condition_count,
    count(*) FILTER (WHERE role = 'derived')   AS derived_count,
    count(DISTINCT document_id) AS document_count,
    count(DISTINCT unit) AS recorded_unit_count,
    array_agg(DISTINCT unit ORDER BY unit) AS recorded_units,
    min(value) AS value_min,
    max(value) AS value_max,
    count(*) FILTER (WHERE value_max IS NOT NULL) AS ranged_value_count,
    round(avg(confidence)::numeric, 3) AS mean_confidence,
    array_agg(DISTINCT extraction_method) AS extraction_methods
   FROM ignis.dataset_row
  GROUP BY metric;

-- Candidate rows plus their source layer, so the UI can label provenance
-- without joining. Only outcome/condition/derived rows reach the envelope.
DROP VIEW IF EXISTS ignis.finding_public;
CREATE VIEW ignis.finding_public AS
  SELECT f.id, f.experiment_id, f.document_id, f.metric, f.value, f.value_max,
         f.unit, f.statement, f.confidence, f.extraction_method, f.evidence_quote,
         f.role, f.review_status, f.source_layer, f.psi_investigation_id,
         f.psi_version, f.psi_doi, f.psi_url
    FROM ignis.finding f
   WHERE f.value IS NOT NULL;

-- Counts by role, so a page can state the scope behind each number.
DROP VIEW IF EXISTS ignis.finding_stats;
CREATE VIEW ignis.finding_stats AS
  SELECT count(*) AS findings,
         count(*) FILTER (WHERE role = 'outcome')   AS outcomes,
         count(*) FILTER (WHERE role = 'condition') AS conditions,
         count(*) FILTER (WHERE role = 'derived')   AS derived,
         count(*) FILTER (WHERE role = 'statement' OR review_status = 'flagged') AS statements,
         count(*) FILTER (WHERE review_status = 'verified') AS verified,
         count(*) FILTER (WHERE source_layer = 'psi') AS psi_backed
    FROM ignis.finding;

-- Re-create document_stats with the same keys plus the role counts, so the
-- header can show the corpus size and the candidate/verified split together.
DROP VIEW IF EXISTS ignis.document_stats;
CREATE VIEW ignis.document_stats AS
  SELECT ( SELECT count(*) FROM ignis.document) AS documents,
    ( SELECT count(*) FROM ignis.document WHERE has_fulltext) AS documents_with_fulltext,
    ( SELECT count(*) FROM ignis.chunk) AS chunks,
    ( SELECT count(*) FROM ignis.chunk_embedding) AS embeddings,
    ( SELECT count(*) FROM ignis.experiment) AS experiments,
    ( SELECT count(*) FROM ignis.finding) AS findings,
    ( SELECT outcomes FROM ignis.finding_stats) AS findings_outcomes,
    ( SELECT conditions FROM ignis.finding_stats) AS findings_conditions,
    ( SELECT statements FROM ignis.finding_stats) AS findings_statements,
    ( SELECT verified FROM ignis.finding_stats) AS findings_verified,
    ( SELECT count(*) FROM ignis.insight) AS insights,
    ( SELECT COALESCE(sum(word_count), 0::bigint) FROM ignis.document_text) AS corpus_words,
    ( SELECT COALESCE(sum(char_count), 0::bigint) FROM ignis.document_text) AS corpus_chars,
    ( SELECT COALESCE(sum(bytes), 0::numeric) FROM ignis.artifact) AS artifact_bytes;
