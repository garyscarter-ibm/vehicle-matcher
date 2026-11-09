import { requireChoice } from './optimizer.js';

const instant = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value));

export function splitChoiceExamples(examples, split) {
  requireChoice(Array.isArray(examples) && examples.length > 0, 'examples');
  requireChoice(Number.isSafeInteger(split?.lastTrainingCycleIndex) && split.lastTrainingCycleIndex >= 0
    && Array.isArray(split.evaluationCycleIndices) && split.evaluationCycleIndices.length > 0
    && split.evaluationCycleIndices.every((v) => Number.isSafeInteger(v) && v > split.lastTrainingCycleIndex)
    && new Set(split.evaluationCycleIndices).size === split.evaluationCycleIndices.length
    && typeof split.cohortField === 'string' && split.cohortField.length > 0
    && Array.isArray(split.heldOutCohorts) && split.heldOutCohorts.length > 0
    && split.heldOutCohorts.every((v) => typeof v === 'string' && v.length > 0)
    && new Set(split.heldOutCohorts).size === split.heldOutCohorts.length, 'split');
  const training = []; const later = []; const unseen = []; const familiar = []; const excluded = [];
  const ids = new Set(); const cycles = new Map(); const indices = new Map();
  for (const example of examples) {
    requireChoice(typeof example.recordId === 'string' && !ids.has(example.recordId), 'recordId', 'leakage');
    ids.add(example.recordId);
    const { cycle } = example;
    requireChoice(typeof cycle?.id === 'string' && Number.isSafeInteger(cycle.index) && cycle.index >= 0
      && instant(cycle.startsAt) && instant(cycle.until) && Date.parse(cycle.startsAt) <= Date.parse(cycle.until), 'cycle');
    requireChoice(!cycles.has(cycle.id) || JSON.stringify(cycles.get(cycle.id)) === JSON.stringify(cycle), 'cycle.identity', 'leakage');
    requireChoice(!indices.has(cycle.index) || indices.get(cycle.index) === cycle.id, 'cycle.index', 'leakage');
    cycles.set(cycle.id, cycle); indices.set(cycle.index, cycle.id);
    requireChoice(instant(example.observedAt) && instant(example.featuresAsOf)
      && Date.parse(example.featuresAsOf) <= Date.parse(example.observedAt)
      && Date.parse(example.observedAt) >= Date.parse(cycle.startsAt)
      && Date.parse(example.observedAt) <= Date.parse(cycle.until), 'featuresAsOf', 'leakage');
    requireChoice(typeof example.cohort === 'string' && example.cohort.length > 0, 'cohort');
    const held = split.heldOutCohorts.includes(example.cohort);
    if (cycle.index <= split.lastTrainingCycleIndex) {
      (held ? excluded : training).push(example);
    } else if (split.evaluationCycleIndices.includes(cycle.index)) {
      later.push(example); (held ? unseen : familiar).push(example);
    } else excluded.push(example);
  }
  const chronology = [...cycles.values()].sort((a, b) => a.index - b.index);
  for (let i = 1; i < chronology.length; i += 1)
    requireChoice(Date.parse(chronology[i - 1].until) < Date.parse(chronology[i].startsAt), 'cycle.order', 'leakage');
  requireChoice(training.length > 0 && later.length > 0 && unseen.length > 0 && familiar.length > 0, 'partition-support');
  requireChoice(split.evaluationCycleIndices.every((i) => later.some((e) => e.cycle.index === i)), 'evaluation-cycle-support');
  requireChoice(!training.some((e) => split.heldOutCohorts.includes(e.cohort)), 'cohort', 'leakage');
  return { training, later, unseen, familiar, excluded, manifest: {
    split: structuredClone(split), counts: { training: training.length, later: later.length, unseen: unseen.length,
      familiar: familiar.length, excluded: excluded.length },
    recordIds: { training: training.map((e) => e.recordId).sort(), later: later.map((e) => e.recordId).sort(),
      unseen: unseen.map((e) => e.recordId).sort(), excluded: excluded.map((e) => e.recordId).sort() },
    cycles: chronology,
  } };
}
