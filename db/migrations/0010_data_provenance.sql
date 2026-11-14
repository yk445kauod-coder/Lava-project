-- ============================================================================
-- LAVA - data provenance, role classification, and the PSI pilot link
-- Migration 0010
--
-- The data audit (LAVA_Data_Audit) found that every value in the product was a
-- report-mined candidate with no source-layer, role, or review metadata, that a
-- flammability limit was counted as an ambient oxygen measurement, that the
-- experiment catalogue used a non-authoritative acronym, and that no record was
-- linked to NASA PSI. This migration adds the metadata the audit asked for and
-- seeds the first PSI link (BASS-II -> PSI-25).
--
-- Nothing here invents a measurement: it classifies and annotates the values
-- the extractor already produced, and records one authoritative PSI reference.
-- ============================================================================

-- 1. Findings: where a value came from, what role it plays, and its review state.
ALTER TABLE ignis.finding
  ADD COLUMN IF NOT EXISTS source_layer  text NOT NULL DEFAULT 'ntrs',
  ADD COLUMN IF NOT EXISTS role          text,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'unreviewed',
  ADD COLUMN IF NOT EXISTS psi_investigation_id text,
  ADD COLUMN IF NOT EXISTS psi_version   text,
  ADD COLUMN IF NOT EXISTS psi_doi       text,
  ADD COLUMN IF NOT EXISTS psi_url       text;

COMMENT ON COLUMN ignis.finding.source_layer IS
  'Origin of the value: psi (PSI experimental table), ntrs (publication text), or lava (LAVA-derived).';
COMMENT ON COLUMN ignis.finding.role IS
  'condition | outcome | derived | statement. A test condition is not a measured outcome.';
COMMENT ON COLUMN ignis.finding.review_status IS
  'unreviewed | checked (against source text) | verified (against PSI table).';

-- 2. Experiments: PSI linkage and a status that distinguishes "not ingested"
--    from "absent from PSI".
ALTER TABLE ignis.experiment
  ADD COLUMN IF NOT EXISTS psi_investigation_id text,
  ADD COLUMN IF NOT EXISTS psi_version   text,
  ADD COLUMN IF NOT EXISTS psi_doi       text,
  ADD COLUMN IF NOT EXISTS psi_url       text,
  ADD COLUMN IF NOT EXISTS psi_status    text;

-- 3. PSI investigation registry. Small and hand-maintained: one row per
--    authoritative PSI record a LAVA experiment maps to.
CREATE TABLE IF NOT EXISTS ignis.psi_investigation (
  id          text PRIMARY KEY,          -- e.g. PSI-25
  version     text,
  doi         text,
  license     text,
  title       text,
  acronym     text,
  research_area text,
  sub_area    text,
  url         text,
  archive_bytes bigint,
  updated_at  timestamptz,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ignis.psi_investigation
  (id, version, doi, license, title, acronym, research_area, sub_area, url, archive_bytes, updated_at, notes)
VALUES
  ('PSI-25', '4', '10.60555/4qc4-de67', 'CC0-1.0',
   'Burning and Suppression of Solids - II (BASS-II) Investigation',
   'BASS-II', 'Combustion Science', 'Spacecraft Fire Safety',
   'https://psi.nasa.gov/physci/repo/data/investigations/PSI-25',
   255770000000, '2025-11-24',
   'Pilot integration. Experimental table holds test/sample ids, fuel material, dates and calibrated O2/CO2/CO readings (130 rows, v4).')
ON CONFLICT (id) DO UPDATE SET
  version = EXCLUDED.version, doi = EXCLUDED.doi, license = EXCLUDED.license,
  title = EXCLUDED.title, acronym = EXCLUDED.acronym, url = EXCLUDED.url,
  archive_bytes = EXCLUDED.archive_bytes, updated_at = EXCLUDED.updated_at,
  notes = EXCLUDED.notes;

-- Link the BASS-II experiment to its PSI record. PSI carries the test-level
-- experimental table; the NTRS documents stay as supporting context.
UPDATE ignis.experiment
   SET psi_investigation_id = 'PSI-25',
       psi_version = '4',
       psi_doi = '10.60555/4qc4-de67',
       psi_url = 'https://psi.nasa.gov/physci/repo/data/investigations/PSI-25',
       psi_status = 'linked'
 WHERE code = 'BASS-II';

-- Everything else is explicitly "not yet ingested", never "absent from PSI".
UPDATE ignis.experiment
   SET psi_status = 'not_ingested'
 WHERE psi_status IS NULL;

-- 4. Authoritative acronym: the challenge calls the project ACME, not ACE.
UPDATE ignis.experiment
   SET code = 'ACME',
       name = 'Advanced Combustion via Microgravity Experiments (ACME)',
       campaign = 'ACME',
       aliases = (
         SELECT array_agg(DISTINCT a)
           FROM unnest(array_cat(aliases, ARRAY['ACME', 'ACE'])) AS a
       )
 WHERE code = 'ACE';

-- 5. Role classification for existing findings.
--    A quote that does not contain its own number is a mention, not a record.
UPDATE ignis.finding SET role = CASE
  WHEN confidence < 0.5 THEN 'statement'
  WHEN metric IN ('pressure', 'oxygen concentration', 'flow velocity', 'gravity level') THEN 'condition'
  WHEN metric = 'limiting oxygen index' THEN 'derived'
  ELSE 'outcome'
END
WHERE role IS NULL;

-- 6. Separate ambient oxygen concentration from flammability limits.
--    A limiting oxygen index / LOC / LOI / ULOI is a threshold; an ambient
--    "21% O2" reading is a test condition. The extractor conflated the two.
UPDATE ignis.finding
   SET metric = 'oxygen concentration', role = 'condition'
 WHERE metric = 'limiting oxygen index'
   AND evidence_quote !~* '(LOI|LOC|ULOI|limiting oxygen)';

-- 7. Gravity records carry their source meaning, never a claim of partial-gravity
--    coverage (PSI holds no direct partial-gravity combustion data).
COMMENT ON COLUMN ignis.finding.role IS
  'condition | outcome | derived | statement. Gravity rows are platform conditions, not partial-gravity evidence.';
