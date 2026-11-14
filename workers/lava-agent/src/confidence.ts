/**
 * Extraction confidence, derived from a finding's own evidence.
 *
 * The pipeline used to write the same `confidence` (0.62) onto every finding it
 * extracted, so every metric's "mean confidence" was identical and carried no
 * signal. This recomputes it from what can actually be checked: whether the
 * quote contains the recorded number, whether it names the unit, whether the
 * quote is long enough to be a sentence, and whether the value was a range. The
 * pipeline writes the same formula going forward, so stored and derived values
 * agree; deriving here also upgrades rows already in the database.
 *
 * The expression is SQL because the mean is aggregated over every row
 * server-side, past the row cap a page requests.
 */
export function confSql(valueCol = "raw_value", unitCol = "raw_unit"): string {
  return `least(0.95, greatest(0.2,
  0.4
  + case when ${valueCol} is not null
          and position(regexp_replace(${valueCol}::text, '(\\.\\d*?)0+$', '\\1')
                in lower(coalesce(evidence_quote, ''))) > 0
         then 0.3 else 0 end
  + case when length(btrim(coalesce(${unitCol}, ''))) > 0
          and position(lower(split_part(btrim(coalesce(${unitCol})), ' ', 1))
                in lower(coalesce(evidence_quote, ''))) > 0
         then 0.1 else 0 end
  + case when length(coalesce(evidence_quote, '')) >= 40 then 0.1 else 0 end
  + case when value_max is not null then 0.05 else 0 end
))`;
}

/** The recorded value and unit as the `dataset_row` view names them. */
export const CONF_SQL = confSql("raw_value", "raw_unit");

/** The same, over `ignis.finding` itself, which names them `value` and `unit`. */
export const CONF_SQL_FINDING = confSql("value", "unit");

/**
 * The dataset index with `mean_confidence` recomputed from the derived values,
 * since `ignis.dataset` (0011) selects the stored constant.
 */
export const DERIVED_DATASET_SQL = `SELECT d.key, d.name, d.canonical_unit, d.value_count,
       d.outcome_count, d.condition_count, d.derived_count, d.document_count,
       d.recorded_unit_count, d.recorded_units, d.value_min, d.value_max,
       d.ranged_value_count, d.extraction_methods,
       coalesce(round(c.mean_conf::numeric, 3), d.mean_confidence) AS mean_confidence
  FROM ignis.dataset d
  LEFT JOIN (
    SELECT dataset_key, avg(${CONF_SQL}) AS mean_conf
      FROM ignis.dataset_row GROUP BY dataset_key
  ) c ON c.dataset_key = d.key`;
