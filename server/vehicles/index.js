/** Immutable source facts and scenario-owned terms. No policy, I/O or lifecycle operations. */
const ASSURANCES = new Set(['unknown', 'confirmed-listing', 'confirmed-build', 'model-reference', 'derived', 'synthetic-scenario']);
const FACT_UNITS = { seats: 'count', doors: 'count', boot: 'L', zeroTo62: 's', mileage: 'mi',
  evRange: 'mi', mpg: 'mpg-imperial', cc: 'cm3', year: 'year', sizeClass: 'ordinal-1-5' };
const fail = (field) => { throw new TypeError(`Invalid ${field}`); };
const text = (value, field) => { if (typeof value !== 'string' || !value.trim()) fail(field); return value; };
const object = (value, field) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(field);
  return value;
};
const keys = (value, allowed, field) => {
  object(value, field);
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail(field);
};
const date = (value, field) => {
  text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(field);
  return value;
};
const amount = (value, field) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(field);
  return value;
};

/** Clone only JSON data: mutable class instances, functions and non-finite values are invalid facts. */
function data(value, field) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => data(item, field));
  object(value, field);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, data(item, field)]));
}

export function freezeVehicleData(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeVehicleData);
    Object.freeze(value);
  }
  return value;
}

function provenance(value) {
  keys(value, ['sourceRef', 'observedAt', 'version', 'assurance'], 'provenance');
  text(value.sourceRef, 'provenance.sourceRef');
  text(value.version, 'provenance.version');
  date(value.observedAt, 'provenance.observedAt');
  if (!ASSURANCES.has(value.assurance)) fail('provenance.assurance');
  return data(value, 'provenance');
}

function fact(value, name) {
  keys(value, ['status', 'value', 'unit', 'provenance'], `facts.${name}`);
  if (!['known', 'unknown'].includes(value.status)) fail(`facts.${name}.status`);
  const origin = provenance(value.provenance);
  if ((value.status === 'unknown') !== (value.value === null)
    || (value.status === 'unknown') !== (origin.assurance === 'unknown')) fail(`facts.${name}.assurance`);
  if (value.unit !== null) text(value.unit, `facts.${name}.unit`);
  if (typeof value.value === 'number' && !value.unit) fail(`facts.${name}.unit`);
  if (Object.hasOwn(FACT_UNITS, name) && value.unit !== FACT_UNITS[name]) fail(`facts.${name}.unit`);
  if (value.status === 'known' && Object.hasOwn(FACT_UNITS, name)) {
    amount(value.value, `facts.${name}.value`);
    if (['seats', 'doors', 'year', 'sizeClass'].includes(name) && !Number.isInteger(value.value)) fail(`facts.${name}.value`);
    if (name === 'sizeClass' && (value.value < 1 || value.value > 5)) fail('facts.sizeClass.value');
  }
  if (value.status === 'known' && ['frontIsofix', 'rearIsofix'].includes(name) && typeof value.value !== 'boolean') fail(`facts.${name}.value`);
  return { status: value.status, value: data(value.value, `facts.${name}.value`), unit: value.unit, provenance: origin };
}

/** Validated VehicleSnapshot v1; enrichment publishes a new version. See docs/design/vehicle-snapshot-contract.md. */
export function createVehicleSnapshot(input) {
  keys(input, ['contractVersion', 'candidateKey', 'sourceNamespace', 'identityKind', 'sourceKeys',
    'snapshotVersion', 'observedAt', 'vin', 'display', 'facts'], 'VehicleSnapshot');
  if (input.contractVersion !== undefined && input.contractVersion !== 'vehicle-snapshot-v1') fail('contractVersion');
  text(input.sourceNamespace, 'sourceNamespace');
  text(input.snapshotVersion, 'snapshotVersion');
  date(input.observedAt, 'observedAt');
  if (!['advert', 'exact-stock', 'vin', 'legacy-record'].includes(input.identityKind)) fail('identityKind');
  keys(input.sourceKeys, ['advertId', 'stockId', 'modelGroupId', 'recordId'], 'sourceKeys');
  for (const value of Object.values(input.sourceKeys)) {
    if (!(typeof value === 'string' && value.trim()) && !(typeof value === 'number' && Number.isSafeInteger(value))) fail('sourceKeys');
  }
  const sourceKey = input.identityKind === 'vin' ? input.vin
    : input.sourceKeys[{ advert: 'advertId', 'exact-stock': 'stockId', 'legacy-record': 'recordId' }[input.identityKind]];
  if (sourceKey === undefined) fail('sourceKeys candidate identity');
  const candidateKey = `${encodeURIComponent(input.sourceNamespace)}:${input.identityKind}:${encodeURIComponent(String(sourceKey))}`;
  if (input.candidateKey !== undefined && input.candidateKey !== candidateKey) fail('candidateKey');
  if (input.vin !== undefined && (typeof input.vin !== 'string' || !/^[A-HJ-NPR-Z0-9]{17}$/.test(input.vin))) fail('vin');
  keys(input.display, ['name', 'manufacturer', 'model', 'derivative', 'photo', 'images', 'link', 'colour'], 'display');
  text(input.display.name, 'display.name');
  object(input.facts, 'facts');
  const snapshot = { contractVersion: 'vehicle-snapshot-v1', candidateKey, sourceNamespace: input.sourceNamespace,
    identityKind: input.identityKind, sourceKeys: data(input.sourceKeys, 'sourceKeys'),
    snapshotVersion: input.snapshotVersion, observedAt: input.observedAt,
    ...(input.vin === undefined ? {} : { vin: input.vin }), display: data(input.display, 'display'),
    facts: Object.fromEntries(Object.entries(input.facts).map(([name, value]) => [name, fact(value, name)])) };
  return freezeVehicleData(snapshot);
}

