-- ============================================================================
-- LAVA - SI insight provenance
-- Migration 0013
--   Marks insight rows the SI analysis core writes, and lets the agent Worker
--   write them. The refresh replaces the deterministic rows it supersedes, so
--   the dashboard always shows one insight per topic.
-- ============================================================================

SET search_path TO ignis, public;

-- The column already exists (0001) with a template default; the SI refresh
-- stamps 'lava-si' explicitly. Only the write grant is new: the dashboard's
-- reads stay on the public SELECT the Worker already has.
GRANT SELECT, INSERT, UPDATE, DELETE ON ignis.insight TO PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ignis TO PUBLIC;

-- The refresh reads insights by provenance and orders by severity.
CREATE INDEX IF NOT EXISTS insight_generated_by_idx ON ignis.insight (generated_by);
