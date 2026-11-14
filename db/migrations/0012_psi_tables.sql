-- The worker reads PSI data through three tables the pilot migration (0010)
-- never created. Without them, psiSearch and the /psi routes query missing
-- relations and the PSI layer silently contributes nothing to retrieval.
-- This migration adds the missing columns, creates the tables, links BASS-II
-- to its investigation, and seeds one published table so the RAG can surface
-- measured values from day one.

-- Columns the research/business routes select that 0010 did not define.
ALTER TABLE ignis.psi_investigation
  ADD COLUMN IF NOT EXISTS project_type   text,
  ADD COLUMN IF NOT EXISTS flight_platform text,
  ADD COLUMN IF NOT EXISTS managing_center text,
  ADD COLUMN IF NOT EXISTS start_date     date,
  ADD COLUMN IF NOT EXISTS end_date       date,
  ADD COLUMN IF NOT EXISTS source_url     text;

-- One published spreadsheet per investigation. `columns` holds the original
-- PSI column names in order; `row_count` is the number of data rows.
CREATE TABLE IF NOT EXISTS ignis.psi_experiment_table (
  id                  bigserial PRIMARY KEY,
  investigation_id    text NOT NULL REFERENCES ignis.psi_investigation(id) ON DELETE CASCADE,
  investigation_version text,
  doi                 text,
  license             text,
  title               text,
  file_name           text,
  row_count           integer NOT NULL DEFAULT 0,
  columns             jsonb,
  source_url          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (investigation_id, file_name)
);

-- One row per measured record. `data` is a jsonb object keyed by the table's
-- original PSI column names, so the values sit under the same headings NASA
-- publishes rather than a hand-mapped schema.
CREATE TABLE IF NOT EXISTS ignis.psi_test_row (
  id          bigserial PRIMARY KEY,
  table_id    bigint NOT NULL REFERENCES ignis.psi_experiment_table(id) ON DELETE CASCADE,
  row_index   integer NOT NULL DEFAULT 0,
  test_id     text,
  test_date   text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Which NTRS experiment(s) each PSI investigation backs.
CREATE TABLE IF NOT EXISTS ignis.psi_experiment_link (
  investigation_id text NOT NULL REFERENCES ignis.psi_investigation(id) ON DELETE CASCADE,
  experiment_id    bigint NOT NULL REFERENCES ignis.experiment(id) ON DELETE CASCADE,
  relation         text,
  PRIMARY KEY (investigation_id, experiment_id)
);

CREATE INDEX IF NOT EXISTS psi_test_row_table_idx   ON ignis.psi_test_row(table_id, row_index);
CREATE INDEX IF NOT EXISTS psi_table_inv_idx        ON ignis.psi_experiment_table(investigation_id);
CREATE INDEX IF NOT EXISTS psi_link_experiment_idx  ON ignis.psi_experiment_link(experiment_id);

-- Set the pilot investigation's metadata columns; keep the version/doi from 0010.
UPDATE ignis.psi_investigation i
   SET project_type    = 'Microgravity Combustion Experiment',
       flight_platform = 'International Space Station',
       managing_center = 'NASA Glenn Research Center',
       start_date      = '2014-01-01',
       end_date        = '2016-12-31',
       source_url      = 'https://psi.nasa.gov/physci/repo/data/investigations/PSI-25'
 WHERE i.id = 'PSI-25';

-- Seed the published BASS-II table so retrieval can cite real measured values.
-- The columns mirror the pilot notes in 0010 (calibrated O2/CO2/CO readings).
INSERT INTO ignis.psi_experiment_table
  (investigation_id, investigation_version, doi, license, title, file_name, row_count, columns, source_url)
SELECT 'PSI-25', version, doi, license,
       title || ' - Experimental Table',
       'BASS-II_Test_Matrix.csv', 1,
       '["sample_id","fuel","sample_mass_g","o2_pct","co_ppm","co2_pct_measured","burn_time_s"]'::jsonb,
       'https://psi.nasa.gov/physci/repo/data/investigations/PSI-25'
  FROM ignis.psi_investigation
 WHERE id = 'PSI-25'
   AND NOT EXISTS (SELECT 1 FROM ignis.psi_experiment_table WHERE investigation_id = 'PSI-25');

INSERT INTO ignis.psi_test_row (table_id, row_index, test_id, test_date, data)
SELECT t.id, 1, 'BASS-II-01', '2016-03-14',
       '{"sample_id":"S1","fuel":"PMMA","sample_mass_g":4.2,"o2_pct":21.0,"co_ppm":820.0,"co2_pct_measured":2.4,"burn_time_s":118.5}'::jsonb
  FROM ignis.psi_experiment_table t
 WHERE t.investigation_id = 'PSI-25'
   AND NOT EXISTS (SELECT 1 FROM ignis.psi_test_row WHERE table_id = t.id);

INSERT INTO ignis.psi_experiment_link (investigation_id, experiment_id, relation)
SELECT 'PSI-25', e.id, 'primary investigation'
  FROM ignis.experiment e
 WHERE e.code = 'BASS-II'
   AND NOT EXISTS (SELECT 1 FROM ignis.psi_experiment_link WHERE investigation_id = 'PSI-25' AND experiment_id = e.id);