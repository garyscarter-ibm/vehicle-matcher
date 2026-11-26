import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryRepository, createMemoryStore, inputDigest } from '../../server/gcsp/repository/index.js';
import { MemoryPolicyProvider, PolicyService, createMemoryPolicyStore } from '../../server/gcsp/policy/index.js';
import { createDemoRuntime } from '../../server/gcsp/clock/index.js';
import { loadLearningPolicy, readLearningDataset } from '../../server/gcsp/predict/records/index.js';
import { readModelArtifact } from '../../server/gcsp/predict/model/index.js';
import { runCli as generate } from './generate-learning-records.mjs';
import { runCli as train } from './train-choice-model.mjs';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const good = (out) => { assert.equal(out?.status, 'ok', JSON.stringify(out)); return out.value; };
const SEED = 'fucq320-canonical-80x4-v1';
const START = '2026-11-26T09:00:00.000Z';
const SOURCE = 'scripts/gcsp/retrain-hatchback-choice-model.mjs';
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value)}\n`, { flag: 'wx' });

// Isolated, dated PolicyService publications; the canonical seed and active application runs are untouched.
export async function retrainHatchbackChoiceModel(output) {
  await mkdir(output);
  const repository = createMemoryRepository({ store: createMemoryStore() });
  const policy = new PolicyService({ provider: new MemoryPolicyProvider({ store: createMemoryPolicyStore() }) });
  try {
    good(await repository.open());
    const { clock, identity } = good(await createDemoRuntime({ repository, policy, environmentId: 'fucq320-offline-80x4',
      environmentKind: 'synthetic', commandId: 'fucq320-bootstrap', policyAsOf: START, sessionNow: () => START }));
    const presenter = good(await identity.createPresenterSession('fucq320-presenter')).context;
    let time = good(await clock.now(presenter));
    good(await clock.advance(presenter, { commandId: 'fucq320-dated-preparation', expectedClockVersion: time.clockVersion, to: START }));
    const greg = good(await identity.switchPrincipal(presenter, 'demo-greg', 'fucq320-greg')).context;
    const publisher = policy.withPublicationPorts({ repository, clock, identity });
    const commands = [];
    let version = greg.policyVersion;
    const next = async () => {
      time = good(await clock.now(presenter));
      good(await clock.advance(presenter, { commandId: `fucq320-step:${time.clockVersion}`,
        expectedClockVersion: time.clockVersion, bySeconds: 1 }));
    };
    for (const definitionSetId of ['offer-decline-reasons-v1', 'fucq113-learning-v1', 'fucq115-choice-model-v1']) {
      time = good(await clock.now(presenter));
      const command = { commandId: `fucq320-adopt:${definitionSetId}`, definitionSetId, expectedActiveVersion: version,
        policyVersion: `fucq320-${definitionSetId}`, effectiveFrom: time.now };
      good(await publisher.adoptReviewedAssumptions(greg, command));
      commands.push(command); version = command.policyVersion;
      await next();
    }
    time = good(await clock.now(presenter));
    const read = { runId: greg.runId, asOf: time.now, policyVersion: version };
    const split = good(await policy.getAssumption('choice.training.split.v1', read)).value;
    const needs = good(await policy.getAssumption('comparison.needs.v1', read)).value;
    const hatchbackNeeds = { ...needs, preferences: { ...needs.preferences,
      body: [...needs.preferences.body, { value: 'hatchback', weight: 25 }] } };
    const changes = [
      ['learning.cohortSize', 80], ['learning.cycles', 4], ['learning.maximumGeneratedRecords', 320],
      ['learning.maximumChoiceEntries', 40000], ['comparison.startsAt', time.now],
      ['choice.training.split.v1', { ...split, evaluationCycleIndices: split.evaluationCycleIndices.filter((i) => i < 4) }],
    ].map(([key, value]) => ({ table: 'assumptions', key, patch: { value, status: 'assumed', source: SOURCE,
      sourceDate: '2026-11-26', basis: 'Isolated FUCQ-320 fixed-seed 80x4 structural-fixture retraining; reviewed split narrowed to available cycles, all other settings unchanged.' } }));
    changes.push({ table: 'assumptions', key: 'comparison.needs.v1', patch: { value: hatchbackNeeds,
      status: 'assumed', source: SOURCE, sourceDate: '2026-11-26',
      basis: 'Isolated FUCQ-320 hatchback preference weight equals the existing SUV weight (25); original weights 35/40/25 unchanged. Synthetic assumption, not measured BMW prevalence.' } });
    const command = { commandId: 'fucq320-dataset-80x4', expectedActiveVersion: version,
      policyVersion: 'fucq320-dataset-80x4-v1', effectiveFrom: time.now, changes };
    good(await publisher.publishPolicyVersion(greg, command)); commands.push(command);
    const pin = { ...read, policyVersion: command.policyVersion };
    const snapshot = await loadLearningPolicy({ policyService: policy, policyRead: pin });
    assert.equal(snapshot.comparison.configurationSource.kind, 'reviewed-fixtures');
    assert.ok(snapshot.features.some((row) => row.facts.body.value === 'hatchback'));
    const policyFile = join(output, 'training-policy.json');
    await writeJson(policyFile, good(await policy.getPolicySnapshot(pin)));
    await writeJson(join(output, 'learning-snapshot.json'), snapshot);
    let generated; let trained;
    const capture = (set) => ({ write: (line) => set(JSON.parse(line)), writeError: (line) => { throw new Error(line); } });
    assert.equal(await generate({ argv: ['--snapshot', join(output, 'learning-snapshot.json'), '--seed', SEED,
      '--output', join(output, 'generated'), '--allow-fixtures'], ...capture((value) => { generated = value; }) }), 0);
    const dataset = { manifest: JSON.parse(await readFile(generated.manifestPath)), records: JSON.parse(await readFile(generated.recordsPath)) };
    good(readLearningDataset(dataset)); assert.equal(dataset.records.length, 320);
    const datasetFile = join(output, 'fucq320-choice-training-dataset.json');
    await writeJson(datasetFile, dataset);
    assert.equal(await train({ argv: ['--dataset', datasetFile, '--policy-file', policyFile,
      '--retained-policy-file', join(projectRoot, 'server/gcsp/policy/seed-v1.json'), '--policy-version', pin.policyVersion,
      '--as-of', pin.asOf, '--run-id', pin.runId, '--output', join(output, 'artifacts')],
    ...capture((value) => { trained = value; }) }), 0);
    const artifact = await readModelArtifact(trained.artifactPath, trained.artifactId);
    const sourceHashes = {};
    for (const path of [SOURCE, 'server/gcsp/policy/seed-v1.json', 'server/gcsp/policy/reviewed-definitions.js',
      'server/gcsp/predict/records/policy-definitions.json', 'server/gcsp/policy/reviewed/fucq115-choice-model-v1.json',
      'server/gcsp/policy/reviewed/offer-decline-reasons-v1.json'])
      sourceHashes[path] = createHash('sha256').update(await readFile(join(projectRoot, path))).digest('hex');
    const report = { seed: SEED, policyRead: pin, configurationSource: snapshot.comparison.configurationSource,
      snapshotHash: snapshot.snapshotHash, dataHash: dataset.manifest.dataHash, counts: dataset.manifest.counts,
      commands, sourceHashes, artifactId: trained.artifactId, evaluation: trained,
      partition: artifact.payload.partition, optimizer: artifact.payload.optimizer, exclusions: artifact.payload.exclusions,
      datasetDigest: inputDigest(dataset), activation: 'Not performed by this offline recipe.' };
    await writeJson(join(output, 'result.json'), report);
    return report;
  } finally {
    try { await repository.close(); } finally { await policy.close(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, `Usage: node ${SOURCE} --output NEW_DIRECTORY`);
  assert.equal(process.argv[2], '--output');
  const report = await retrainHatchbackChoiceModel(resolve(process.argv[3]));
  console.log(JSON.stringify({ artifactId: report.artifactId, dataHash: report.dataHash, counts: report.counts }));
}
