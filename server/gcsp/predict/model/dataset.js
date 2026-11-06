import { requireChoice } from './optimizer.js';
import { buildChoiceFeatures } from './features.js';

const known = (value) => value?.status === 'known';
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

// The actual FUCQ-113 reader is injected to preserve its sole validation authority.
export function projectLearningChoices(input, { readLearningDataset, featureVersion, cohortField }) {
  requireChoice(typeof readLearningDataset === 'function', 'FUCQ-113.reader', 'dataset-unavailable');
  const loaded = readLearningDataset(input);
  requireChoice(loaded?.status === 'ok', 'FUCQ-113.manifest', 'dataset-unavailable');
  const { manifest, records } = loaded.value;
  requireChoice(['gradeId', 'employeeRef'].includes(cohortField), 'cohortField');
  const examples = []; const exclusions = {}; const exclude = (reason) => { exclusions[reason] = (exclusions[reason] ?? 0) + 1; };
  for (const record of records) {
    const waited = record.outcomes.wait.state === 'waited';
    const selected = record.outcomes.selection.state === 'selected' || record.outcomes.acceptance.state === 'accepted';
    if (!waited && !selected) { exclude('censored-outcome'); continue; }
    if (!known(record.choiceSet) || !known(record.renewal.cohort)) { exclude('unknown-choice-set-or-cycle'); continue; }
    const cycle = manifest.cycles.find((c) => c.cycleId === record.renewal.cohort.value);
    if (!cycle) { exclude('unknown-cycle'); continue; }
    const cohort = cohortField === 'gradeId' ? known(record.entitlement.gradeId) && record.entitlement.gradeId.value : record.subject.employeeRef;
    if (!cohort) { exclude('unknown-cohort'); continue; }
    const observedAt = waited ? record.outcomes.wait.at : record.outcomes.offered.at;
    if (!iso(observedAt) || !iso(record.timestamps.projectedAt)
      || Date.parse(record.timestamps.projectedAt) > Date.parse(cycle.until)) { exclude('outcome-outside-cycle'); continue; }
    const alternatives = []; let incomplete = false; let featuresAt = Date.parse(record.brief.confirmedAt);
    for (const entry of record.choiceSet.value) {
      // Unknown exposure/eligibility/terms cannot establish a historical permitted choice.
      if (entry.eligible !== true || entry.available !== true || !known(entry.exposure) || !known(entry.terms)) {
        incomplete = true; break;
      }
      const snapshot = manifest.snapshot.features.find((s) => s.configurationId === entry.configurationId);
      if (!snapshot || !entry.orderRef) { incomplete = true; break; }
      const attributes = {};
      for (const field of ['body', 'fuel', 'seats', 'boot']) {
        const fact = snapshot.facts[field];
        if (known(fact)) {
          attributes[field] = fact.value;
          if (!iso(fact.provenance?.observedAt)) { incomplete = true; break; }
          featuresAt = Math.max(featuresAt, Date.parse(fact.provenance.observedAt));
        }
      }
      if (incomplete) break;
      attributes.monthlyPoints = entry.terms.value.monthlyPoints; attributes.allowance = entry.terms.value.allowance;
      featuresAt = Math.max(featuresAt, Date.parse(entry.terms.value.quotedAt), Date.parse(entry.exposure.value.until));
      alternatives.push({ alternativeId: entry.orderRef, configurationId: entry.configurationId, isWait: false,
        vehicleClass: known(snapshot.facts.body) ? snapshot.facts.body.value : 'unknown', attributes, snapshot });
    }
    if (incomplete) { exclude('incomplete-choice-evidence'); continue; }
    requireChoice(Number.isFinite(featuresAt) && featuresAt <= Date.parse(observedAt), 'featuresAsOf', 'leakage');
    alternatives.push({ alternativeId: 'wait', isWait: true, vehicleClass: 'wait' });
    const chosenAlternativeId = waited ? 'wait' : record.target.orderRef;
    requireChoice(chosenAlternativeId !== null && alternatives.some((a) => a.alternativeId === chosenAlternativeId), 'target', 'ambiguous-target');
    examples.push(buildChoiceFeatures({ recordId: record.recordId, cohort,
      cycle: { id: cycle.cycleId, index: cycle.index, startsAt: cycle.startsAt, until: cycle.until },
      observedAt, featuresAsOf: new Date(featuresAt).toISOString(), brief: structuredClone(record.brief), alternatives,
      chosenAlternativeId }, featureVersion));
  }
  return { examples, exclusions, manifest: structuredClone(manifest),
    provenance: { label: 'synthetic-trained', seed: manifest.seed, generatorVersion: manifest.generatorVersion,
      assumptions: [
        `Configuration source: ${manifest.snapshot.comparison.configurationSource.kind}.`,
        'Actual FUCQ-113 generator uses latent deterministic fit plus bounded uniform utility noise, not a logit data-generating process.',
        'Waiting is an independent propensity or absent feasible stock; decline and expiry are separate censored outcomes.',
        'Repeated cycles share fictional employee identities, with explicit supply depletion and release timing.',
        'Synthetic assumptions demonstrate pipeline behaviour; no BMW employee calibration or causal price response is established.',
      ] } };
}
