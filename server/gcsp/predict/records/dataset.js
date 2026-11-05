import { inputDigest, ok, result } from '../../repository/index.js';
import { freezeVehicleData } from '../../../vehicles/index.js';
import { validateLearningRecord } from './schema.js';
import { generateLearningRecords, LEARNING_GENERATOR_VERSION } from './generator.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const invalid = (field) => result('invalid', { code: 'invalid-learning-dataset', reasons: [{ field, reason: 'Dataset manifest or records failed validation.' }] });
const counts = (records, cycles) => ({ records: records.length, cycles: cycles.length,
  provenance: { observed: 0, synthetic: records.length }, outcomes: Object.fromEntries([
    ['offered', 'offered'], ['selection', 'selected'], ['acceptance', 'accepted'], ['decline', 'declined'], ['expiry', 'expired'], ['wait', 'waited'],
  ].map(([field, state]) => [state, records.filter((r) => r.outcomes[field].state === state).length])) });

export function createLearningDataset(seed, snapshot) {
  const { records, cycles } = generateLearningRecords(seed, snapshot);
  const manifest = { schemaVersion: 1, datasetKind: 'synthetic', seed, generatorVersion: LEARNING_GENERATOR_VERSION,
    policyVersion: snapshot.policyVersion, snapshotHash: snapshot.snapshotHash,
    policyHash: inputDigest({ assumptions: snapshot.assumptions, comparisonAssumptions: snapshot.comparison.assumptions,
      allowances: snapshot.comparison.allowances, candidatePolicies: snapshot.candidatePolicies }),
    configurationHash: inputDigest({ source: snapshot.comparison.configurationSource, configurations: snapshot.comparison.configurations, features: snapshot.features }),
    dataHash: inputDigest(records), counts: counts(records, cycles), cycles, snapshot };
  return freezeVehicleData({ manifest, records });
}

// Hashes establish internal consistency, not authenticity or a claim of real BMW data.
export function validateLearningDataset(dataset) {
  try {
    if (!exact(dataset, ['manifest', 'records']) || !Array.isArray(dataset.records)) return invalid('dataset');
    const m = dataset.manifest;
    if (!exact(m, ['schemaVersion', 'datasetKind', 'seed', 'generatorVersion', 'policyVersion', 'snapshotHash', 'policyHash',
      'configurationHash', 'dataHash', 'counts', 'cycles', 'snapshot']) || m.schemaVersion !== 1 || m.datasetKind !== 'synthetic'
      || m.generatorVersion !== LEARNING_GENERATOR_VERSION) return invalid('manifest');
    if (dataset.records.length !== m.counts?.records || new Set(dataset.records.map((r) => r.recordId)).size !== dataset.records.length) return invalid('records.count');
    for (const r of dataset.records) {
      if (validateLearningRecord(r).status !== 'ok' || r.provenance.kind !== 'synthetic' || r.provenance.seed !== m.seed
        || r.provenance.generatorVersion !== m.generatorVersion || r.brief.policyVersion !== m.policyVersion) return invalid('records.provenance');
    }
    const expected = createLearningDataset(m.seed, m.snapshot);
    if (inputDigest(expected.manifest) !== inputDigest(m) || inputDigest(expected.records) !== inputDigest(dataset.records)) return invalid('manifest.identity');
    return ok(freezeVehicleData(structuredClone(dataset)));
  } catch { return invalid('dataset'); }
}

export function readLearningDataset(input) {
  try { return validateLearningDataset(typeof input === 'string' ? JSON.parse(input) : input); }
  catch { return invalid('json'); }
}
