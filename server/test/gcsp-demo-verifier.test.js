import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, appendFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { offlineEgressGuard } from './helpers/offline-egress-guard.js';

// These are existing F54 records. Clones/mutations below are offline regressions, never source observations.
const fixture = (await readFile(new URL('../data/gcsp/vehicle-evidence/publication-reference.v1/configurations.jsonl', import.meta.url), 'utf8'))
  .trim().split('\n').map((line) => JSON.parse(line)).find((row) => row.configuration.market === 'GB');
const api = await import('../../scripts/gcsp/verify-fleet.mjs').catch((error) => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const available = typeof api.verifyFleetIdentity === 'function';
const check = (name, run) => test(name, { skip: !available }, run);
const matrixText = await readFile(new URL('../../docs/gcsp/sources/choices-eligibility-matrices-2024-10.md', import.meta.url), 'utf8');
const { createDemoPlan } = await import('../../scripts/gcsp/demo-plan.mjs');
const record = () => structuredClone(fixture);
function rekey(row) {
  const signature = `${row.canonicalIdentity.vgModelCode}:${row.canonicalIdentity.factoryOptionCodes.join(',')}`;
  row.canonicalSignature = signature; row.configurationId = Buffer.from(signature).toString('base64');
}

test('F54 identity verifier exists before records can be audited', () => {
  assert.equal(typeof api.verifyFleetIdentity, 'function');
  assert.equal(typeof api.verifyStagedFleet, 'function');
});

check('recomputes exact VG padded Base64 and accepts the existing complete F54 identity', () => {
  const row = record();
  const report = api.verifyFleetIdentity({ records: [row] });
  assert.equal(report.identityValid, true, JSON.stringify(report.errors));
  assert.equal(report.distinctCount, 1);
  assert.equal(report.countsValid, false);
  assert.equal(report.acceptedDemoConfigurations, 0);
  assert.equal(report.acceptanceComplete, false);
  assert.equal(report.scope, 'F54-identity-only');
  assert.deepEqual(row, fixture, 'audit must not mutate source records');
});

check('a Base64 ID from the AG code or an unpadded ID fails recomputation', () => {
  for (const change of [
    (row) => { row.configurationId = Buffer.from(`${row.canonicalIdentity.agModelCode}:${row.canonicalIdentity.factoryOptionCodes.join(',')}`).toString('base64'); },
    (row) => { row.configurationId = row.configurationId.replace(/=+$/, ''); },
  ]) {
    const row = record(); change(row);
    assert.equal(api.verifyFleetIdentity({ records: [row] }).identityValid, false);
  }
});

check('cache dates, snapshot labels and provenance cannot inflate distinct count', () => {
  const first = record(); const second = record();
  second.snapshotVersion = 'different-cache-label'; second.sourceContext.observedDate = '2026-11-02';
  const report = api.verifyFleetIdentity({ records: [first, second] });
  assert.equal(report.distinctCount, 1);
  assert.equal(report.identityValid, false);
  assert.ok(report.errors.some((error) => error.code === 'duplicate-configuration'));
});

check('factory identity must include paint and upholstery and exclude accessories', () => {
  for (const change of [
    (row) => { row.canonicalIdentity.factoryOptionCodes = row.canonicalIdentity.factoryOptionCodes.filter((code) => !code.startsWith('P')); },
    (row) => { row.canonicalIdentity.factoryOptionCodes = row.canonicalIdentity.factoryOptionCodes.filter((code) => !code.startsWith('F')); },
    (row) => { row.canonicalIdentity.factoryOptionCodes.push('SE000001'); },
  ]) {
    const row = record(); change(row); rekey(row);
    assert.equal(api.verifyFleetIdentity({ records: [row] }).identityValid, false);
  }
});

check('partial, unsorted, repeated, lowercase and incomplete catalogue selections fail', () => {
  for (const change of [
    (row) => { row.catalogue.equipment.selected.complete = false; },
    (row) => { row.catalogue.completeness.selectedConfiguration = 'partial'; },
    (row) => { row.canonicalIdentity.factoryOptionCodes.reverse(); },
    (row) => { row.canonicalIdentity.factoryOptionCodes.push(row.canonicalIdentity.factoryOptionCodes[0]); },
    (row) => { row.canonicalIdentity.factoryOptionCodes[0] = row.canonicalIdentity.factoryOptionCodes[0].toLowerCase(); },
    (row) => { row.catalogue.resolvedIdentity.selectedOptions.pop(); },
    (row) => { row.catalogue.requestedIdentity.selectedOptions.pop(); },
    (row) => { row.catalogue.resolvedLookupIdentity.modelRange = 'OTHER'; },
  ]) {
    const row = record(); change(row);
    assert.equal(api.verifyFleetIdentity({ records: [row] }).identityValid, false);
  }
});

function coverageFixture() {
  const plan = createDemoPlan(matrixText, { asOfDate: '2026-11-06' });
  const mapped = plan.modelLines.filter((line) => ['G61 i5', 'G60 i5'].includes(line.model) && line.engine === 'i5 40');
  for (const line of plan.modelLines) {
    const evidence = { sourceRef: 'fixture-only-not-a-source-observation.json', sha256: 'b'.repeat(64), locator: line.id,
      observedDate: plan.qualificationDate, kind: 'observed', market: 'GB', matrixModel: line.model, engine: line.engine };
    if (mapped.includes(line)) {
      const values = line.model === 'G61 i5' ? { modelRange: 'G61E', vgModelCode: 'T5MJ', agModelCode: '72HH' }
        : { modelRange: 'G60E', vgModelCode: 'TSTM', agModelCode: 'TSTA' };
      line.mapping = { status: 'mapped', ...values, evidence: { ...evidence, ...values } };
    } else line.mapping = { status: 'excluded', reason: 'Fixture-only verified exhaustive absence',
      evidence: { ...evidence, finding: 'no-current-model', scope: 'complete-current-uk-model-range' } };
  }
  const variant = (index, other = false) => {
    const row = record();
    const options = [...row.canonicalIdentity.factoryOptionCodes, `ZZT${String(index).padStart(3, '0')}`].sort();
    row.canonicalIdentity.factoryOptionCodes = options;
    row.catalogue.equipment.selected.options = [...options];
    for (const identity of [row.catalogue.requestedIdentity, row.catalogue.resolvedIdentity,
      row.catalogue.lookupIdentity, row.catalogue.resolvedLookupIdentity]) {
      identity.selectedOptions = [...options];
      if (other) Object.assign(identity, { modelCode: 'TSTM', agModelCode: 'TSTA', modelRange: 'G60E' });
    }
    if (other) {
      Object.assign(row.canonicalIdentity, { vgModelCode: 'TSTM', agModelCode: 'TSTA' });
      Object.assign(row.configuration, { vgModelCode: 'TSTM', agModelCode: 'TSTA' });
    }
    rekey(row); return row;
  };
  return { plan, variant, mapped };
}

check('200 total cannot hide a mapped line with seven configurations', () => {
  const { plan, variant, mapped } = coverageFixture();
  const records = [...Array.from({ length: 200 }, (_, index) => variant(index)),
    ...Array.from({ length: 7 }, (_, index) => variant(index, true))];
  const report = api.verifyFleetCoverage({ plan, matrixText, records, verifyEvidence: () => true });
  assert.equal(report.totalValid, true);
  assert.equal(report.perLineValid, false);
  assert.equal(report.coverageValid, false);
  assert.equal(report.perLineCounts[mapped.find((line) => line.model === 'G60 i5').id], 7);
  records.push(variant(7, true));
  const complete = api.verifyFleetCoverage({ plan, matrixText, records, verifyEvidence: () => true });
  assert.equal(complete.coverageValid, true);
  assert.equal(complete.distinctCount, 208);
  assert.equal(complete.acceptedDemoConfigurations, 0);
});

check('eight per line cannot weaken the independent total of 200', () => {
  const { plan, variant } = coverageFixture();
  const records = Array.from({ length: 8 }, (_, index) => [variant(index), variant(index, true)]).flat();
  const report = api.verifyFleetCoverage({ plan, matrixText, records, verifyEvidence: () => true });
  assert.equal(report.perLineValid, true);
  assert.equal(report.totalValid, false);
  assert.equal(report.coverageValid, false);
});

check('changed model codes, lost source dates and unknown-without-provenance cannot pass', () => {
  for (const change of [
    (row) => { row.catalogue.requestedIdentity.modelCode = 'OTHER'; },
    (row) => { row.catalogue.resolvedIdentity.agModelCode = 'OTHER'; },
    (row) => { delete row.catalogue.lookupIdentity.modelRange; },
    (row) => { row.catalogue.catalogueValidity.effectDate = null; },
    (row) => { row.sourceContext.observedDate = null; },
    (row) => { delete row.configuration.modelYear; },
    (row) => { row.sourceContext.unresolvedFacts = []; },
  ]) {
    const row = record(); change(row);
    assert.equal(api.verifyFleetIdentity({ records: [row] }).identityValid, false);
  }
});

check('manifest configuration counts must equal the actual audited distinct rows', () => {
  const manifest = { counts: { configurations: 200, distinctConfigurations: 200 } };
  const report = api.verifyFleetIdentity({ records: [record()], manifest });
  assert.equal(report.manifestValid, false);
  assert.ok(report.errors.some((error) => error.code === 'manifest-count-mismatch'));
});

check('the 200 minimum cannot be reduced by a verifier flag', () => {
  assert.throws(() => api.verifyFleetIdentity({ records: [record()], minimumDistinct: 1 }), /at least 200/);
});

check('deep links retain exact range, VG and complete sorted factory options without dealer accessories', () => {
  const row = record();
  assert.equal(api.configurationDeepLink(row), `https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ/${row.canonicalIdentity.factoryOptionCodes.join(',')}`);
  row.catalogue.resolvedIdentity.modelCode = 'OTHER';
  assert.throws(() => api.configurationDeepLink(row), /invalid/);
});

check('error reports expose row indexes and codes without source values or private payloads', () => {
  const row = record(); row.configurationId = 'PRIVATE-DO-NOT-PRINT'; row.catalogue.lookupIdentity.modelCode = 'PRIVATE-DO-NOT-PRINT';
  const report = api.verifyFleetIdentity({ records: [row] });
  assert.equal(JSON.stringify(report).includes('PRIVATE-DO-NOT-PRINT'), false);
  assert.ok(report.errors.every((error) => typeof error.code === 'string' && !Object.hasOwn(error, 'record')));
});

check('invalid plans are rejected before the valid pending-plan readiness branch', async (t) => {
  const guard = offlineEgressGuard(t);
  for (const change of [
    (plan) => { plan.schemaVersion = 'invalid-schema'; },
    (plan) => { plan.requirements.minimumDistinct = 199; },
  ]) {
    const plan = createDemoPlan(matrixText, { asOfDate: '2026-11-06' }); change(plan);
    const report = await api.verifyStagedFleet({ plan, matrixText, directory: '/nonexistent-never-read' });
    assert.equal(report.plan.valid, false);
    assert.equal(report.status, 'invalid');
    assert.equal(report.acceptanceComplete, false);
    assert.equal(report.acceptedDemoConfigurations, 0);
  }
  guard.assertZero();
});

check('CLI distinguishes invalid plans exit 1 from a valid 74-pending plan exit 2', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'f77-cli-plans-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL('../../scripts/gcsp/verify-fleet.mjs', import.meta.url));
  for (const [name, change, exit, status, valid] of [
    ['schema', (plan) => { plan.schemaVersion = 'invalid-schema'; }, 1, 'invalid', false],
    ['minimum', (plan) => { plan.requirements.minimumDistinct = 199; }, 1, 'invalid', false],
    ['pending', () => {}, 2, 'incomplete', true],
  ]) {
    const plan = createDemoPlan(matrixText, { asOfDate: '2026-11-06' }); change(plan);
    const path = join(root, `${name}.json`); await writeFile(path, JSON.stringify(plan));
    const result = spawnSync(process.execPath, [script, '--config', path, '--staged',
      '--directory', join(root, 'nonexistent-never-read'), '--require-distinct', '200'],
    { encoding: 'utf8', timeout: 5000, maxBuffer: 32 * 1024 });
    assert.equal(result.error, undefined, name);
    assert.equal(result.signal, null, name);
    assert.equal(result.status, exit, name);
    assert.equal(result.stderr, '', name);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, status, name);
    assert.equal(report.plan.valid, valid, name);
    assert.equal(report.plan.ready, false, name);
    assert.equal(report.acceptanceComplete, false, name);
    assert.equal(report.acceptedDemoConfigurations, 0, name);
    if (valid) assert.equal(report.plan.coverage.pending, 74);
  }
});

