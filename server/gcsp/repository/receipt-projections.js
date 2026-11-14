// FUCQ-419: named receipt read projections. `js` projects a full row; `sql` is the same projection over `data`,
// so PostgreSQL returns only the projected bytes. Both must stay exactly equal (gcsp-postgres-receipt-reads.test.js).
const ALLOCATION_EVALUATION = 'buddy-allocation-evaluation';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const length = (value) => Array.isArray(value) ? value.length : null;
const arrayLength = (path) => `CASE WHEN jsonb_typeof(data #> '${path}') = 'array' THEN jsonb_array_length(data #> '${path}') END`;

export const RECEIPT_PROJECTIONS = Object.freeze({
  // Completed allocation metadata: counts and exclusions in place of assignments, quotes, evaluations and inputs.
  'allocation-summary': Object.freeze({
    js(row) {
      const { inputVersions, outcome, ...rest } = row; const value = outcome?.value;
      return { ...rest, summary: { status: outcome?.status ?? null, runId: value?.runId ?? null, offers: length(value?.assignments) ?? 0,
        evaluated: length(value?.evaluationRefs?.employeeIds) ?? length(value?.evaluations) ?? 0,
        excluded: Array.isArray(value?.excluded) ? value.excluded : null } };
    },
    sql: `(data - 'inputVersions' - 'outcome') || jsonb_build_object('summary', jsonb_build_object(
      'status', data #> '{outcome,status}', 'runId', data #> '{outcome,value,runId}',
      'offers', coalesce(${arrayLength('{outcome,value,assignments}')}, 0),
      'evaluated', coalesce(${arrayLength('{outcome,value,evaluationRefs,employeeIds}')}, ${arrayLength('{outcome,value,evaluations}')}, 0),
      'excluded', CASE WHEN jsonb_typeof(data #> '{outcome,value,excluded}') = 'array' THEN data #> '{outcome,value,excluded}' END))`,
  }),
  // An evaluation slice keeps only what quote reconstruction needs, without the per-car decisions.
  'quote-inputs': Object.freeze({
    js(row) {
      if (row.consumerId !== ALLOCATION_EVALUATION || row.outcome?.status !== 'ok' || !object(row.outcome.value)) return row;
      const { quotes, quoteInputs } = row.outcome.value;
      return { ...row, outcome: { ...row.outcome, value: { ...(quotes !== undefined && { quotes }), ...(quoteInputs !== undefined && { quoteInputs }) } } };
    },
    sql: `CASE WHEN consumer_id = '${ALLOCATION_EVALUATION}' AND data #> '{outcome,status}' = '"ok"' AND jsonb_typeof(data #> '{outcome,value}') = 'object'
      THEN jsonb_set(data, '{outcome,value}', (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        FROM jsonb_each(data #> '{outcome,value}') AS e WHERE e.key IN ('quotes', 'quoteInputs'))) ELSE data END`,
  }),
});

export const projectReceipt = (projection, row) => RECEIPT_PROJECTIONS[projection].js(row);
