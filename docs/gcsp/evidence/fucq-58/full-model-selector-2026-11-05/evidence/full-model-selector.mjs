// Select observed literals only. A model-tree record cannot qualify a VIN profile or build.
const contractFields = ['modelCode', 'agModelCode', 'catalogueRangeKey', 'modelRangeField', 'orderDate', 'effectDate', 'steeringLiteral', 'groups'];
const factFields = new Set(['modelCode', 'agModelCode', 'modelRange', 'rawModelRange', 'steering', 'country', 'countryCode', 'market', 'locale', 'language', 'orderDate', 'effectDate', 'catalogueDate', 'taxDate', 'prodDate']);
const requiredFacts = ['modelCode', 'agModelCode', 'modelRange', 'orderDate', 'effectDate', 'steering'];
const samePath = (a, b) => Array.isArray(a) && a.length === b.length && a.every((part, index) => part === b[index]);
const canonical = facts => JSON.stringify(Object.fromEntries(Object.entries(facts).sort(([a], [b]) => a.localeCompare(b))));

function canonicalDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

export function selectFullModelRecord(projection, expected) {
  if (!expected || typeof expected !== 'object' || Object.keys(expected).length !== contractFields.length || contractFields.some(field => !Object.hasOwn(expected, field))) throw Error('selector-contract');
  if (['modelCode', 'agModelCode', 'catalogueRangeKey', 'modelRangeField'].some(field => typeof expected[field] !== 'string' || !/^[A-Z0-9]{2,8}$/.test(expected[field])) || !canonicalDate(expected.orderDate) || !canonicalDate(expected.effectDate) || !/^[A-Z]{2,3}$/.test(expected.steeringLiteral || '') || !samePath(expected.groups, ['5', 'I'])) throw Error('selector-contract');
  if (!projection || projection.version !== 'fleet-model-context-projection.v1' || !Array.isArray(projection.nodes)) throw Error('selector-projection');
  if (projection.nodes.length > 1024) throw Error('selector-projection-limit');
  if (projection.target?.modelCode !== expected.modelCode || projection.target?.agModelCode !== expected.agModelCode) throw Error('selector-projection-target');
  for (const node of projection.nodes) {
    if (!node || !Array.isArray(node.path) || node.path.length > 24 || node.path.some(part => typeof part !== 'string') || !node.facts || typeof node.facts !== 'object' || Array.isArray(node.facts)) throw Error('selector-projection');
  }
  const records = [];
  for (const group of expected.groups) {
    const path = [group, 'modelRanges', expected.catalogueRangeKey, 'models', expected.modelCode];
    const candidates = projection.nodes.filter(node => samePath(node.path, path));
    if (!candidates.length) throw Error('selector-full-record-missing');
    if (candidates.length !== 1) throw Error('selector-full-record-ambiguous');
    const record = candidates[0];
    const facts = record.facts;
    if (Object.keys(facts).some(field => !factFields.has(field))) throw Error('selector-fact-field');
    if (requiredFacts.some(field => !Object.hasOwn(facts, field))) throw Error('selector-required-fact-missing');
    if (facts.modelCode !== expected.modelCode || facts.agModelCode !== expected.agModelCode) throw Error('selector-identity-mismatch');
    if (facts.modelRange !== expected.modelRangeField) throw Error('selector-range-mismatch');
    if (facts.orderDate !== expected.orderDate || facts.effectDate !== expected.effectDate || facts.steering !== expected.steeringLiteral) throw Error('selector-context-mismatch');
    for (const [field, value] of Object.entries(facts)) {
      if (typeof value !== 'string' || (/Date$/.test(field) ? !canonicalDate(value) : field === 'locale' ? !/^[a-z]{2}[-_][A-Z]{2}$/.test(value) : !/^[A-Za-z0-9]{2,8}$/.test(value))) throw Error('selector-fact-value');
    }
    if (!samePath(record.parentPath, path.slice(0, -1))) throw Error('selector-parent-relation');
    records.push(record);
  }
  if (canonical(records[0].facts) !== canonical(records[1].facts)) throw Error('selector-duplicate-context-mismatch');
  return {
    version: 'fleet-full-model-selection.v1',
    selection: { modelCode: expected.modelCode, agModelCode: expected.agModelCode, catalogueRangeKey: expected.catalogueRangeKey, modelRangeField: expected.modelRangeField, orderDate: expected.orderDate, effectDate: expected.effectDate, steeringLiteral: expected.steeringLiteral },
    evidencePaths: records.map(record => record.path.slice()),
    aliasAppearances: records.length,
    distinctSelectedModels: 1,
    qualification: { constructibility: 'not-established', vinProfile: 'unqualified', additionalConfigurations: 0 },
  };
}
