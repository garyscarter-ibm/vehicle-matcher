import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, open, link, unlink, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { requireChoice, ChoiceModelError } from './optimizer.js';
import { FEATURE_SETS } from './features.js';

export function canonicalJson(value) {
  const active = new Set();
  function canonical(v) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') { requireChoice(Number.isFinite(v), 'artifact.number'); return v; }
    requireChoice(v !== undefined && typeof v === 'object' && !active.has(v), 'artifact.json');
    active.add(v);
    let result;
    if (Array.isArray(v)) {
      requireChoice(Object.keys(v).length === v.length && v.every((_, i) => Object.hasOwn(v, i)), 'artifact.array');
      result = v.map(canonical);
    } else {
      requireChoice([Object.prototype, null].includes(Object.getPrototypeOf(v)), 'artifact.object');
      result = Object.fromEntries(Object.keys(v).sort().map((key) => [key, canonical(v[key])]));
    }
    active.delete(v); return result;
  }
  return JSON.stringify(canonical(value));
}
export const contentDigest = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const text = (v) => typeof v === 'string' && v.length > 0;

export function createModelArtifact(payload) {
  canonicalJson(payload);
  requireChoice(payload?.schemaVersion === 1 && payload.modelVersion === 'conditional-logit.l2.v1'
    && Object.hasOwn(FEATURE_SETS, payload.featureVersion), 'artifact.version');
  const expected = FEATURE_SETS[payload.featureVersion];
  requireChoice(Array.isArray(payload.featureNames) && canonicalJson(payload.featureNames) === canonicalJson(expected)
    && Array.isArray(payload.coefficients) && payload.coefficients.length === expected.length
    && payload.coefficients.every((v) => typeof v === 'number' && Number.isFinite(v)), 'artifact.coefficients');
  requireChoice(text(payload.policyVersion) && payload.trainingSettings && payload.trainingManifest && payload.partition
    && payload.evaluation && Array.isArray(payload.limitations) && payload.limitations.length > 0
    && payload.provenance?.label === 'synthetic-trained' && text(payload.provenance.generatorVersion)
    && (text(payload.provenance.seed) || Number.isSafeInteger(payload.provenance.seed))
    && Array.isArray(payload.provenance.assumptions) && payload.provenance.assumptions.length > 0, 'artifact.provenance');
  const manifest = payload.trainingManifest; const counts = payload.partition.counts;
  requireChoice(manifest.schemaVersion === 1 && manifest.datasetKind === 'synthetic'
    && /^[a-f0-9]{64}$/.test(manifest.dataHash) && manifest.generatorVersion === payload.provenance.generatorVersion
    && manifest.seed === payload.provenance.seed && Number.isSafeInteger(manifest.counts?.records) && manifest.counts.records > 0,
  'artifact.manifest');
  requireChoice(['training', 'later', 'unseen', 'familiar'].every((key) => Number.isSafeInteger(counts?.[key]) && counts[key] > 0)
    && counts.unseen + counts.familiar === counts.later, 'artifact.partition');
  for (const key of ['learned', 'expressedDemand', 'deterministicFit']) {
    const report = payload.evaluation.models?.[key]; const overall = report?.overall;
    requireChoice(overall?.count === counts.later && ['logLoss', 'brier'].every((field) => typeof overall[field] === 'number'
      && Number.isFinite(overall[field]) && overall[field] >= 0) && overall.brier <= 2
      && Array.isArray(report.byCohort) && Array.isArray(report.byVehicleClass) && Array.isArray(report.reliability)
      && text(report.provenance?.source) && text(report.provenance?.version), `artifact.evaluation.${key}`);
  }
  // Clone before hashing: mutable caller inputs cannot alter a returned artifact.
  const retained = JSON.parse(canonicalJson(payload));
  const freeze = (v) => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
  return freeze({ artifactId: `sha256:${contentDigest(retained)}`, payload: retained });
}

export function verifyModelArtifact(artifact) {
  requireChoice(artifact && Object.keys(artifact).length === 2 && Object.hasOwn(artifact, 'payload'), 'artifact.envelope');
  const expected = createModelArtifact(artifact.payload);
  requireChoice(artifact.artifactId === expected.artifactId, 'artifact.digest', 'artifact-corrupt');
  return expected;
}

export async function writeModelArtifact(directory, input) {
  const artifact = verifyModelArtifact(input);
  const filename = `${artifact.artifactId.slice(7)}.json`; const path = join(directory, filename);
  const bytes = `${canonicalJson(artifact)}\n`;
  await mkdir(directory, { recursive: true });
  // Link a fully written private inode atomically; never expose a partially written artifact.
  const temporary = join(directory, `.writing-${randomUUID()}`);
  let reused = false; let handle; let owned = false;
  try {
    handle = await open(temporary, 'wx', 0o444); owned = true;
    await handle.writeFile(bytes); await handle.close(); handle = undefined;
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireChoice(await readFile(path, 'utf8') === bytes, 'artifact.existing', 'artifact-corrupt'); reused = true;
    }
  } finally { if (handle) await handle.close(); if (owned) await unlink(temporary); }
  return { artifactId: artifact.artifactId, path, reused };
}

export async function readModelArtifact(path, expectedId) {
  try {
    requireChoice(/^sha256:[a-f0-9]{64}$/.test(expectedId) && basename(path) === `${expectedId.slice(7)}.json`, 'artifact.path');
    requireChoice((await stat(path)).size <= 8 * 1024 * 1024, 'artifact.size');
    const artifact = verifyModelArtifact(JSON.parse(await readFile(path, 'utf8')));
    requireChoice(artifact.artifactId === expectedId, 'artifact.reference', 'artifact-corrupt'); return artifact;
  } catch (error) {
    if (error instanceof ChoiceModelError) throw error;
    throw new ChoiceModelError('artifact-unavailable', 'artifact');
  }
}

export function evaluationSummary(input) {
  const { artifactId, payload } = verifyModelArtifact(input);
  const project = (result) => ({ overall: structuredClone(result.overall), byCohort: structuredClone(result.byCohort),
    byVehicleClass: structuredClone(result.byVehicleClass), reliability: structuredClone(result.reliability),
    provenance: structuredClone(result.provenance) });
  requireChoice(['learned', 'expressedDemand', 'deterministicFit'].every((key) => input.payload.evaluation.models?.[key]),
    'summary.baselines', 'baseline-unavailable');
  // Deliberate allowlist: record IDs, employee references and training rows stay outside panels.
  return { schemaVersion: 1, status: 'evaluated', artifactId, policyVersion: payload.policyVersion,
    featureVersion: payload.featureVersion, label: 'Synthetic-trained; offline evaluation',
    partitionCounts: structuredClone(payload.partition.counts),
    metrics: Object.fromEntries(['learned', 'expressedDemand', 'deterministicFit'].map((key) => [key, project(payload.evaluation.models[key])])),
    deltas: structuredClone(payload.evaluation.deltas), limitations: [...payload.limitations],
    trainingOrigin: { label: payload.provenance.label, generatorVersion: payload.provenance.generatorVersion,
      seed: payload.provenance.seed, assumptions: [...payload.provenance.assumptions] } };
}
