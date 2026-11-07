import { createHash } from 'node:crypto';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { bmwCatalogueLookupIdentity, validateBmwCatalogueV2Envelope } from '../../server/vehicle-evidence/bmw-catalogue-adapter.js';
import { CollectionError, requireValue } from './configuration-key.mjs';
import { publicBmwOperations, strictModelReport, validatePublicBmwPlan } from './public-bmw-source.mjs';

export const BMW_SELECTION_BINDING_VERSION = 'bmw-selection-binding.v1';
const CAPTURE = 'bmw-complete-selection.v1';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sha = (v) => createHash('sha256').update(v).digest('hex');
const encode = (v) => JSON.stringify(v) + '\n';
const same = (a, b) => inputDigest(a) === inputDigest(b);
const fail = (condition) => requireValue(condition, 'invalid-selection-binding', 'Use the registered complete capture bytes, exact context and qualified locators.');
const keys = (v, fields) => object(v) && Object.keys(v).length === fields.length && fields.every((field) => Object.hasOwn(v, field));
const code = (v) => typeof v === 'string' && /^[A-Z0-9]{4,12}$/.test(v);
const instant = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const unknown = (reason = 'absent-evidence') => ({ state: 'unknown', value: null, reason, evidenceRefs: [] });
const ref = (evidenceId, locatorName) => ({ evidenceId, locatorName });
const known = (value, evidenceId, locatorName) => ({ state: 'known', value, reason: null, evidenceRefs: [ref(evidenceId, locatorName)] });
const unknownOrigin = () => ({ kind: 'unknown', source: null, observedDate: null });

