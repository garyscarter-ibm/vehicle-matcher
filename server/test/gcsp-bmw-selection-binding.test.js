/** Synthetic retained protocol observations only; these tests perform no source requests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PolicyService, FilePolicyProvider } from '../gcsp/policy/index.js';
import { createConfigurationKey } from '../../scripts/gcsp/configuration-key.mjs';
import { inputDigest } from '../gcsp/repository/core.js';
import { strictModelReport } from '../../scripts/gcsp/public-bmw-source.mjs';
import { createFleetCollector } from '../../scripts/gcsp/collect-fleet.mjs';

const moduleUrl = new URL('../../scripts/gcsp/bmw-selection-binding.mjs', import.meta.url);
const binding = await import(moduleUrl).catch((error) => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === moduleUrl.href) return {};
  throw error;
});
const originalPlan = JSON.parse(await readFile(new URL('../../docs/gcsp/evidence/fucq59/source-executor-2026-11-06/collection-plan.json', import.meta.url)));
const encode = (v) => JSON.stringify(v) + '\n';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const ref = (evidenceId, locatorName) => ({ evidenceId, locatorName });
const unknown = (reason = 'absent-evidence') => ({ state: 'unknown', value: null, reason, evidenceRefs: [] });
const treeUrl = 'https://prod.ucp.bmw.cloud/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2026-11-01/order-dates/2026-11-01?gfs-policy=none&cluster=default&model-ranges=G61E&future-models=true&closest-fallback=true';
const solveUrl = 'https://prod.ucp.bmw.cloud/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/models/T5MJ?add-rules-for-mandatory-element-classes=fabric%2Cpaint%2Crim&application=connext&included-elements=FKSFU%2CP0300%2CS0337%2CS043L&mandatory-elements=S0337';
const requestCodes = ['FKSFU', 'P0300', 'S0337', 'S043L'];
function artifact(operation, report, locators, requestUrl) {
  const observation = { schemaVersion: 'collection-http-observation.v1', operation,
    sourceId: originalPlan.source.id, sourceVersion: originalPlan.source.version,
    capability: operation === 'discover' ? 'bmw-model-tree' : 'bmw-solver', transportKind: 'fixture',
    request: { method: 'GET', url: requestUrl }, observedAt: '2026-11-07T00:10:00.000Z',
    responseBytes: 12345, responseSha256: sha('synthetic raw response ' + operation) };
  const document = { schemaVersion: 'bmw-complete-selection.v1', observation,
    requestSha256: sha(encode(observation.request)), rawSelectionSha256: sha(encode(report)), locators, report };
  const bytes = encode(document);
  return { bytes, artifactSha256: sha(bytes), retrievedAt: '2026-11-07T00:11:00.000Z' };
}
async function fixture({ quantity = null } = {}) {
  const configurationKey = await createConfigurationKey({ policyService: new PolicyService({ provider: new FilePolicyProvider() }),
    policyRead: { runId: 'synthetic-bmw-binding', ...originalPlan.policyRead } });
  const plan = { ...structuredClone(originalPlan), captureVersion: 'bmw-complete-selection.v1', qualificationDate: '2026-11-07' };
  const model = { modelCode: 'T5MJ', agModelCode: '72HH', modelRange: 'G61', steering: 'RL',
    orderDate: '2026-11-01', effectDate: '2027-01-05', taxDate: '2027-01-05' };
  const rawTree = Object.fromEntries(['5', 'I'].map((group) => [group, { modelRanges: { G61E: { models: { T5MJ: structuredClone(model) } } } }]));
  const treeReport = strictModelReport(rawTree);
  const treeLocators = treeReport.nodes.flatMap((node, index) => Object.entries(node.fieldPointers).map(([name, sourcePointer]) =>
    ({ name: `${index}-${name}`, sourcePointer, retainedPointer: `/report/nodes/${index}/facts/${name}` })));
  const factoryCodes = plan.knownSelection.factoryCodes;
  const elements = Object.fromEntries([...factoryCodes, 'SE000001'].sort().map((code) => [code,
    { code, type: code === 'SE000001' ? 'accessory' : 'option', ...(code === 'SE000001' && quantity !== null ? { quantity } : {}) }]));
  const added = Object.keys(elements).filter((code) => !requestCodes.includes(code));
  const solverReport = { constructible: true, configuration: { modelCode: 'T5MJ', elements },
    configurationChanges: { state: 'present', maps: { addedElements: Object.fromEntries(added.map((code) => [code, structuredClone(elements[code])])) } },
    derivedChanges: { basis: 'request-resolved-set-difference', added, removed: [], ignored: { state: 'unknown', codes: null } },
    accessories: [{ code: 'SE000001', type: 'accessory', quantity: quantity === null ? { state: 'unknown', value: null, reason: 'quantity-not-exposed' }
      : { state: 'known', value: quantity, reason: null } }] };
  const solverLocators = ['constructible', 'configuration/modelCode', 'configuration/elements'].map((pointer) =>
    ({ name: pointer.split('/').at(-1), sourcePointer: '/' + pointer, retainedPointer: '/report/' + pointer }));
  solverLocators.push({ name: 'configurationChanges', sourcePointer: '/configurationChanges', retainedPointer: '/report/configurationChanges/maps' });
  if (quantity !== null) solverLocators.push({ name: 'quantity-SE000001', sourcePointer: '/configuration/elements/SE000001/quantity',
    retainedPointer: '/report/configuration/elements/SE000001/quantity' });
  return { plan, configurationKey, producerPins: { projectorSha256: sha('synthetic capture projector'), qualifierSha256: sha('synthetic binder'),
    sessionSha256: sha('synthetic executor'), policyVersion: configurationKey.policyVersion }, snapshotVersion: 'synthetic-binding-20261107.v2',
  artifacts: { tree: artifact('discover', treeReport, treeLocators, treeUrl), solver: artifact('solve', solverReport, solverLocators, solveUrl) } };
}
function build(input) {
  assert.equal(typeof binding.buildBmwSelectionBinding, 'function', 'source-backed selection binder is required');
  return binding.buildBmwSelectionBinding(input);
}
function rewrite(input, name, mutate, refreshInternals = false) {
  const entry = input.artifacts[name]; const document = JSON.parse(entry.bytes); mutate(document);
  if (refreshInternals) { document.requestSha256 = sha(encode(document.observation.request)); document.rawSelectionSha256 = sha(encode(document.report)); }
  entry.bytes = encode(document); entry.artifactSha256 = sha(entry.bytes);
}
function rebindCandidate(candidate, input) {
  const envelope = candidate.catalogue; const source = envelope.sourceBinding;
  const key = input.configurationKey(source.canonicalIdentity);
  const identity = { snapshotVersion: input.snapshotVersion, bindingDigest: inputDigest(source), configurationId: key.configurationId };
  const lookup = { provider: envelope.provider, providerVersion: envelope.providerVersion, schemaVersion: envelope.schemaVersion,
    sourceContractVersion: envelope.sourceContractVersion, ...identity };
  envelope.requestedIdentity = structuredClone(identity); envelope.resolvedIdentity = structuredClone(identity);
  envelope.lookupIdentity = structuredClone(lookup); envelope.resolvedLookupIdentity = structuredClone(lookup);
  candidate.configurationId = key.configurationId; candidate.canonicalSignature = key.decodedIdentity;
  candidate.canonicalIdentity = structuredClone(key.canonicalIdentity); candidate.catalogueRequest = structuredClone(identity);
  candidate.lookupIdentity = structuredClone(lookup);
}

test('binder derives exact retained source selection and dated context while preserving unknown optional facts', async () => {
  const input = await fixture(); const before = JSON.stringify(input.artifacts);
  const result = build(input); assert.equal(result.status, 'qualified'); assert.equal(result.admission, false);
  const record = result.record; const source = record.catalogue.sourceBinding;
  assert.equal(record.sourceKind, 'synthetic-capture-fixture');
  assert.equal(record.canonicalSignature, 'T5MJ:' + input.plan.knownSelection.factoryCodes.join(','));
  assert.equal(record.configurationId, input.configurationKey(source.canonicalIdentity).configurationId);
  assert.deepEqual(record.resolvedOptions, input.plan.knownSelection.factoryCodes);
  assert.equal(record.selectedAccessories[0].code, 'SE000001');
  assert.deepEqual(record.selectedAccessories[0].quantity, unknown('quantity-not-exposed'));
  assert.equal(source.confirmedContext.rawModelRange.value, 'G61'); assert.equal(source.requestScope.catalogueRangeKey, 'G61E');
  assert.equal(source.requestScope.requests[0].effectDate, '2026-11-01'); assert.equal(source.confirmedContext.effectDate.value, '2027-01-05');
  assert.deepEqual(source.optionalFacts.trim, unknown()); assert.deepEqual(source.optionalFacts.catalogueProductionDate, unknown());
  assert.equal(source.optionalFacts.modelYear.value, null); assert.equal(record.catalogue.observedDate, '2026-11-07');
  assert.equal(record.catalogue.retrievedDate, '2026-11-07');
  const locator = source.evidence.find((row) => row.id === 'tree').locators.find((row) => row.name === 'rawModelRange');
  assert.equal(locator.sourcePointer, '/5/modelRanges/G61E/models/T5MJ/modelRange');
  assert.equal(locator.retainedPointer, '/report/nodes/0/facts/modelRange');
  assert.deepEqual(record.solverChanges.ignored, []);
  assert.deepEqual(record.sourceEvidence.providerIgnored, { state: 'unknown', codes: null });
  assert.equal(record.catalogue.equipment.selected.accessoryQuantitiesComplete, false);
  assert.equal(record.catalogue.status, 'partial'); assert.equal(JSON.stringify(input.artifacts), before);
  record.resolvedOptions.length = 0; assert.equal(input.plan.knownSelection.factoryCodes.length, 47);
});

test('source qualifier rejects coherent selected factory deletion despite refreshed key binding digest and envelope fields', async () => {
  const input = await fixture(); const candidate = structuredClone(build(input).record);
  const remove = 'S0230'; candidate.resolvedOptions = candidate.resolvedOptions.filter((code) => code !== remove);
  candidate.selectedElements = candidate.selectedElements.filter((row) => row.code !== remove);
  const source = candidate.catalogue.sourceBinding;
  source.canonicalIdentity.factoryOptionCodes = candidate.resolvedOptions.slice();
  source.selection.factoryOptionCodes = candidate.resolvedOptions.slice();
  source.selection.elements = candidate.selectedElements.map(({ code, type }) => ({ code, type }));
  source.selection.solverChanges.added = source.selection.solverChanges.added.filter((code) => code !== remove);
  candidate.solverChanges = structuredClone(source.selection.solverChanges);
  candidate.catalogue.equipment.selected.options = candidate.resolvedOptions.slice(); rebindCandidate(candidate, input);
  const rejected = binding.qualifyBmwSelectionRecord(candidate, input);
  assert.deepEqual(rejected, { status: 'invalid', code: 'source-selection-mismatch', admission: false, record: null });
  assert.equal(binding.qualifyBmwSelectionRecord(build(input).record, input).status, 'qualified');
});

test('hashes retained bytes exact model requests and raw-to-retained locators are verified before source qualification', async () => {
  for (const mutate of [
    (input) => { input.artifacts.solver.bytes += ' '; },
    (input) => { input.artifacts.solver.artifactSha256 = 'f'.repeat(64); },
    (input) => { rewrite(input, 'solver', (doc) => { delete doc.report.configuration.elements.S0230; }); },
    (input) => { rewrite(input, 'tree', (doc) => { doc.locators[0].retainedPointer = '/report/nodes/0/facts/agModelCode'; }, true); },
    (input) => { rewrite(input, 'tree', (doc) => { doc.report.nodes[1].facts.effectDate = '2027-01-06'; }, true); },
    (input) => { rewrite(input, 'solver', (doc) => { doc.observation.request.url = doc.observation.request.url.replace('2027-01-05', '2027-01-06'); }, true); },
    (input) => { input.artifacts.solver.retrievedAt = null; },
  ]) { const input = await fixture(); mutate(input); assert.throws(() => build(input)); }
});

test('actual source map quantity locators retain exact code-specific raw pointers', async () => {
  const input = await fixture({ quantity: 2 }); const result = build(input); const source = result.record.catalogue.sourceBinding;
  assert.equal(source.selection.accessories[0].quantity.value, 2);
  assert.deepEqual(source.selection.accessories[0].quantity.evidenceRefs, [ref('solver', 'quantity-SE000001')]);
  assert.equal(result.record.catalogue.equipment.selected.accessoryQuantitiesComplete, true);
  const locator = source.evidence.find((row) => row.id === 'solver').locators.find((row) => row.name === 'quantity-SE000001');
  assert.equal(locator.sourcePointer, '/configuration/elements/SE000001/quantity');
  assert.equal(locator.retainedPointer, '/report/configuration/elements/SE000001/quantity');
  rewrite(input, 'solver', (doc) => { doc.locators.find((row) => row.name === 'quantity-SE000001').sourcePointer = '/configuration/elements/SE000002/quantity'; }, true);
  assert.throws(() => build(input));
});

test('collector explicitly replays the source binder without transport or implicit corpus admission', async (context) => {
  const input = await fixture(); let calls = 0;
  context.mock.method(globalThis, 'fetch', () => { calls += 1; throw new Error('no network'); });
  const replay = { artifacts: input.artifacts, producerPins: input.producerPins, snapshotVersion: input.snapshotVersion };
  const collector = await createFleetCollector({ plan: input.plan, mode: 'capture-replay', captureReplay: replay,
    policyService: new PolicyService({ provider: new FilePolicyProvider() }) });
  const result = await collector.run();
  assert.equal(result.status, 'complete'); assert.equal(result.admission, false); assert.deepEqual(result.accepted, []);
  assert.equal(result.records.length, 1); assert.equal(result.records[0].configurationId, build(input).record.configurationId);
  assert.equal(result.counts.sourceCalls, 0); assert.equal(calls, 0);
  assert.equal(result.coverage.distinctConfigurations, 1);
  await assert.rejects(createFleetCollector({ plan: { ...input.plan, captureVersion: undefined }, mode: 'capture-replay', captureReplay: replay,
    policyService: new PolicyService({ provider: new FilePolicyProvider() }) }));
});

function addDefinitionBinding(input) {
  const requestUrl = 'https://prod.ucp.bmw.cloud/localisations/overridden-vehicle-data/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/applications/connext/models/T5MJ/options/languages/en?trim=S0337';
  const definitions = [{ code: 'P0300', pointer: '/P0300', issues: [], option: 'P0300', optionType: 'paint', longDescription: 'Synthetic paint' },
    { code: 'FKSFU', pointer: '/FKSFU', issues: [], option: 'FKSFU', optionType: 'fabric', longDescription: 'Synthetic upholstery' }];
  const options = { schemaVersion: 'bmw-source-diagnostic-observation.v1', observation: { schemaVersion: 'collection-http-observation.v1', operation: 'options',
    sourceId: input.plan.source.id, sourceVersion: 'f59-diagnostic-20261106.v1', capability: 'bmw-options', transportKind: 'fixture',
    request: { method: 'GET', url: requestUrl }, observedAt: '2026-11-06T15:16:26.640Z', responseBytes: 138863,
    responseSha256: sha('synthetic definitions raw response') }, requestScope: { role: 'request-input-only' },
  report: { status: 'schema-review-required', candidates: [{ pointer: '', definitions }], structure: [], unknownFields: 0, admission: false } };
  const bytes = encode(options); const artifactSha256 = sha(bytes);
  const context = { modelCode: 'T5MJ', agModelCode: '72HH', orderDate: '2026-11-01', effectDate: '2027-01-05' };
  const fields = Object.fromEntries(['paint', 'upholstery'].map((field, index) => {
    const row = definitions[index]; const value = { code: row.code, type: field };
    return [field, { status: 'qualified', value, evidence: [{ artifactId: 'options', sha256: artifactSha256,
      pointer: `/report/candidates/0/definitions/${index}`, observedDate: '2026-11-06', context, confidence: 'direct-response',
      value, sourcePointer: row.pointer, contextArtifactId: 'tree' }], reasons: [] }];
  }));
  const fieldReport = { schemaVersion: 'bmw-field-evidence.v1', status: 'incomplete', qualification: 'field-evidence-only', admission: false,
    observedDate: '2026-11-06', fields, accepted: [], sourceBindings: { options: { artifactSha256, responseSha256: options.observation.responseSha256,
      observedAt: options.observation.observedAt, request: options.observation.request } } };
  const reportBytes = encode(fieldReport);
  input.definitionBinding = { options: { bytes, artifactSha256, retrievedAt: '2026-11-06T15:17:00.000Z' },
    fieldReport: { bytes: reportBytes, artifactSha256: sha(reportBytes) } };
  return input;
}

test('dated qualified paint and upholstery bind only to exact selected codes and matching fresh model context', async () => {
  const input = addDefinitionBinding(await fixture()); const result = build(input); const record = result.record;
  assert.deepEqual(record.paint.value, { code: 'P0300', type: 'paint' });
  assert.deepEqual(record.upholstery.value, { code: 'FKSFU', type: 'upholstery' });
  assert.deepEqual(record.catalogue.sourceBinding.optionalFacts.trim, unknown());
  const evidence = record.catalogue.sourceBinding.evidence.find((row) => row.id === 'definitions');
  assert.equal(evidence.observedAt, '2026-11-06T15:16:26.640Z');
  assert.equal(record.catalogue.observedDate, '2026-11-07');
  const next = addDefinitionBinding(await fixture());
  const report = JSON.parse(next.definitionBinding.fieldReport.bytes);
  report.fields.paint.evidence[0].context.orderDate = '2026-11-02';
  next.definitionBinding.fieldReport.bytes = encode(report); next.definitionBinding.fieldReport.artifactSha256 = sha(encode(report));
  assert.throws(() => build(next));
});

test('supporting definitions retain unknown retrieval time while primary solver retrieval remains required', async () => {
  const input = addDefinitionBinding(await fixture()); input.definitionBinding.options.retrievedAt = null;
  const result = build(input);
  assert.equal(result.record.catalogue.sourceBinding.evidence.find((row) => row.id === 'definitions').retrievedAt, null);
  input.artifacts.solver.retrievedAt = null; assert.throws(() => build(input));
});


test('supporting definitions must match primary solver transport provenance', async () => {
  const input = addDefinitionBinding(await fixture());
  for (const name of ['tree', 'solver']) rewrite(input, name, (doc) => { doc.observation.transportKind = 'live'; }, true);
  assert.throws(() => build(input), { code: 'invalid-selection-binding' });
});
