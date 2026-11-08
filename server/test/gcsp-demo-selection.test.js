import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemoPlan } from '../../scripts/gcsp/demo-plan.mjs';
import { selectDemoRows, variationCounts, privacyScan, DEMO_STORE, REPORT_PATH, PLAN_PATH } from '../../scripts/gcsp/demo-selection.mjs';
import { verifyStagedDemoFleet, auditIdentity } from '../../scripts/gcsp/demo-verifier.mjs';
import { validateCorpusDirectory } from '../gcsp/vehicle-evidence/corpus-publisher.js';
import { createSyntheticRegistry } from '../gcsp/vehicle-evidence/synthetic-registry.js';
import { createVehicleEvidenceLookup } from '../gcsp/vehicle-evidence/vehicle-lookup.js';
import { APPROVED_CORPUS_IMAGES } from '../gcsp/vehicle-evidence/registered-corpus-images.js';
import { createPolicyService } from '../gcsp/policy/index.js';
import { offlineEgressGuard } from './helpers/offline-egress-guard.js';

const matrixText = await readFile(new URL('../../docs/gcsp/sources/choices-eligibility-matrices-2024-10.md', import.meta.url), 'utf8');
const realFixture = JSON.parse(await readFile(new URL('./fixtures/gcsp/demo-real-row.json', import.meta.url), 'utf8'));
const rekey = (row) => {
  const codes = [...row.canonicalIdentity.factoryOptionCodes].sort(); const c = row.catalogue; const selection = c.sourceBinding.selection;
  row.canonicalIdentity.factoryOptionCodes = codes; row.canonicalSignature = `${row.canonicalIdentity.vgModelCode}:${codes.join(',')}`;
  row.configurationId = Buffer.from(row.canonicalSignature).toString('base64');
  c.equipment.selected.options = [...codes]; c.sourceBinding.canonicalIdentity.factoryOptionCodes = [...codes]; selection.factoryOptionCodes = [...codes];
  selection.elements = [...codes.map((code) => ({ code, type: 'option' })), ...selection.elements.filter((item) => item.type === 'accessory')];
  for (const name of ['requestedIdentity', 'resolvedIdentity', 'lookupIdentity', 'resolvedLookupIdentity']) c[name].configurationId = row.configurationId;
  return row;
};
// A variant swaps in its own paint and upholstery codes, both options and typed locators, plus an extra pack-like option.
function variant(index, { vg = '2PBC', ag = '52FA', paint = 'P0300', upholstery = 'FEPMI' } = {}) {
  const row = structuredClone(realFixture); const binding = row.catalogue.sourceBinding;
  const codes = row.canonicalIdentity.factoryOptionCodes.filter((code) => !['P0300', 'FEPMI'].includes(code));
  row.canonicalIdentity.factoryOptionCodes = [...codes, paint, upholstery, `ZZ${String(index).padStart(4, '0')}`];
  for (const locator of binding.evidence.flatMap((item) => item.locators)) {
    if (locator.name.startsWith('paint-')) locator.name = `paint-${paint}`;
    if (locator.name.startsWith('upholstery-')) locator.name = `upholstery-${upholstery}`;
  }
  Object.assign(row.canonicalIdentity, { vgModelCode: vg, agModelCode: ag }); Object.assign(row.configuration, { vgModelCode: vg, agModelCode: ag });
  Object.assign(binding.canonicalIdentity, { vgModelCode: vg, agModelCode: ag });
  binding.confirmedContext.modelCode.value = vg; binding.confirmedContext.agModelCode.value = ag;
  binding.requestScope.requests.forEach((request) => { request.modelCode = vg; });
  return rekey(row);
}
function planFor(owned) {
  const plan = createDemoPlan(matrixText, { asOfDate: '2026-11-06' });
  for (const line of plan.modelLines) {
    const own = owned[line.id];
    const evidence = { sourceRef: 'fixture-only-not-a-source-observation.json', sha256: 'b'.repeat(64), locator: line.id,
      observedDate: plan.qualificationDate, kind: 'observed', market: 'GB', matrixModel: line.model, engine: line.engine };
    line.mapping = own ? { status: 'mapped', modelRange: 'G42', ...own, evidence: { ...evidence, modelRange: 'G42', rawModelRange: 'G42', ...own } }
      : { status: 'excluded', reason: 'Fixture-only verified exhaustive absence', evidence: { ...evidence, finding: 'no-current-model', scope: 'complete-current-uk-model-range' } };
  }
  return plan;
}
const PAINTS = ['P0300', 'P0475', 'P0416', 'P0490', 'P0A90'];
const UPHOLSTERIES = ['FEPMI', 'FBLAT', 'FECI2'];
const corpus = (count, options = {}) => Array.from({ length: count }, (_, index) => variant(index + (options.offset || 0),
  { ...options, paint: PAINTS[index % PAINTS.length], upholstery: UPHOLSTERIES[(index >> 1) % UPHOLSTERIES.length] }));

