// Pure view models for a stored what-if comparison and a worker job. Formatting only: every figure comes from the stored result. Throws on a malformed shape.
import { BASELINE, BUDDY, BETTER_WHEN, FALLBACK_CAVEAT, JOB_STATUS, TODAY, measureLabel, measureKind, carTimeKind, formatMeasure, formatDemoTime, oldPolicyText,
  plainText, experimentLabel, experimentVerdict, experimentDifferenceText, formatExperimentValue, jobProgressText } from './comparison-copy.js';
import { parameterLabel } from './experiment-copy.js';
import { toComparisonView, readStats, scaleFor, statValues, toAssumption, object, text, finite, fail } from './comparison-view.js';

const DEFINITION = 'comparison.experiments.v1';
const ROUTES = [['buddy', BUDDY], ['current', BASELINE]];
const pick = ({ mean, min, max }) => ({ mean, min, max });

function boundsFor(result) {
  const row = result.assumptions.find((a) => a?.key === DEFINITION);
  const own = row?.value?.experiments?.[result.experimentId];
  if (!object(own)) return null;
  const num = (v) => (finite(v) ? v : null);
  return { minimum: num(own.minimum), maximum: num(own.maximum), maximumValues: num(own.maximumValues), unit: text(own.unit) ? own.unit : null };
}

function readChange(result) {
  const change = result.manifest.change;
  const id = result.experimentId;
  if (!object(change) || !text(change.key) || !('baselineValue' in change)) fail('change');
  const raw = Array.isArray(change.values) ? change.values : 'value' in change ? [change.value] : null;
  if (!raw?.length) fail('tried values');
  return { key: change.key, label: parameterLabel(change.key), unit: change.unit ?? '', status: change.status ?? 'what-if', basis: plainText(change.basis) ?? '',
    baseline: { value: change.baselineValue, text: formatExperimentValue(id, change.baselineValue), basis: plainText(change.baselineBasis) ?? '', status: change.baselineStatus ?? '' },
    values: raw, texts: raw.map((v) => formatExperimentValue(id, v)) };
}

function routeView(result, arms, [routeKey, routeLabel], change) {
  const first = arms[0].routes?.[routeKey];
  if (!Array.isArray(first) || !first.length) fail(`${routeKey} route`);
  const measures = first.map((head, i) => {
    if (!object(head) || !text(head.measure) || !BETTER_WHEN[head.betterWhen]) fail('effect entry');
    const entries = arms.map((arm, k) => {
      const entry = arm.routes?.[routeKey]?.[i];
      if (!object(entry) || entry.measure !== head.measure || entry.betterWhen !== head.betterWhen) fail('effect entry');
      const label = change.texts[k];
      const verdictText = experimentVerdict(entry.verdict, label);
      if (verdictText === null) fail('verdict');
      return { entry, label, verdictText };
    });
    const baseline = readStats(head.baseline, 'baseline');
    const stats = [baseline, ...entries.flatMap(({ entry }) => [readStats(entry.variant, 'variant'), readStats(entry.difference, 'difference')])];
    const kind = carTimeKind(measureKind(head.measure), stats.flatMap(statValues));
    const rows = [{ label: `${change.baseline.text} (${TODAY})`, ...pick(baseline) },
      ...entries.map(({ entry, label }) => ({ label, ...pick(readStats(entry.variant, 'variant')) }))];
    return { key: head.measure, label: measureLabel(head.measure), kind, betterWhen: head.betterWhen, hint: BETTER_WHEN[head.betterWhen], rows, scale: scaleFor(kind, rows),
      format: (v) => formatMeasure(kind, v),
      arms: entries.map(({ entry, label, verdictText }, k) => ({ armId: arms[k].armId, label, value: arms[k].value, verdict: entry.verdict, verdictText,
        differenceText: experimentDifferenceText(kind, readStats(entry.difference, 'difference'), label) })) };
  });
  return { key: routeKey, label: routeLabel, measures };
}

