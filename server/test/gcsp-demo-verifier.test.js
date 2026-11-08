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
const { auditIdentity, countOtdFacts, scoreEnrichment, scoreRoundTrips } = await import('../../scripts/gcsp/demo-verifier.mjs');
const record = () => structuredClone(fixture);
function rekey(row) {
  const signature = `${row.canonicalIdentity.vgModelCode}:${row.canonicalIdentity.factoryOptionCodes.join(',')}`;
  row.canonicalSignature = signature; row.configurationId = Buffer.from(signature).toString('base64');
}

test('F54 identity verifier exists before records can be audited', () => {
  assert.equal(typeof api.verifyFleetIdentity, 'function');
  assert.equal(typeof api.verifyStagedDemoFleet, 'function');
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

check('additional VG codes of a mapped line count towards that line, not as unassigned', () => {
  const { plan, variant, mapped } = coverageFixture();
  const g61 = mapped.find((line) => line.model === 'G61 i5'); const g60 = mapped.find((line) => line.model === 'G60 i5');
  g60.mapping = { status: 'excluded', reason: 'Fixture-only verified exhaustive absence',
    evidence: { ...g60.mapping.evidence, finding: 'no-current-model', scope: 'complete-current-uk-model-range' } };
  g61.mapping.additionalModels = [{ vgModelCode: 'TSTM', agModelCode: 'TSTA',
    evidence: { ...g61.mapping.evidence, vgModelCode: 'TSTM', agModelCode: 'TSTA' } }];
  const sibling = (index) => {
    const row = variant(index, true);
    for (const identity of [row.catalogue.requestedIdentity, row.catalogue.resolvedIdentity,
      row.catalogue.lookupIdentity, row.catalogue.resolvedLookupIdentity]) identity.modelRange = 'G61E';
    rekey(row); return row;
  };
  const records = [...Array.from({ length: 4 }, (_, index) => variant(index)), ...Array.from({ length: 4 }, (_, index) => sibling(index))];
  const report = api.verifyFleetCoverage({ plan, matrixText, records, verifyEvidence: () => true });
  assert.equal(report.unassignedConfigurations, 0);
  assert.equal(report.perLineCounts[g61.id], 8);
  assert.equal(report.perLineValid, true);
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
    const report = await api.verifyStagedDemoFleet({ plan, matrixText, directory: '/nonexistent-never-read' });
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

check('an evidenced partial plan reads only the named staged directory, never a source, key or browser', async (t) => {
  const guard = offlineEgressGuard(t);
  const plan = JSON.parse(await readFile(new URL('../data/gcsp/vehicle-evidence/demo-plan.json', import.meta.url), 'utf8'));
  const matrixText = await readFile(new URL('../../docs/gcsp/sources/choices-eligibility-matrices-2024-10.md', import.meta.url), 'utf8');
  const report = await api.verifyStagedDemoFleet({ plan, matrixText, directory: '/nonexistent-never-read' });
  assert.equal(report.status, 'invalid');
  assert.equal(report.plan.valid, true);
  assert.equal(report.plan.ready, false);
  assert.equal(report.plan.mappedReady, true);
  assert.deepEqual(report.plan.coverage, { sourceRows: 132, modelLines: 74, mapped: 24, excluded: 4, pending: 46 });
  assert.equal(typeof report.failure.code, 'string');
  assert.equal(report.acceptanceComplete, false);
  assert.equal(report.acceptedDemoConfigurations, 0);
  const escaped = await api.verifyStagedDemoFleet({ plan, matrixText, directory: '../outside-the-repository' });
  assert.equal(escaped.failure.code, 'staged-directory-required');
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
  // The repo's committed sidecar belongs to the demo store, not to this temporary corpus.
  const request = { plan, matrixText, directory, policyService, policyRead, verifyEvidence: () => true, enrichmentEvidence: null };
  const report = await api.verifyStagedDemoFleet(request);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.identity.identityValid, true);
  assert.equal(report.identity.manifestValid, true);
  assert.equal(report.identity.countsValid, false);
  assert.match(report.stagedManifestDigest, /^[a-f0-9]{64}$/);
  assert.equal(report.acceptedDemoConfigurations, 0);
  const required = plan.requirements.minimumDeepLinkChecks;
  // The retained repo results name other records, and a root without the file has none: both leave every check not run.
  assert.deepEqual(report.roundTrips, { required, passed: 0, failed: 0, notRun: required });
  const noFile = await api.verifyStagedDemoFleet({ ...request, root: root });
  assert.deepEqual(noFile.roundTrips, report.roundTrips);
  assert.ok(report.openGates.some((gate) => gate.gate === 'headless-round-trips'));
  await appendFile(join(directory, 'configurations.jsonl'), '{}\n');
  const tampered = await api.verifyStagedDemoFleet(request);
  assert.equal(tampered.status, 'invalid');
  assert.equal(tampered.failure.code, 'checksum-mismatch');
  guard.assertZero();
});

// A real v2 F54 row (G42 M240i, trimmed to six options); rows below are offline mutations, never source observations.
const realFixture = JSON.parse(await readFile(new URL('./fixtures/gcsp/demo-real-row.json', import.meta.url), 'utf8'));
const real = () => structuredClone(realFixture);
function rekeyReal(row) {
  const codes = [...row.canonicalIdentity.factoryOptionCodes].sort();
  row.canonicalIdentity.factoryOptionCodes = codes;
  row.canonicalSignature = `${row.canonicalIdentity.vgModelCode}:${codes.join(',')}`;
  row.configurationId = Buffer.from(row.canonicalSignature).toString('base64');
  const c = row.catalogue; const selection = c.sourceBinding.selection;
  c.equipment.selected.options = [...codes]; c.sourceBinding.canonicalIdentity.factoryOptionCodes = [...codes];
  selection.factoryOptionCodes = [...codes];
  selection.elements = [...codes.map((code) => ({ code, type: 'option' })), ...selection.elements.filter((item) => item.type === 'accessory')];
  for (const name of ['requestedIdentity', 'resolvedIdentity', 'lookupIdentity', 'resolvedLookupIdentity']) c[name].configurationId = row.configurationId;
  return row;
}
function realVariant(index, { vg, ag } = {}) {
  const row = real(); row.canonicalIdentity.factoryOptionCodes.push(`ZZT${String(index).padStart(3, '0')}`);
  if (vg) {
    const binding = row.catalogue.sourceBinding;
    Object.assign(row.canonicalIdentity, { vgModelCode: vg, agModelCode: ag }); Object.assign(row.configuration, { vgModelCode: vg, agModelCode: ag });
    Object.assign(binding.canonicalIdentity, { vgModelCode: vg, agModelCode: ag });
    binding.confirmedContext.modelCode.value = vg; binding.confirmedContext.agModelCode.value = ag;
    binding.requestScope.requests.forEach((request) => { request.modelCode = vg; });
  }
  return rekeyReal(row);
}

check('a real-shaped v2 row passes and records requested-versus-resolved identity and solver changes', () => {
  const row = real(); const audited = auditIdentity(row);
  assert.deepEqual(audited.errors, []);
  assert.deepEqual(audited.identityChange, { bindingDigestChanged: false, configurationIdChanged: false });
  assert.deepEqual(audited.solverChanges, { added: 3, removed: 0, ignored: 0 });
  assert.equal(audited.rawModelRange, 'G42');
  assert.deepEqual(audited.paintCodes, ['P0300']);
  assert.deepEqual(audited.upholsteryCodes, ['FEPMI']);
  assert.equal(audited.orderDate, '2026-11-01');
  assert.equal(audited.modelYear, null);
  assert.deepEqual(row, realFixture, 'audit must not mutate source records');
  assert.equal(api.verifyFleetIdentity({ records: [row] }).identityValid, true);
});

check('a model code changed during solving is rejected as changed-model-code', () => {
  for (const change of [
    (row) => { row.catalogue.sourceBinding.confirmedContext.modelCode.value = 'OTHER'; },
    (row) => { row.catalogue.sourceBinding.confirmedContext.agModelCode.value = 'OTHER'; },
    (row) => { row.catalogue.sourceBinding.requestScope.requests[0].modelCode = 'OTHER'; },
    (row) => { row.catalogue.requestedIdentity.configurationId = Buffer.from('OTHER:FEPMI,P0300').toString('base64'); },
  ]) {
    const row = real(); change(row);
    assert.ok(auditIdentity(row).errors.includes('changed-model-code'));
    assert.equal(api.verifyFleetIdentity({ records: [row] }).identityValid, false);
  }
  const unconfirmed = real(); unconfirmed.catalogue.sourceBinding.confirmedContext.modelCode = { state: 'unknown', value: null };
  assert.ok(auditIdentity(unconfirmed).errors.includes('model-identity'));
});

check('real-shaped rows fail when the ID or signature no longer recomputes', () => {
  for (const change of [
    (row) => { row.configurationId = row.configurationId.replace(/=+$/, ''); },
    (row) => { row.canonicalSignature = `${row.canonicalSignature},ZZZ999`; },
    (row) => { row.catalogue.resolvedLookupIdentity.configurationId = Buffer.from('2PBC:FEPMI').toString('base64'); },
  ]) {
    const row = real(); change(row);
    assert.ok(auditIdentity(row).errors.includes('configuration-id'));
  }
});

check('real-shaped rows reject accessories, missing paint or upholstery and incomplete selections', () => {
  const accessory = real(); accessory.canonicalIdentity.factoryOptionCodes.push('SE000001'); rekeyReal(accessory);
  assert.ok(auditIdentity(accessory).errors.includes('dealer-accessory-in-identity'));
  const noPaint = real(); noPaint.canonicalIdentity.factoryOptionCodes = noPaint.canonicalIdentity.factoryOptionCodes.filter((code) => code !== 'P0300'); rekeyReal(noPaint);
  assert.ok(auditIdentity(noPaint).errors.includes('paint-upholstery-required'));
  const noUpholstery = real(); noUpholstery.canonicalIdentity.factoryOptionCodes = noUpholstery.canonicalIdentity.factoryOptionCodes.filter((code) => code !== 'FEPMI'); rekeyReal(noUpholstery);
  assert.ok(auditIdentity(noUpholstery).errors.includes('paint-upholstery-required'));
  for (const change of [
    (row) => { row.catalogue.completeness.factorySelection = 'partial'; },
    (row) => { row.catalogue.sourceBinding.selection.constructible = false; },
    (row) => { row.catalogue.equipment.selected.state = 'unknown'; },
    (row) => { row.catalogue.sourceBinding.selection.elements.pop(); row.catalogue.sourceBinding.selection.elements.pop(); },
  ]) {
    const row = real(); change(row);
    assert.ok(auditIdentity(row).errors.includes('complete-selection-required'));
  }
  const missing = real(); delete missing.catalogue.resolvedIdentity;
  assert.ok(auditIdentity(missing).errors.includes('requested-resolved-identity'));
});

check('real-shaped rows keep dates, model year and observed source explicit', () => {
  for (const [change, expected] of [
    [(row) => { row.catalogue.sourceBinding.confirmedContext.orderDate = { state: 'unknown', value: null }; }, 'source-dates'],
    [(row) => { row.catalogue.sourceBinding.confirmedContext.effectDate.value = '2027-13-45'; }, 'source-dates'],
    [(row) => { delete row.configuration.modelYear; }, 'model-year-explicit'],
    [(row) => { row.sourceContext.unresolvedFacts = []; }, 'model-year-explicit'],
    [(row) => { row.sourceContext.sourceKind = 'north-american-reference'; }, 'observed-source-required'],
  ]) {
    const row = real(); change(row);
    assert.ok(auditIdentity(row).errors.includes(expected), expected);
  }
});

check('duplicate real-shaped rows are rejected and counted once', () => {
  const report = api.verifyFleetIdentity({ records: [real(), real()] });
  assert.equal(report.distinctCount, 1);
  assert.ok(report.errors.some((error) => error.code === 'duplicate-configuration'));
});

check('real-shaped deep links need the plan range and match the exact sorted options', () => {
  const row = real();
  assert.throws(() => api.configurationDeepLink(row), /invalid/);
  assert.equal(api.configurationDeepLink(row, { modelRange: 'G42' }), 'https://configure.bmw.co.uk/en_GB/configure/G42/2PBC/FEPMI,P0300,S01CB,S0230,S02PA,S033B');
});

function realCoverage() {
  const plan = createDemoPlan(matrixText, { asOfDate: '2026-11-06' });
  const owned = { 'line-g42-coupe-m240i': { vgModelCode: '2PBC', agModelCode: '52FA' }, 'line-g42-coupe-230i': { vgModelCode: '2PMB', agModelCode: '22CM' } };
  for (const line of plan.modelLines) {
    const own = owned[line.id];
    const evidence = { sourceRef: 'fixture-only-not-a-source-observation.json', sha256: 'b'.repeat(64), locator: line.id,
      observedDate: plan.qualificationDate, kind: 'observed', market: 'GB', matrixModel: line.model, engine: line.engine };
    if (own) line.mapping = { status: 'mapped', modelRange: 'G42', ...own, evidence: { ...evidence, modelRange: 'G42', rawModelRange: 'G42', ...own } };
    else line.mapping = { status: 'excluded', reason: 'Fixture-only verified exhaustive absence',
      evidence: { ...evidence, finding: 'no-current-model', scope: 'complete-current-uk-model-range' } };
  }
  const m240 = plan.modelLines.find((line) => line.id === 'line-g42-coupe-m240i');
  m240.mapping.additionalModels = [{ vgModelCode: '2PMC', agModelCode: '52FA',
    evidence: { ...m240.mapping.evidence, vgModelCode: '2PMC', agModelCode: '52FA' } }];
  return plan;
}

check('real-shaped coverage owns rows by VG code, counts additional models and lists lines without local rows as gaps', () => {
  const plan = realCoverage();
  const records = [...Array.from({ length: 5 }, (_, index) => realVariant(index)),
    ...Array.from({ length: 3 }, (_, index) => realVariant(index + 10, { vg: '2PMC', ag: '52FA' })),
    realVariant(30, { vg: '2PMB', ag: '22CM' })];
  const report = api.verifyFleetCoverage({ plan, matrixText, records, verifyEvidence: () => true, retainedCounts: { '2PMB': 117, '2PBC': 8 } });
  assert.equal(report.perLineCounts['line-g42-coupe-m240i'], 8);
  assert.equal(report.perLineCounts['line-g42-coupe-230i'], 1);
  assert.equal(report.localPerLineValid, false);
  assert.deepEqual(report.underMinimum.map((line) => [line.lineId, line.localRows, line.fucq61Rows]), [['line-g42-coupe-230i', 1, 117]]);
  assert.equal(report.unassignedConfigurations, 0);
  assert.equal(report.coverageValid, false);
  const strange = realVariant(40, { vg: 'ZZZZ', ag: 'ZZZA' });
  const other = api.verifyFleetCoverage({ plan, matrixText, records: [...records, strange], verifyEvidence: () => true });
  assert.equal(other.unassignedConfigurations, 1);
  const wrongRange = realVariant(41); wrongRange.catalogue.sourceBinding.confirmedContext.rawModelRange.value = 'G43';
  assert.equal(api.verifyFleetCoverage({ plan, matrixText, records: [wrongRange], verifyEvidence: () => true }).unassignedConfigurations, 1);
  const noLocal = api.verifyFleetCoverage({ plan, matrixText, records: [realVariant(1)], verifyEvidence: () => true, retainedCounts: { '2PMB': 117 } });
  assert.deepEqual(noLocal.coverageGaps.map((line) => [line.lineId, line.localRows, line.fucq61Rows]), [['line-g42-coupe-230i', 0, 117]]);
});

check('OTD facts stay unknown unless the record or a registered supplement knows them', () => {
  const row = real();
  const unknown = countOtdFacts([row]);
  assert.deepEqual(Object.values(unknown).map((item) => item.known), [0, 0, 0, 0, 0]);
  row.catalogue.facts.seats = { ...row.catalogue.facts.seats, state: 'known', value: 4 };
  const counts = countOtdFacts([row]);
  assert.deepEqual([counts.seats.known, counts.seats.unknown, counts.co2.unknown], [1, 0, 1]);
});

check('a validated sidecar entry makes an OTD fact known, while record values and unknowns are unchanged', () => {
  const row = real(); const known = { state: 'known', value: 4, unit: 'COUNT' }; const unknown = { state: 'unknown', value: null, reason: 'unmapped-meaning' };
  const sidecar = new Map([[row.configurationId, { facts: { seats: known, co2: unknown, luggageNormal: unknown } }]]);
  const counts = countOtdFacts([row], {}, sidecar);
  assert.deepEqual([counts.seats.known, counts.co2.known, counts.boot.known, counts.rangeOrEconomy.known, counts.acceleration.known], [1, 0, 0, 0, 0]);
  assert.deepEqual(countOtdFacts([row], {}, new Map()), countOtdFacts([row]), 'no sidecar changes nothing');
});

check('sidecar scoring treats missing evidence as absent and a wrong schema or digest as invalid', () => {
  const digest = 'a'.repeat(64);
  assert.deepEqual(scoreEnrichment(null, [real()], digest).summary, { path: 'server/data/gcsp/vehicle-evidence/demo-enrichment.v1', present: false, valid: null, errors: [] });
  const wrong = scoreEnrichment({ manifest: { schemaVersion: 'other', demoManifestDigest: 'b'.repeat(64), checksums: {} }, jsonl: '' }, [real()], digest);
  assert.equal(wrong.summary.valid, false);
  assert.deepEqual(wrong.summary.errors.slice(0, 3), ['schema-version', 'manifest-digest-mismatch', 'checksum-mismatch']);
});

const trip = (id, url, patch = {}) => ({ configurationId: id, url, constructible: true, missing: [], extra: [], ...patch });
const tripLinks = new Map([['a', 'https://x/a'], ['b', 'https://x/b'], ['c', 'https://x/c']]);

check('round-trip scoring recomputes pass from missing, extra and constructible', () => {
  const evidence = { results: [trip('a', 'https://x/a', { pass: false }), trip('b', 'https://x/b', { missing: ['S0001'], pass: true }),
    trip('c', 'https://x/c', { extra: ['S0002'] })] };
  const { counts, outcomes } = scoreRoundTrips(evidence, tripLinks, 3);
  assert.deepEqual(counts, { required: 3, passed: 1, failed: 2, notRun: 0 });
  assert.deepEqual(outcomes, { a: 'pass', b: 'fail', c: 'fail' });
  assert.equal(scoreRoundTrips({ results: [trip('a', 'https://x/a', { constructible: null })] }, tripLinks, 3).counts.failed, 1);
});

check('round-trip scoring rejects foreign ids, wrong urls and duplicates, and counts absent evidence as not run', () => {
  const evidence = { results: [trip('zz', 'https://x/a'), trip('a', 'https://x/other'), trip('b', 'https://x/b'), trip('b', 'https://x/b')] };
  assert.deepEqual(scoreRoundTrips(evidence, tripLinks, 20).counts, { required: 20, passed: 1, failed: 0, notRun: 19 });
  for (const missing of [null, undefined, {}, { results: 'x' }]) {
    assert.deepEqual(scoreRoundTrips(missing, tripLinks, 20).counts, { required: 20, passed: 0, failed: 0, notRun: 20 });
  }
});
