/** Synthetic protocol examples only. No source qualification, snapshot registration or admission. */
import { createHash } from 'node:crypto';
import { createConfigurationKey } from '../../../scripts/gcsp/configuration-key.mjs';
import { PolicyService, FilePolicyProvider } from '../../gcsp/policy/index.js';
import { inputDigest } from '../../gcsp/repository/core.js';

export const V2_OPTIONS = Object.freeze({
  provider: 'bmw-catalogue-snapshot', providerVersion: '2', schemaVersion: '2',
  sourceContractVersion: 'bmw-public-solver-selection.v1', snapshotVersion: 'synthetic-unadmitted.v2',
});
export const unknown = (reason = 'absent-evidence') => ({ state: 'unknown', value: null, reason, evidenceRefs: [] });
export const ref = (evidenceId, locatorName) => ({ evidenceId, locatorName });
export const known = (value, evidenceId, locatorName) => ({ state: 'known', value, reason: null,
  evidenceRefs: [ref(evidenceId, locatorName)] });
const sha = (value) => createHash('sha256').update(value).digest('hex');
const provenance = () => ({ kind: 'synthetic', source: 'Illustrative fixture', observedDate: null });
const factory = ['P0300', 'S0337', 'S0456', 'WFKSW'];
const request = (operation, url, modelCode, orderDate, effectDate, includedCodes = []) => ({
  operation, method: 'GET', url, modelCode, orderDate, effectDate,
  includedCodes, mandatoryCodes: [], excludedCodes: [], trimInput: null,
});
const locators = (names) => names.map((name) => ({ name, sourcePointer: `/${name}`, retainedPointer: `/${name}` }));
const evidence = (id, role, operation, url, body, names) => ({
  id, role, sourceId: 'synthetic-only', sourceVersion: 'synthetic.v1', operation,
  request: { method: 'GET', url }, responseSha256: sha(JSON.stringify(body)),
  retainedSha256: sha(JSON.stringify(body, null, 2)), observedAt: '2026-11-06T10:00:00.000Z',
  retrievedAt: '2026-11-06T10:00:01.000Z', locators: locators(names),
});

/** Recompute representation fields after a deliberate semantic mutation; never changes trusted pins. */
export function rebind(fixture) {
  const binding = fixture.envelope.sourceBinding;
  const key = fixture.trusted.configurationKey(binding.canonicalIdentity);
  const identity = { snapshotVersion: V2_OPTIONS.snapshotVersion, bindingDigest: inputDigest(binding),
    configurationId: key.configurationId };
  const lookupIdentity = { ...V2_OPTIONS, bindingDigest: identity.bindingDigest, configurationId: identity.configurationId };
  fixture.envelope.requestedIdentity = structuredClone(identity);
  fixture.envelope.resolvedIdentity = structuredClone(identity);
  fixture.envelope.lookupIdentity = structuredClone(lookupIdentity);
  fixture.envelope.resolvedLookupIdentity = structuredClone(lookupIdentity);
  return fixture;
}