check('pending plan blocks staged acceptance before any directory, source, key or browser work', async (t) => {
  const guard = offlineEgressGuard(t);
  const plan = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/demo-plan.json', import.meta.url), 'utf8'));
  const matrixText = await readFile(new URL('../../docs/gcsp/sources/choices-eligibility-matrices-2024-10.md', import.meta.url), 'utf8');
  const report = await api.verifyStagedFleet({ plan, matrixText, directory: '/nonexistent-never-read' });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.plan.valid, true);
  assert.equal(report.plan.ready, false);
  assert.equal(report.plan.coverage.pending, 74);
  assert.equal(report.acceptanceComplete, false);
  assert.equal(report.acceptedDemoConfigurations, 0);
  guard.assertZero();
});

check('staged checks use the real F54 schema/hash validator without publishing or generating VINs', async (t) => {
  const guard = offlineEgressGuard(t);
  const { writeCorpusCandidate } = await import('../gcsp/vehicle-evidence/corpus-publisher.js');
  const { emptyAllocationInventory } = await import('../gcsp/vehicle-evidence/vin-allocation.js');
  const manifest = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/publication-reference.v1/manifest.json', import.meta.url), 'utf8'));
  const policyService = { async getAssumption(key) {
    return { status: 'ok', policyVersion: manifest.signaturePolicy.policyVersion, value: structuredClone(manifest.signaturePolicy.assumptions[key]) };
  } };
  const policyRead = { runId: 'f77-offline-verifier', asOf: '2026-11-06T00:00:00.000Z', policyVersion: manifest.signaturePolicy.policyVersion };
  const root = await mkdtemp(join(tmpdir(), 'f77-candidate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'candidate');
  const input = { configurations: [record()], allocationInventory: emptyAllocationInventory(), images: [],
    metadata: { ...manifest, sourceContexts: manifest.sourceContexts.filter((source) => source.market === 'GB') } };
  const written = await writeCorpusCandidate(directory, input, { policyService, policyRead });
  assert.equal(written.status, 'ok', JSON.stringify(written.failure));
  assert.equal(written.manifest.counts.vinMappings, 0);
  const { plan } = coverageFixture();
  const request = { plan, matrixText, directory, policyService, policyRead, verifyEvidence: () => true };
  const report = await api.verifyStagedFleet(request);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.identity.identityValid, true);
  assert.equal(report.identity.manifestValid, true);
  assert.equal(report.identity.countsValid, false);
  assert.match(report.stagedManifestDigest, /^[a-f0-9]{64}$/);
  assert.equal(report.acceptedDemoConfigurations, 0);
  await appendFile(join(directory, 'configurations.jsonl'), '{}\n');
  const tampered = await api.verifyStagedFleet(request);
  assert.equal(tampered.status, 'invalid');
  assert.equal(tampered.failure.code, 'checksum-mismatch');
  guard.assertZero();
});