test('selection keeps the minimum and maximum per line, spreads paint and upholstery first and is deterministic', () => {
  const plan = planFor({ 'line-g42-coupe-m240i': { vgModelCode: '2PBC', agModelCode: '52FA' }, 'line-g42-coupe-230i': { vgModelCode: '2PMB', agModelCode: '22CM' } });
  const big = corpus(60); const small = corpus(5, { vg: '2PMB', ag: '22CM', offset: 100 });
  const records = [...big, ...small];
  const first = selectDemoRows({ plan, records });
  const byLine = Object.fromEntries(first.lines.map((item) => [item.line.id, item]));
  assert.equal(byLine['line-g42-coupe-m240i'].selected.length, 45);
  assert.equal(byLine['line-g42-coupe-230i'].selected.length, 5);
  assert.equal(byLine['line-g42-coupe-230i'].belowMinimum, true);
  assert.equal(first.total, 50);
  const counts = variationCounts(byLine['line-g42-coupe-m240i'].selected);
  assert.deepEqual([counts.paint.distinct, counts.upholstery.distinct], [5, 3]);
  const again = selectDemoRows({ plan, records: [...records].reverse() });
  const ids = (result) => result.lines.map((item) => item.selected.map((row) => row.id));
  assert.deepEqual(ids(selectDemoRows({ plan, records })), ids(first));
  assert.deepEqual(new Set(ids(again).flat()), new Set(ids(first).flat()), 'input order cannot change the chosen set');
});

test('selection honours kept rows and takes every row when a line has fewer than the maximum', () => {
  const plan = planFor({ 'line-g42-coupe-m240i': { vgModelCode: '2PBC', agModelCode: '52FA' } });
  const records = corpus(60); const keep = new Set([records[59].configurationId]);
  const selected = selectDemoRows({ plan, records, keep }).lines[0].selected.map((item) => item.id);
  assert.ok(selected.includes(records[59].configurationId));
  const few = selectDemoRows({ plan, records: records.slice(0, 12) });
  assert.equal(few.lines[0].selected.length, 12);
  assert.equal(few.lines[0].belowMinimum, false);
  assert.equal(selectDemoRows({ plan, records: [] }).total, 0);
});

test('rows of another VG code, range or a rejected audit are never selected for a line', () => {
  const plan = planFor({ 'line-g42-coupe-m240i': { vgModelCode: '2PBC', agModelCode: '52FA' } });
  const stray = variant(900, { vg: 'ZZZZ', ag: 'ZZZA' });
  const changed = variant(901); changed.catalogue.sourceBinding.confirmedContext.modelCode.value = 'OTHER';
  const result = selectDemoRows({ plan, records: [...corpus(10), stray, changed] });
  assert.equal(result.total, 10);
  assert.equal(result.unassigned, 1);
  assert.equal(result.invalid, 1);
});

test('wheels and packs are reported unknown unless a typed category locator exists', () => {
  const rows = corpus(10).map((row, index) => ({ audited: auditIdentity(row), index }));
  const plain = variationCounts(rows);
  assert.equal(plain.wheels.state, 'unknown');
  assert.equal(plain.packs.state, 'unknown');
  const typed = corpus(4);
  typed.forEach((row, index) => row.catalogue.sourceBinding.evidence[0].locators.push({ name: `wheels-S0${index % 2}ZZ`, retainedPointer: '/x', sourcePointer: '/y' }));
  const counts = variationCounts(typed.map((row) => ({ audited: auditIdentity(row) })));
  assert.equal(counts.wheels.distinct, 2);
  assert.equal(counts.packs.state, 'unknown');
  assert.equal(counts.vgModelCodes, 1);
});