/** stored = a read object whose result.kind is 'experiment-comparison' -> { id, label, change, routes, meta, oldPolicy, caveat, limitations, assumptions, bounds, provenance }. */
export function toExperimentView(stored) {
  if (!object(stored) || !object(stored.result) || stored.result.kind !== 'experiment-comparison') fail('result');
  const { result } = stored; const { manifest } = result;
  if (!text(result.experimentId) || !Array.isArray(result.effects) || !result.effects.length || !Array.isArray(result.assumptions) || !object(manifest) || !Array.isArray(manifest.seeds)) fail('sections');
  if (!text(stored.policyVersion)) fail('policy version');
  const change = readChange(result);
  if (result.effects.length !== change.values.length || !result.effects.every((a) => object(a) && text(a.armId))) fail('arms');
  const routes = ROUTES.map((route) => routeView(result, result.effects, route, change));
  const assumptions = result.assumptions.map(toAssumption);
  const caveat = text(result.caveat) ? result.caveat : FALLBACK_CAVEAT;
  const limitations = (Array.isArray(result.limitations) ? result.limitations : []).filter((l) => text(l) && l !== caveat).map(plainText);
  const size = manifest.overlays?.['comparison.cohortSize'] ?? result.assumptions.find((a) => a.key === 'comparison.cohortSize')?.value;
  const made = formatDemoTime(result.completedAt); const stamped = formatDemoTime(stored.storedAt);
  const codeRevision = text(manifest.codeRevision) ? manifest.codeRevision : null;
  return {
    id: result.experimentId, label: experimentLabel(result.experimentId), change, routes, caveat, limitations, assumptions, bounds: boundsFor(result),
    meta: { seeds: manifest.seeds.length, seedList: [...manifest.seeds], policyVersion: stored.policyVersion, made, employees: finite(size) ? size : null, codeRevision },
    oldPolicy: stored.policyCurrent !== false ? null : oldPolicyText(stored.policyVersion, text(stored.activePolicyVersion) ? stored.activePolicyVersion : 'unknown'),
    provenance: { seeds: manifest.seeds.join(', '), policyVersion: stored.policyVersion, policyHash: text(manifest.policyHash) ? manifest.policyHash.slice(0, 12) : null,
      generatorVersion: manifest.generatorVersion ?? null, codeRevision, resultId: stored.resultId ?? null, made, stored: stamped },
  };
}

/** Any stored read object -> { kind: 'process', view } or { kind: 'experiment', view }. Throws on any other kind. */
export function toStoredView(stored) {
  const kind = stored?.result?.kind;
  if (kind === 'process-comparison') return { kind: 'process', view: toComparisonView(stored) };
  if (kind === 'experiment-comparison') return { kind: 'experiment', view: toExperimentView(stored) };
  return fail('result');
}

const count = (v) => Number.isInteger(v) && v >= 0;
/** job = the job view the worker routes send -> { jobId, experimentId, status, statusLabel, active, progress, progressText, reason, requested, startedAt, finishedAt, resultId }. */
export function toJobView(job) {
  if (!object(job) || !text(job.jobId) || !text(job.experimentId) || !JOB_STATUS[job.status]) fail('job');
  const p = job.progress;
  if (!object(p) || !['seedsDone', 'seedsTotal', 'stepsDone', 'stepsTotal'].every((k) => count(p[k]))) fail('job progress');
  const change = job.request?.change;
  let requested = null;
  if (object(change)) {
    const raw = Array.isArray(change.values) ? change.values : 'value' in change ? [change.value] : [];
    const texts = raw.map((v) => formatExperimentValue(job.experimentId, v));
    requested = { values: raw, texts, text: texts.join(', '), basis: text(change.basis) ? change.basis : '' };
  }
  const failed = job.status === 'failed' || job.status === 'interrupted';
  return { jobId: job.jobId, experimentId: job.experimentId, label: experimentLabel(job.experimentId), status: job.status, statusLabel: JOB_STATUS[job.status],
    active: job.status === 'starting' || job.status === 'running', progress: { ...p }, progressText: jobProgressText(p),
    reason: failed && text(job.reason) ? job.reason : null, requested, startedAt: formatDemoTime(job.startedAt), finishedAt: formatDemoTime(job.finishedAt),
    resultId: text(job.resultId) ? job.resultId : null };
}