export async function syntheticV2({ quantity = null, accessoryCode = 'SE000001' } = {}) {
  const configurationKey = await createConfigurationKey({
    policyService: new PolicyService({ provider: new FilePolicyProvider() }),
    policyRead: { runId: 'synthetic-v2-contract', asOf: '2026-11-06T10:00:00.000Z', policyVersion: 'gcsp-policy-v1' },
  });
  const treeUrl = 'https://synthetic.invalid/tree?modelCode=T5MJ&effectDate=2027-01-01';
  const solveUrl = 'https://synthetic.invalid/solve?modelCode=T5MJ&orderDate=2026-11-06&effectDate=2027-02-01';
  const elements = [...factory.map((code) => ({ code, type: 'option' })), { code: accessoryCode, type: 'accessory' }]
    .sort((a, b) => a.code.localeCompare(b.code));
  const treeBody = { modelCode: 'T5MJ', agModelCode: '72HH', rawModelRange: 'G61',
    orderDate: '2026-11-06', effectDate: '2027-02-01' };
  const solverBody = { modelCode: 'T5MJ', constructible: true, elements: elements.map((element) =>
    element.type === 'accessory' && quantity !== null ? { ...element, quantity } : { ...element }) };
  const requestScope = { market: 'GB', locale: 'en-GB', catalogueRangeKey: 'synthetic-range', requests: [
    request('discover', treeUrl, 'T5MJ', null, '2027-01-01'),
    request('solve', solveUrl, 'T5MJ', '2026-11-06', '2027-02-01', [...factory]),
  ] };
  const confirmedContext = {
    modelCode: known('T5MJ', 'tree', 'modelCode'), agModelCode: known('72HH', 'tree', 'agModelCode'),
    rawModelRange: known('G61', 'tree', 'rawModelRange'), orderDate: known('2026-11-06', 'tree', 'orderDate'),
    effectDate: known('2027-02-01', 'tree', 'effectDate'), taxDate: unknown(), steeringLiteral: unknown(),
  };
  const evidenceRecords = [
    evidence('solver', 'solver', 'solve', solveUrl, solverBody, ['modelCode', 'constructible', 'elements']),
    evidence('tree', 'model-tree', 'discover', treeUrl, treeBody, Object.keys(treeBody)),
  ];
  if (quantity !== null) evidenceRecords[0].locators.push({ name: 'quantity',
    sourcePointer: `/elements/${elements.findIndex(({ code }) => code === accessoryCode)}/quantity`,
    retainedPointer: `/elements/${elements.findIndex(({ code }) => code === accessoryCode)}/quantity` });
  const producerPins = { projectorSha256: sha('synthetic-projector'), qualifierSha256: sha('synthetic-qualifier'),
    sessionSha256: sha('synthetic-session'), policyVersion: configurationKey.policyVersion };
  const sourceBinding = { requestScope, confirmedContext,
    canonicalIdentity: { vgModelCode: 'T5MJ', agModelCode: '72HH', factoryOptionCodes: [...factory] },
    selection: { constructible: true, factoryComplete: true, accessoryCodesComplete: true, elements,
      factoryOptionCodes: [...factory], accessories: [{ code: accessoryCode, type: 'accessory',
        quantity: quantity === null ? unknown('quantity-not-exposed') : known(quantity, 'solver', 'quantity') }],
      evidenceRefs: [ref('solver', 'constructible'), ref('solver', 'elements'), ref('solver', 'modelCode')],
      solverChanges: { added: [accessoryCode], removed: [], ignored: [] } },
    optionalFacts: { trim: unknown(), catalogueProductionDate: unknown(), modelName: unknown(), fuelTypeCode: unknown(),
      physicalProductionDate: unknown('unsupported-physical-evidence'), modelYear: unknown('unsupported-physical-evidence'),
      plant: unknown('unsupported-physical-evidence'), verifiedFitted: unknown('unsupported-physical-evidence') },
    evidence: evidenceRecords, producerPins,
  };
  const definitions = { seats: ['SEATS', 'COUNT'], luggageNormal: ['NORMAL', 'LITRES'],
    luggageExpanded: ['EXPANDED', 'LITRES'], acceleration: ['0–100 KM/H', 'SECONDS'], bodyLength: ['BODY LENGTH', 'MILLIMETRES'] };
  const facts = Object.fromEntries(Object.entries(definitions).map(([name, [definition, unit]]) => [name, {
    state: 'unknown', value: null, definition, unit, reason: 'no-resolved-evidence', completeness: 'unknown',
    provenance: { kind: 'unknown', source: null, observedDate: null },
  }]));
  const envelope = { ...V2_OPTIONS, sourceKind: 'dated-snapshot', status: 'partial',
    observedDate: '2026-11-06', retrievedDate: '2026-11-06', requestedIdentity: null, resolvedIdentity: null,
    lookupIdentity: null, resolvedLookupIdentity: null, identityProvenance: provenance(), sourceBinding, facts,
    equipment: { definitions: [], available: { state: 'unknown', codes: [], complete: false,
      completeness: 'unknown', provenance: { kind: 'unknown', source: null, observedDate: null } },
      selected: { state: 'known', options: [...factory], accessories: structuredClone(sourceBinding.selection.accessories),
        factoryComplete: true, accessoryCodesComplete: true, accessoryQuantitiesComplete: quantity !== null, provenance: provenance() },
      verifiedFitted: { state: 'unknown', codes: [], reason: 'provider-does-not-verify-fitting',
        provenance: { kind: 'unknown', source: null, observedDate: null } } },
    completeness: { factorySelection: 'complete', accessoryCodes: 'complete', accessoryQuantities: quantity === null ? 'unknown' : 'complete',
      measurements: 'unknown', definitions: 'unknown', availability: 'unknown', verifiedFitted: 'unknown' }, failure: null };
  return rebind({ synthetic: true, admission: false, accepted: [], envelope,
    trusted: { configurationKey, producerPins: structuredClone(producerPins), evidencePins: structuredClone(evidenceRecords),
      requestScope: structuredClone(requestScope), confirmedContext: structuredClone(confirmedContext) } });
}