test('the privacy scan flags VINs, order numbers, keys and image query strings but not configuration IDs', () => {
  const clean = [['report.json', JSON.stringify({ id: realFixture.configurationId, option: 'S01CB', date: '2026-11-07' })]];
  assert.equal(privacyScan(clean).clean, true);
  for (const [name, text] of [['vin17', 'WBA12345678901234'], ['orderNumber', 'order 1234567 placed'], ['accessKey', '{"apiKey":"x"}'],
    ['imageUrlQuery', '"https://example.test/render.webp?sig=abc"']]) {
    const scan = privacyScan([['f', text]]);
    assert.equal(scan.matches[name], 1, name);
    assert.equal(scan.clean, false);
  }
});

test('the committed demo store validates, loads through the lookup port and its manifest count equals the verifier count', async (t) => {
  const guard = offlineEgressGuard(t);
  const root = new URL('../../', import.meta.url).pathname; const store = `${root}${DEMO_STORE}`;
  const policyService = createPolicyService(); const policyRead = { runId: 'demo-store-test', asOf: '2026-11-07T12:00:00.000Z' };
  const active = JSON.parse(await readFile(`${store}/active.json`, 'utf8'));
  const plan = JSON.parse(await readFile(`${root}${PLAN_PATH}`, 'utf8'));
  const report = JSON.parse(await readFile(`${root}${REPORT_PATH}`, 'utf8'));
  assert.equal(plan.publication.stagedDirectory, `${DEMO_STORE}/versions/${active.selected.manifestDigest}`);
  assert.equal(report.publication.manifestDigest, active.selected.manifestDigest);

  const registry = createSyntheticRegistry({ root: store, policyService, policyRead, approvedImages: APPROVED_CORPUS_IMAGES });
  assert.equal((await registry.load()).status, 'ok');
  const loaded = await validateCorpusDirectory(`${store}/versions/${active.selected.manifestDigest}`, { policyService, policyRead, approvedImages: APPROVED_CORPUS_IMAGES });
  assert.equal(loaded.status, 'ok');
  const lookup = createVehicleEvidenceLookup({ registry });
  for (const row of loaded.corpus.configurations) {
    const result = await lookup.resolve({ kind: 'configuration', id: row.configurationId });
    assert.ok(['partial', 'complete'].includes(result.status), `${result.status} for a published configuration`);
  }

  const staged = await verifyStagedDemoFleet({ plan, matrixText, directory: plan.publication.stagedDirectory, policyService, policyRead,
    approvedImages: APPROVED_CORPUS_IMAGES });
  assert.equal(staged.status, 'verified-offline');
  assert.equal(staged.acceptanceComplete, false);
  assert.equal(staged.identity.manifestValid, true);
  assert.equal(staged.identity.recordCount, loaded.manifest.counts.configurations);
  assert.equal(staged.identity.distinctCount, loaded.manifest.counts.distinctConfigurations);
  assert.ok(staged.identity.distinctCount >= 200);
  assert.equal(staged.coverage.localPerLineValid, true);
  assert.equal(staged.coverage.unassignedConfigurations, 0);
  assert.equal(staged.deepLinks.built, staged.identity.recordCount);
  const retainedTrips = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq77/round-trips-2026-11-08/round-trips.json', import.meta.url), 'utf8'));
  assert.deepEqual(staged.roundTrips, retainedTrips.summary);
  assert.equal(staged.openGates.some((gate) => gate.gate === 'headless-round-trips'), retainedTrips.summary.notRun > 0);
  assert.equal(staged.coverage.coverageGaps.length + Object.values(staged.coverage.perLineCounts).filter(Boolean).length, 24);
  assert.equal(report.selection.total, staged.identity.recordCount);
  assert.equal(report.collection.newSourceRequests, 0);
  assert.equal(report.privacy.clean, true);
  guard.assertZero();
});