export function createRetailTerms(input) {
  keys(input, ['purchasePrice', 'provenance'], 'RetailTerms');
  if (input.purchasePrice !== null) {
    keys(input.purchasePrice, ['amount', 'currency'], 'purchasePrice');
    amount(input.purchasePrice.amount, 'purchasePrice.amount');
    if (input.purchasePrice.currency !== 'GBP') fail('purchasePrice.currency');
  }
  return freezeVehicleData({ kind: 'retail-purchase', purchasePrice: data(input.purchasePrice, 'purchasePrice'),
    provenance: provenance(input.provenance) });
}

/** Terms are supplied by a quote/policy adapter, never calculated from retail prices or monthlyFrom text. */
export function createEmployeeTerms(input) {
  keys(input, ['kind', 'termsVersion', 'points', 'allowanceInputs', 'contribution', 'validFrom', 'validUntil', 'provenance'], 'EmployeeTerms');
  if (input.kind !== undefined && input.kind !== 'employee-scheme') fail('EmployeeTerms.kind');
  text(input.termsVersion, 'termsVersion');
  keys(input.points, ['value', 'unit'], 'points');
  amount(input.points.value, 'points.value');
  if (input.points.unit !== 'points') fail('points.unit');
  object(input.allowanceInputs, 'allowanceInputs');
  for (const value of Object.values(input.allowanceInputs)) {
    keys(value, ['value', 'unit'], 'allowanceInputs');
    amount(value.value, 'allowanceInputs.value');
    if (value.unit !== 'points') fail('allowanceInputs.unit');
  }
  if (input.contribution !== null) {
    keys(input.contribution, ['amount', 'currency', 'period'], 'contribution');
    amount(input.contribution.amount, 'contribution.amount');
    if (!/^[A-Z]{3}$/.test(input.contribution.currency)) fail('contribution.currency');
    if (!['month', 'year', 'one-off'].includes(input.contribution.period)) fail('contribution.period');
  }
  date(input.validFrom, 'validFrom');
  date(input.validUntil, 'validUntil');
  if (Date.parse(input.validUntil) <= Date.parse(input.validFrom)) fail('terms validity');
  const result = data(input, 'EmployeeTerms');
  result.provenance = provenance(input.provenance);
  return freezeVehicleData({ ...result, kind: 'employee-scheme' });
}

/** The application supplies authenticated employee context. This constructor is not an authorisation service. */
export function createEmployeeProjection(snapshot, input) {
  keys(input, ['employeeKey', 'policyVersion', 'evaluatedAt', 'terms', 'eligibility', 'scores', 'hold', 'offer'], 'EmployeeProjection');
  text(input.employeeKey, 'employeeKey');
  text(input.policyVersion, 'policyVersion');
  date(input.evaluatedAt, 'evaluatedAt');
  keys(input.eligibility, ['status', 'reasons'], 'eligibility');
  if (!['eligible', 'ineligible', 'needs-confirmation'].includes(input.eligibility.status)
    || !Array.isArray(input.eligibility.reasons)) fail('eligibility');
  const result = { employeeKey: input.employeeKey, policyVersion: input.policyVersion, evaluatedAt: input.evaluatedAt,
    snapshot: createVehicleSnapshot(snapshot), terms: createEmployeeTerms(input.terms), eligibility: data(input.eligibility, 'eligibility') };
  for (const field of ['scores', 'hold', 'offer']) {
    if (input[field] !== undefined) result[field] = data(input[field], field);
  }
  return freezeVehicleData(result);
}