// Registration is a server-owned input, never taken from a lookup/candidate. Hashes
// bind the actual exported bytes; canonical export encoding also refuses duplicate keys.
function readArtifact(entry, timestamp = true) {
  fail(object(entry) && (typeof entry.bytes === 'string' || entry.bytes instanceof Uint8Array)
    && typeof entry.artifactSha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.artifactSha256));
  const bytes = Buffer.from(entry.bytes); fail(bytes.length > 0 && bytes.length <= 1024 * 1024 && sha(bytes) === entry.artifactSha256);
  let document;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new CollectionError('invalid-selection-binding', 'The registered source artifact is not bounded JSON.'); }
  fail(object(document) && Buffer.from(encode(document)).equals(bytes));
  if (timestamp || entry.retrievedAt !== undefined && entry.retrievedAt !== null) {
    fail(instant(entry.retrievedAt) && instant(document.observation?.observedAt) && entry.retrievedAt >= document.observation.observedAt);
  }
  return { document, artifactSha256: entry.artifactSha256, retrievedAt: entry.retrievedAt ?? null };
}
function locate(value, pointer) {
  fail(typeof pointer === 'string' && pointer.startsWith('/') && pointer.length <= 1024 && !/~(?:[^01]|$)/.test(pointer));
  for (const key of pointer.slice(1).split('/').map((v) => v.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    fail((object(value) || Array.isArray(value)) && Object.hasOwn(value, key)); value = value[key];
  }
  return value;
}
function urlScope(request, operation) {
  fail(keys(request, ['method', 'url']) && request.method === 'GET' && typeof request.url === 'string');
  let url; try { url = new URL(request.url); } catch { fail(false); }
  fail(url.origin === 'https://prod.ucp.bmw.cloud' && !url.username && !url.password && !url.hash
    && url.pathname.startsWith(operation === 'discover' ? '/model-matrices/vehicle-trees/' : '/rulesolver/constructibility-check/')
    && url.pathname.includes('/countries/gb/') && [...url.searchParams.keys()].every((key) => !/key|secret|token|password/i.test(key)));
  const segment = (name) => {
    const parts = url.pathname.split('/'); const indices = parts.flatMap((value, index) => value === name ? [index] : []);
    fail(indices.length <= 1); return indices.length ? parts[indices[0] + 1] : null;
  };
  const set = (name) => {
    fail(url.searchParams.getAll(name).length <= 1);
    const value = url.searchParams.get(name); const result = value === null ? [] : value.split(',').sort();
    fail(result.every(code) && new Set(result).size === result.length); return result;
  };
  return { operation, method: 'GET', url: request.url, modelCode: segment('models'), orderDate: segment('order-dates'),
    effectDate: segment('effect-dates'), includedCodes: set('included-elements'), mandatoryCodes: set('mandatory-elements'),
    excludedCodes: set('excluded-elements'), trimInput: url.searchParams.get('trim'), catalogueRangeKey: url.searchParams.get('model-ranges') };
}
function captureArtifact(entry, plan, operation) {
  const artifact = readArtifact(entry); const document = artifact.document; const observation = document.observation;
  fail(keys(document, ['schemaVersion', 'observation', 'requestSha256', 'rawSelectionSha256', 'locators', 'report'])
    && document.schemaVersion === CAPTURE && keys(observation, ['schemaVersion', 'operation', 'sourceId', 'sourceVersion', 'capability',
      'transportKind', 'request', 'observedAt', 'responseBytes', 'responseSha256'])
    && observation.schemaVersion === 'collection-http-observation.v1' && observation.operation === operation
    && observation.sourceId === plan.source.id && observation.sourceVersion === plan.source.version
    && observation.capability === (operation === 'discover' ? 'bmw-model-tree' : 'bmw-solver')
    && ['live', 'fixture'].includes(observation.transportKind) && observation.observedAt.slice(0, 10) === plan.qualificationDate
    && Number.isSafeInteger(observation.responseBytes) && observation.responseBytes > 0 && observation.responseBytes <= plan.limits.responseBytes
    && typeof observation.responseSha256 === 'string' && /^[a-f0-9]{64}$/.test(observation.responseSha256)
    && document.requestSha256 === sha(encode(observation.request)) && document.rawSelectionSha256 === sha(encode(document.report))
    && Array.isArray(document.locators) && document.locators.length <= 512);
  const names = new Set();
  for (const locator of document.locators) {
    fail(keys(locator, ['name', 'sourcePointer', 'retainedPointer']) && typeof locator.name === 'string'
      && locator.name.length <= 96 && !names.has(locator.name)); names.add(locator.name);
    locate(document, locator.retainedPointer);
  }
  return { ...artifact, scope: urlScope(observation.request, operation) };
}
function evidence(artifact, id, role, locators) {
  const observed = artifact.document.observation;
  return { id, role, sourceId: observed.sourceId, sourceVersion: observed.sourceVersion, operation: observed.operation,
    request: structuredClone(observed.request), responseSha256: observed.responseSha256, retainedSha256: artifact.artifactSha256,
    observedAt: observed.observedAt, retrievedAt: artifact.retrievedAt, locators };
}
function treeFacts(tree) {
  const report = tree.document.report;
  fail(Array.isArray(report?.nodes) && report.nodes.length === 2);
  const raw = Object.fromEntries(['5', 'I'].map((group, index) => {
    const node = report.nodes[index]; fail(node.pointer === `/${group}/modelRanges/G61E/models/T5MJ` && object(node.facts));
    return [group, { modelRanges: { G61E: { models: { T5MJ: structuredClone(node.facts) } } } }];
  }));
  // Reuse the original projector's exact alias/model/type checks without a new source path.
  fail(same(strictModelReport(raw), report));
  const expected = report.nodes.flatMap((node, index) => Object.entries(node.fieldPointers).map(([field, sourcePointer]) =>
    ({ name: `${index}-${field}`, sourcePointer, retainedPointer: `/report/nodes/${index}/facts/${field}` })));
  fail(same(tree.document.locators, expected));
  const rename = { modelRange: 'rawModelRange', steering: 'steeringLiteral', prodDate: 'catalogueProductionDate', modelNameRaw: 'modelName' };
  const first = report.nodes[0]; const fields = ['modelCode', 'agModelCode', 'modelRange', 'orderDate', 'effectDate', 'taxDate', 'steering', 'trim', 'prodDate', 'modelName', 'fuelTypeCode'];
  if (!Object.hasOwn(first.facts, 'modelName')) fields.push('modelNameRaw');
  const locators = fields.filter((name) => Object.hasOwn(first.facts, name)).map((name) => ({ name: rename[name] || name,
    sourcePointer: first.fieldPointers[name], retainedPointer: `/report/nodes/0/facts/${name}` }));
  return { facts: first.facts, locators };
}
function solverSelection(solver, plan) {
  const report = solver.document.report;
  fail(keys(report, ['constructible', 'configuration', 'configurationChanges', 'derivedChanges', 'accessories'])
    && report.constructible === true && keys(report.configuration, ['modelCode', 'elements']) && object(report.configuration.elements));
  const elements = report.configuration.elements;
  const selected = Object.keys(elements).sort(); fail(selected.length <= 320);
  for (const name of selected) {
    const row = elements[name]; fail(code(name) && object(row) && row.code === name && ['option', 'accessory'].includes(row.type)
      && Object.keys(row).every((key) => ['code', 'type', 'quantity'].includes(key))
      && (!Object.hasOwn(row, 'quantity') || row.type === 'accessory' && Number.isSafeInteger(row.quantity) && row.quantity > 0 && row.quantity <= 999));
  }
  const projection = publicBmwOperations(plan).solve.project({ constructible: report.constructible, configuration: report.configuration });
  const input = [...new Set([...solver.scope.includedCodes, ...solver.scope.mandatoryCodes])].sort();
  const added = selected.filter((name) => !input.includes(name)); const missing = input.filter((name) => !selected.includes(name));
  const changes = report.configurationChanges;
  fail(keys(changes, ['state', 'maps']) && ['present', 'absent'].includes(changes.state)
    && (changes.state === 'absent' ? changes.maps === null : object(changes.maps)));
  for (const [name, rows] of Object.entries(changes.maps || {})) {
    fail(['addedElements', 'removedElements', 'ignoredElements'].includes(name) && object(rows));
    const names = Object.keys(rows).sort(); fail(names.every((item) => code(item) && (name === 'addedElements' ? added.includes(item) : missing.includes(item))));
    if (name === 'addedElements') fail(same(names, added) && names.every((item) => same(rows[item], elements[item])));
    else fail(names.every((item) => keys(rows[item], ['code', 'type']) && rows[item].code === item && rows[item].type === 'option'));
  }
  const ignoredKnown = object(changes.maps) && Object.hasOwn(changes.maps, 'ignoredElements');
  const providerIgnored = ignoredKnown ? { state: 'known', codes: Object.keys(changes.maps.ignoredElements).sort() } : { state: 'unknown', codes: null };
  // With no missing request codes [] is the derived empty ignored set, never a response echo.
  fail(ignoredKnown || missing.length === 0);
  const ignored = ignoredKnown ? providerIgnored.codes : [];
  const removed = missing.filter((name) => !ignored.includes(name));
  if (changes.maps?.removedElements) fail(same(Object.keys(changes.maps.removedElements).sort(), removed));
  fail(same(report.derivedChanges, { basis: 'request-resolved-set-difference', added, removed: missing, ignored: providerIgnored }));
  fail(!solver.scope.excludedCodes.some((name) => selected.includes(name)));
  const locators = ['constructible', 'configuration/modelCode', 'configuration/elements'].map((pointer) =>
    ({ name: pointer.split('/').at(-1), sourcePointer: '/' + pointer, retainedPointer: '/report/' + pointer }));
  if (changes.state === 'present') locators.push({ name: 'configurationChanges', sourcePointer: '/configurationChanges', retainedPointer: '/report/configurationChanges/maps' });
  const accessories = selected.filter((name) => elements[name].type === 'accessory').map((name) => {
    if (Object.hasOwn(elements[name], 'quantity')) locators.push({ name: `quantity-${name}`, sourcePointer: `/configuration/elements/${name}/quantity`,
      retainedPointer: `/report/configuration/elements/${name}/quantity` });
    return { code: name, type: 'accessory', quantity: Object.hasOwn(elements[name], 'quantity')
      ? known(elements[name].quantity, 'solver', `quantity-${name}`) : unknown('quantity-not-exposed') };
  });
  fail(same(solver.document.locators, locators));
  fail(same(report.accessories, accessories.map(({ code, type, quantity }) => ({ code, type,
    quantity: { state: quantity.state, value: quantity.value, reason: quantity.reason } }))));
  return { constructible: true, factoryComplete: true, accessoryCodesComplete: true,
    elements: selected.map((name) => ({ code: name, type: elements[name].type })), factoryOptionCodes: projection.selectedOptions,
    accessories, evidenceRefs: ['constructible', 'elements', 'modelCode'].map((name) => ref('solver', name)),
    solverChanges: { added, removed, ignored }, providerIgnored };
}
function definitionClaims(binding, facts, selectedOptions, transportKind) {
  if (binding === undefined) return { paint: unknown(), upholstery: unknown(), evidence: null, pins: null };
  fail(object(binding)); const options = readArtifact(binding.options, false); const report = readArtifact(binding.fieldReport, false);
  const document = options.document; const qualified = report.document;
  fail(document.schemaVersion === 'bmw-source-diagnostic-observation.v1' && document.observation?.operation === 'options'
    && ['live', 'fixture'].includes(document.observation.transportKind) && document.observation.transportKind === transportKind
    && document.observation.sourceId === 'bmw-uk-public'
    && document.observation.sourceVersion === 'f59-diagnostic-20261106.v1' && document.requestScope?.role === 'request-input-only'
    && document.report?.admission === false && document.report.candidates?.length === 1
    && qualified.schemaVersion === 'bmw-field-evidence.v1' && qualified.admission === false && qualified.accepted?.length === 0
    && qualified.sourceBindings?.options?.artifactSha256 === options.artifactSha256
    && qualified.sourceBindings.options.responseSha256 === document.observation.responseSha256
    && qualified.sourceBindings.options.observedAt === document.observation.observedAt
    && same(qualified.sourceBindings.options.request, document.observation.request)
    && qualified.observedDate === document.observation.observedAt.slice(0, 10));
  const url = new URL(document.observation.request.url);
  fail(url.origin === 'https://prod.ucp.bmw.cloud' && url.pathname.endsWith(`/models/${facts.modelCode}/options/languages/en`)
    && url.pathname.includes(`/effect-dates/${facts.effectDate}/order-dates/${facts.orderDate}/`) && !url.username && !url.password && !url.hash);
  const locators = []; const result = {};
  for (const field of ['paint', 'upholstery']) {
    const entry = qualified.fields?.[field]; fail(entry?.status === 'qualified' && entry.evidence?.length > 0
      && keys(entry.value, ['code', 'type']) && entry.value.type === field && selectedOptions.includes(entry.value.code));
    for (const item of entry.evidence) {
      fail(item.artifactId === 'options' && item.sha256 === options.artifactSha256 && item.observedDate === qualified.observedDate
        && item.confidence === 'direct-response' && same(item.value, entry.value)
        && ['modelCode', 'agModelCode', 'orderDate', 'effectDate'].every((name) => item.context?.[name] === facts[name])
        && /^\/report\/candidates\/0\/definitions\/(?:0|[1-9]\d*)$/.test(item.pointer));
      const definition = locate(document, item.pointer);
      fail(definition.code === entry.value.code && definition.option === entry.value.code && definition.optionType === (field === 'paint' ? 'paint' : 'fabric')
        && Array.isArray(definition.issues) && definition.issues.length === 0 && definition.pointer === '/' + entry.value.code
        && item.sourcePointer === definition.pointer);
    }
    const item = entry.evidence[0]; const name = `${field}-${entry.value.code}`;
    locators.push({ name, sourcePointer: item.sourcePointer, retainedPointer: item.pointer }); result[field] = known(entry.value, 'definitions', name);
  }
  return { ...result, evidence: evidence(options, 'definitions', 'definitions', locators), pins: { options: options.artifactSha256, fieldReport: report.artifactSha256 } };
}

/** Bind a server-registered capture to actual source values; this function performs no I/O. */
export function buildBmwSelectionBinding(input = {}) {
  const { plan, configurationKey, producerPins, snapshotVersion, artifacts, definitionBinding } = input;
  fail(object(plan) && plan.captureVersion === CAPTURE && typeof configurationKey === 'function' && object(artifacts)); validatePublicBmwPlan(plan);
  const tree = captureArtifact(artifacts.tree, plan, 'discover'); const solver = captureArtifact(artifacts.solver, plan, 'solve');
  const { facts, locators: treeLocators } = treeFacts(tree);
  fail(tree.document.observation.transportKind === solver.document.observation.transportKind
    && tree.document.observation.observedAt <= solver.document.observation.observedAt
    && facts.modelCode === plan.models[0] && facts.orderDate === plan.context.orderDate && facts.effectDate === plan.context.effectDate
    && solver.scope.modelCode === facts.modelCode && solver.scope.orderDate === facts.orderDate && solver.scope.effectDate === facts.effectDate
    && tree.scope.orderDate === facts.orderDate && tree.scope.effectDate === plan.context.catalogueDate && tree.scope.catalogueRangeKey === 'G61E');
  const requestScope = { market: plan.context.market, locale: plan.context.locale, catalogueRangeKey: tree.scope.catalogueRangeKey,
    requests: [tree.scope, solver.scope].map(({ catalogueRangeKey, ...scope }) => ({ ...scope, modelCode: facts.modelCode })) };
  const contextFields = { modelCode: 'modelCode', agModelCode: 'agModelCode', rawModelRange: 'modelRange', orderDate: 'orderDate', effectDate: 'effectDate', taxDate: 'taxDate', steeringLiteral: 'steering' };
  const confirmedContext = Object.fromEntries(Object.entries(contextFields).map(([name, source]) =>
    [name, Object.hasOwn(facts, source) ? known(facts[source], 'tree', name) : unknown()]));
  const { providerIgnored, ...selection } = solverSelection(solver, plan);
  const canonicalIdentity = { vgModelCode: facts.modelCode, agModelCode: facts.agModelCode, factoryOptionCodes: [...selection.factoryOptionCodes] };
  const definitions = definitionClaims(definitionBinding, facts, selection.factoryOptionCodes, solver.document.observation.transportKind);
  const optionalFacts = Object.fromEntries(['trim', 'catalogueProductionDate', 'modelName', 'fuelTypeCode'].map((name) => {
    const source = name === 'catalogueProductionDate' ? 'prodDate' : name === 'modelName' && !Object.hasOwn(facts, name) ? 'modelNameRaw' : name;
    let value = facts[source]; if (source === 'prodDate' && value !== undefined) value = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
    return [name, value === undefined ? unknown() : known(value, 'tree', name)];
  }));
  Object.assign(optionalFacts, Object.fromEntries(['physicalProductionDate', 'modelYear', 'plant', 'verifiedFitted'].map((name) => [name, unknown('unsupported-physical-evidence')])));
  const sourceBinding = { requestScope, confirmedContext, canonicalIdentity, selection, optionalFacts,
    evidence: [evidence(tree, 'tree', 'model-tree', treeLocators), evidence(solver, 'solver', 'solver', structuredClone(solver.document.locators)),
      ...(definitions.evidence ? [definitions.evidence] : [])].sort((a, b) => a.id.localeCompare(b.id)), producerPins: structuredClone(producerPins) };
  const identityKey = configurationKey(canonicalIdentity);
  const options = { provider: 'bmw-catalogue-snapshot', providerVersion: '2', schemaVersion: '2',
    sourceContractVersion: 'bmw-public-solver-selection.v1', snapshotVersion };
  const lookupIdentity = bmwCatalogueLookupIdentity({ configurationId: identityKey.configurationId, bindingDigest: inputDigest(sourceBinding) }, options); fail(lookupIdentity);
  const identity = { snapshotVersion, bindingDigest: lookupIdentity.bindingDigest, configurationId: lookupIdentity.configurationId };
  const observedDate = solver.document.observation.observedAt.slice(0, 10);
  const origin = solver.document.observation.transportKind === 'live' ? { kind: 'observed', source: 'BMW UK catalogue', observedDate }
    : { kind: 'synthetic', source: 'Illustrative fixture', observedDate: null };
  const measurements = { seats: ['SEATS', 'COUNT'], luggageNormal: ['NORMAL', 'LITRES'], luggageExpanded: ['EXPANDED', 'LITRES'], acceleration: ['0–100 KM/H', 'SECONDS'], bodyLength: ['BODY LENGTH', 'MILLIMETRES'] };
  const quantitiesComplete = selection.accessories.every((row) => row.quantity.state === 'known');
  const envelope = { ...options, sourceKind: 'dated-snapshot', status: 'partial', observedDate, retrievedDate: solver.retrievedAt.slice(0, 10),
    requestedIdentity: structuredClone(identity), resolvedIdentity: structuredClone(identity), lookupIdentity, resolvedLookupIdentity: structuredClone(lookupIdentity),
    identityProvenance: origin, sourceBinding,
    facts: Object.fromEntries(Object.entries(measurements).map(([name, [definition, unit]]) => [name, { state: 'unknown', value: null, definition, unit,
      reason: 'no-resolved-evidence', completeness: 'unknown', provenance: unknownOrigin() }])),
    equipment: { definitions: [], available: { state: 'unknown', codes: [], complete: false, completeness: 'unknown', provenance: unknownOrigin() },
      selected: { state: 'known', options: [...selection.factoryOptionCodes], accessories: structuredClone(selection.accessories), factoryComplete: true,
        accessoryCodesComplete: true, accessoryQuantitiesComplete: quantitiesComplete, provenance: structuredClone(origin) },
      verifiedFitted: { state: 'unknown', codes: [], reason: 'provider-does-not-verify-fitting', provenance: unknownOrigin() } },
    completeness: { factorySelection: 'complete', accessoryCodes: 'complete', accessoryQuantities: quantitiesComplete ? 'complete' : 'unknown',
      measurements: 'unknown', definitions: 'unknown', availability: 'unknown', verifiedFitted: 'unknown' }, failure: null };
  const validated = validateBmwCatalogueV2Envelope(encode(envelope), { configurationKey, producerPins, evidencePins: sourceBinding.evidence, requestScope, confirmedContext });
  fail(validated.status === 'valid');
  const record = { configurationId: identityKey.configurationId, canonicalSignature: identityKey.decodedIdentity, canonicalIdentity: identityKey.canonicalIdentity,
    modelRange: facts.modelRange, resolvedOptions: [...selection.factoryOptionCodes], selectedAccessories: structuredClone(selection.accessories),
    selectedElements: structuredClone(selection.elements), solverChanges: structuredClone(selection.solverChanges), catalogueRequest: identity,
    lookupIdentity: structuredClone(lookupIdentity), catalogue: validated.envelope, source: structuredClone(plan.source),
    sourceKind: solver.document.observation.transportKind === 'live' ? 'dated-snapshot' : 'synthetic-capture-fixture',
    paint: definitions.paint, upholstery: definitions.upholstery, sourceEvidence: { bindingVersion: BMW_SELECTION_BINDING_VERSION,
      planDigest: inputDigest(plan), tree: tree.artifactSha256, solver: solver.artifactSha256,
      definitionPins: definitions.pins, providerIgnored, changesBasis: 'request-resolved-set-difference' }, admission: false };
  return { status: 'qualified', admission: false, record: structuredClone(record) };
}

/** Candidate authority never comes from its own digest: compare with the registered source bytes. */
export function qualifyBmwSelectionRecord(candidate, registration) {
  try {
    const expected = buildBmwSelectionBinding(registration);
    if (same(candidate, expected.record)) return expected;
  } catch { /* A bounded refusal also covers unreadable or incompatible registered evidence. */ }
  return { status: 'invalid', code: 'source-selection-mismatch', admission: false, record: null };
}
