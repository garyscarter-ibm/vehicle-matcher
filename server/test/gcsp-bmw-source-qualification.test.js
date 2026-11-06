import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const context = { modelCode: 'T5MJ', agModelCode: '72HH', orderDate: '2026-11-01', effectDate: '2027-01-05' };
const target = { observedDate: '2026-11-06', context };
const source = (changes = {}) => ({ observedDate: '2026-11-06', model: { ...context, taxDate: '2027-01-05',
  prodDate: '20270105', trim: 'S0337' }, request: { trim: 'S0337' }, ...changes });
function artifact(value, changes = {}) {
  const bytes = Buffer.from(JSON.stringify(value));
  return { id: 'source', bytes, sha256: createHash('sha256').update(bytes).digest('hex'),
    observedDatePointer: '/observedDate', context: Object.fromEntries(Object.keys(context).map((key) => [key, `/model/${key}`])),
    responseRoots: ['/model', '/options', '/selectedOptions', '/selectedAccessories'], requestRoots: ['/request'], ...changes };
}
const claim = (field, pointer, changes = {}) => ({ field, artifactId: 'source', pointer, ...changes });
async function qualify(input) {
  const { qualifyBmwSourceFields } = await import('../../scripts/gcsp/bmw-source-qualification.mjs');
  return qualifyBmwSourceFields(input);
}

test('direct pinned response facts retain exact field provenance without granting admission', async () => {
  const result = await qualify({ target, artifacts: [artifact(source())], requiredFields: ['taxDate', 'productionDate'],
    claims: [claim('taxDate', '/model/taxDate'), claim('productionDate', '/model/prodDate')] });
  assert.equal(result.status, 'qualified');
  assert.equal(result.admission, false);
  assert.equal(result.qualification, 'field-evidence-only');
  assert.equal(result.fields.productionDate.value, '2027-01-05');
  assert.equal(result.fields.taxDate.evidence[0].pointer, '/model/taxDate');
  assert.equal(result.fields.taxDate.evidence[0].observedDate, '2026-11-06');
  assert.equal(result.fields.taxDate.evidence[0].confidence, 'direct-response');
});

test('a wrong byte hash cannot qualify a plausible field', async () => {
  const result = await qualify({ target, artifacts: [artifact(source(), { sha256: '0'.repeat(64) })],
    requiredFields: ['taxDate'], claims: [claim('taxDate', '/model/taxDate')] });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.fields.taxDate.value, null);
  assert.deepEqual(result.fields.taxDate.reasons, ['hash-mismatch']);
});

test('missing and inherited JSON locators never borrow a nearby value', async () => {
  const result = await qualify({ target, artifacts: [artifact(source())], requiredFields: ['taxDate', 'trim'],
    claims: [claim('taxDate', '/model/taxDateMissing'), claim('trim', '/model/toString')] });
  assert.deepEqual(result.fields.taxDate.reasons, ['missing-locator']);
  assert.deepEqual(result.fields.trim.reasons, ['missing-locator']);
});

test('a request trim cannot corroborate its own source role', async () => {
  const result = await qualify({ target, artifacts: [artifact(source(), { responseRoots: [''] })],
    requiredFields: ['trim'], claims: [claim('trim', '/request/trim')] });
  assert.deepEqual(result.fields.trim.reasons, ['request-input-only']);
});

test('historical dates cannot be promoted by the same model or canonical ID', async () => {
  const result = await qualify({ target: { ...target, configurationId: 'same-id' }, artifacts: [artifact(source({ observedDate: '2026-11-01' }))],
    requiredFields: ['productionDate'], claims: [claim('productionDate', '/model/prodDate')] });
  assert.equal(result.fields.productionDate.value, null);
  assert.deepEqual(result.fields.productionDate.reasons, ['observation-date-mismatch']);
});

test('source context changes fail before a field is qualified', async () => {
  for (const [key, value] of [['modelCode', 'T5ML'], ['agModelCode', '62HH'], ['orderDate', '2026-11-02'], ['effectDate', '2027-01-06']]) {
    const result = await qualify({ target, artifacts: [artifact(source({ model: { ...source().model, [key]: value } }))],
      requiredFields: ['taxDate'], claims: [claim('taxDate', '/model/taxDate')] });
    assert.deepEqual(result.fields.taxDate.reasons, ['context-mismatch'], key);
  }
});

test('conflicting direct source dates refuse qualification rather than choose one', async () => {
  const result = await qualify({ target, artifacts: [artifact(source()), artifact(source({ model: { ...source().model, taxDate: '2027-01-06' } }), { id: 'other' })],
    requiredFields: ['taxDate'], claims: [claim('taxDate', '/model/taxDate'), claim('taxDate', '/model/taxDate', { artifactId: 'other' })] });
  assert.equal(result.status, 'conflict');
  assert.equal(result.fields.taxDate.status, 'conflict');
  assert.equal(result.fields.taxDate.value, null);
  assert.equal(result.fields.taxDate.evidence.length, 2);
});

test('paint and upholstery require actual code-keyed typed definitions', async () => {
  const data = source({ options: { P0300: { option: 'P0300', optionType: 'paint' }, FKSFU: { option: 'FKSFU', optionType: 'fabric' } } });
  const result = await qualify({ target, artifacts: [artifact(data)], requiredFields: ['paint', 'upholstery'],
    claims: [claim('paint', '/options/P0300', { code: 'P0300' }), claim('upholstery', '/options/FKSFU', { code: 'FKSFU' })] });
  assert.deepEqual(result.fields.paint.value, { code: 'P0300', type: 'paint' });
  assert.deepEqual(result.fields.upholstery.value, { code: 'FKSFU', type: 'upholstery' });
  data.options.P0300.option = 'P0475';
  const invalid = await qualify({ target, artifacts: [artifact(data)], requiredFields: ['paint'], claims: [claim('paint', '/options/P0300', { code: 'P0300' })] });
  assert.deepEqual(invalid.fields.paint.reasons, ['invalid-value']);
});

test('direct model labels retain useful text while refusing unsafe or unbounded labels', async () => {
  for (const [value, expected] of [[' BMW i5 eDrive40 M Sport Touring ', 'BMW i5 eDrive40 M Sport Touring'],
    ['<script>bad</script>', null], ['line\nbreak', null], ['x'.repeat(161), null], ['', null]]) {
    const result = await qualify({ target, artifacts: [artifact(source({ model: { ...source().model, modelName: value } }))],
      requiredFields: ['modelName'], claims: [claim('modelName', '/model/modelName')] });
    assert.equal(result.fields.modelName.value, expected);
    assert.equal(result.fields.modelName.status, expected === null ? 'missing' : 'qualified');
  }
});

test('accessory quantity binds the complete factory selection and explicit accessory', async () => {
  const data = source({ selectedOptions: ['FKSFU', 'P0300', 'S0337'], selectedAccessories: [{ code: 'SE000001', type: 'accessory', quantity: 1 }] });
  const entry = artifact(data, { selection: { factoryOptionCodesPointer: '/selectedOptions', accessoriesPointer: '/selectedAccessories' } });
  const selected = { ...target, factoryOptionCodes: ['S0337', 'P0300', 'FKSFU'], accessoryCodes: ['SE000001'] };
  const result = await qualify({ target: selected, artifacts: [entry], requiredFields: ['accessoryQuantity'], claims: [claim('accessoryQuantity', '/selectedAccessories/0', { code: 'SE000001' })] });
  assert.deepEqual(result.fields.accessoryQuantity.value, { code: 'SE000001', quantity: 1 });
  const wrongPaint = await qualify({ target: { ...selected, factoryOptionCodes: ['FKSFU', 'P0475', 'S0337'] }, artifacts: [entry],
    requiredFields: ['accessoryQuantity'], claims: [claim('accessoryQuantity', '/selectedAccessories/0', { code: 'SE000001' })] });
  assert.deepEqual(wrongPaint.fields.accessoryQuantity.reasons, ['selection-mismatch']);
  for (const quantity of [null, 0, -1, 1.5, '1']) {
    data.selectedAccessories[0].quantity = quantity;
    const invalid = await qualify({ target: selected, artifacts: [artifact(data, { selection: entry.selection })], requiredFields: ['accessoryQuantity'],
      claims: [claim('accessoryQuantity', '/selectedAccessories/0', { code: 'SE000001' })] });
    assert.deepEqual(invalid.fields.accessoryQuantity.reasons, ['invalid-value']);
  }
});

test('catalogue production and steering literals do not establish physical or VIN facts', async () => {
  const result = await qualify({ target, artifacts: [artifact(source({ model: { ...source().model, steering: 'RL' } }))],
    requiredFields: ['physicalProductionDate', 'modelYear', 'plant', 'verifiedFitted', 'steeringLiteral'],
    claims: [claim('physicalProductionDate', '/model/prodDate'), claim('modelYear', '/model/prodDate'), claim('steeringLiteral', '/model/steering')] });
  assert.equal(result.fields.steeringLiteral.value, 'RL');
  for (const field of ['physicalProductionDate', 'modelYear', 'plant', 'verifiedFitted']) {
    assert.equal(result.fields[field].value, null);
    assert.deepEqual(result.fields[field].reasons, ['physical-evidence-not-supported']);
  }
});

test('a valid effect date or model code cannot substitute for another field meaning', async () => {
  const result = await qualify({ target, artifacts: [artifact(source())], requiredFields: ['productionDate', 'trim'],
    claims: [claim('productionDate', '/model/effectDate'), claim('trim', '/model/modelCode')] });
  assert.deepEqual(result.fields.productionDate.reasons, ['unsupported-field-locator']);
  assert.deepEqual(result.fields.trim.reasons, ['unsupported-field-locator']);
});

test('invalid target identity dates and codes are rejected rather than matched literally', async () => {
  for (const [key, value] of [['orderDate', '2026-02-30'], ['modelCode', 'bad<script>']]) {
    await assert.rejects(() => qualify({ target: { ...target, context: { ...context, [key]: value } }, artifacts: [], requiredFields: ['taxDate'], claims: [] }),
      { code: 'invalid-qualification-input' });
  }
});

test('F39 catalogue date must agree with actual observation date, independently of order and effect dates', async () => {
  const result = await qualify({ target, artifacts: [artifact(source({ model: { ...source().model, catalogueDate: '2026-11-01' } }))],
    requiredFields: ['catalogueDate'], claims: [claim('catalogueDate', '/model/catalogueDate')] });
  assert.deepEqual(result.fields.catalogueDate.reasons, ['catalogue-date-mismatch']);
  assert.equal(result.fields.catalogueDate.value, null);
});

test('a retained projection without its observation date stays unqualified despite a dated filename', async () => {
  const data = source({ observedDate: undefined });
  const result = await qualify({ target: { ...target, observedDate: '2026-11-05' }, artifacts: [artifact(data, { id: 'projection-2026-11-05' })],
    requiredFields: ['taxDate'], claims: [claim('taxDate', '/model/taxDate', { artifactId: 'projection-2026-11-05' })] });
  assert.deepEqual(result.fields.taxDate.reasons, ['missing-observation-date']);
});

test('successful qualification preserves the actual supplied target, artifacts, claims and bytes', async () => {
  const input = { target: structuredClone(target), artifacts: [artifact(source())], requiredFields: ['taxDate'],
    claims: [claim('taxDate', '/model/taxDate')] };
  const suppliedBytes = input.artifacts[0].bytes;
  const before = { ...structuredClone(input), artifacts: input.artifacts.map((entry) => ({ ...structuredClone(entry), bytes: Buffer.from(entry.bytes) })) };
  const result = await qualify(input);
  assert.equal(result.fields.taxDate.status, 'qualified');
  assert.equal(result.fields.taxDate.value, '2027-01-05');
  assert.deepEqual(input, before);
  assert.strictEqual(input.artifacts[0].bytes, suppliedBytes);
  assert.deepEqual(suppliedBytes, before.artifacts[0].bytes);
});

test('artifact size limits and missing artifacts refuse qualification', async () => {
  const data = source();
  const result = await qualify({ target, artifacts: [artifact(data)], requiredFields: ['taxDate'], claims: [claim('taxDate', '/model/taxDate', { artifactId: 'absent' })] });
  assert.deepEqual(result.fields.taxDate.reasons, ['missing-artifact']);
  await assert.rejects(() => qualify({ target, artifacts: [artifact(data, { bytes: ' '.repeat(1024 * 1024 + 1) })], requiredFields: ['taxDate'], claims: [] }),
    { code: 'invalid-qualification-input' });
});

test('invalid dates and JSON cannot qualify while bounded input errors fail closed', async () => {
  const invalid = await qualify({ target, artifacts: [artifact(source({ model: { ...source().model, taxDate: '2027-02-30' } }))],
    requiredFields: ['taxDate'], claims: [claim('taxDate', '/model/taxDate')] });
  assert.deepEqual(invalid.fields.taxDate.reasons, ['invalid-value']);
  const bytes = Buffer.from('{broken');
  const malformed = await qualify({ target, artifacts: [artifact(source(), { bytes, sha256: createHash('sha256').update(bytes).digest('hex') })],
    requiredFields: ['taxDate'], claims: [claim('taxDate', '/model/taxDate')] });
  assert.deepEqual(malformed.fields.taxDate.reasons, ['invalid-json']);
  await assert.rejects(() => qualify({ target, artifacts: Array(33).fill(artifact(source())), requiredFields: ['taxDate'], claims: [] }), { code: 'invalid-qualification-input' });
});

test('duplicate JSON keys cannot silently choose one of two conflicting source values', async () => {
  for (const spelling of ['taxDate', 'tax\\u0044ate']) {
    const raw = JSON.stringify(source()).replace('"taxDate":"2027-01-05"', `"taxDate":"2027-01-05","${spelling}":"2027-01-06"`);
    const bytes = Buffer.from(raw);
    const result = await qualify({ target, artifacts: [artifact({}, { bytes, sha256: createHash('sha256').update(bytes).digest('hex') })],
      requiredFields: ['taxDate'], claims: [claim('taxDate', '/model/taxDate')] });
    assert.deepEqual(result.fields.taxDate.reasons, ['duplicate-json-key']);
    assert.equal(result.fields.taxDate.value, null);
  }
});

test('retained 1 November bytes qualify historical fields without filling 6 November gaps', async () => {
  const bytes = await readFile(new URL('../vehicle-evidence/snapshots/bmw-gb-i5-2026-11-01.v1.json', import.meta.url));
  const retained = artifact({}, { bytes, sha256: 'ee1ae6c5cb6ab742f9a2959825ca722007409fa019d15acd44bb4b79984556a3', responseRoots: [''], requestRoots: [] });
  const historical = await qualify({ target: { ...target, observedDate: '2026-11-01' }, artifacts: [retained], requiredFields: ['productionDate', 'taxDate', 'trim'],
    claims: [claim('productionDate', '/model/prodDate'), claim('taxDate', '/model/taxDate'), claim('trim', '/trim')] });
  assert.equal(historical.status, 'qualified');
  assert.equal(historical.fields.productionDate.value, '2027-01-05');
  const current = await qualify({ target, artifacts: [retained], requiredFields: ['productionDate'], claims: [claim('productionDate', '/model/prodDate')] });
  assert.deepEqual(current.fields.productionDate.reasons, ['observation-date-mismatch']);
});

test('retained 6 November observation keeps missing production, trim role and quantity explicit', async () => {
  const bytes = await readFile(new URL('../../docs/gcsp/evidence/fucq59/source-executor-2026-11-06/observation.json', import.meta.url));
  const prefix = '/result/sourceObservations/0';
  const retained = artifact({}, { bytes, sha256: '1ce513909d0196b08808af896914a0e041322ef88d2c06eda73532ff404d29dc',
    observedDatePointer: '/startedAt', observedDateFormat: 'iso-timestamp',
    context: { modelCode: `${prefix}/canonicalIdentity/vgModelCode`, agModelCode: `${prefix}/canonicalIdentity/agModelCode`,
      orderDate: `${prefix}/sourceContext/orderDate`, effectDate: `${prefix}/sourceContext/effectDate` },
    responseRoots: [`${prefix}/resolvedSelection`, `${prefix}/sourceContext`], requestRoots: [`${prefix}/originalRequest`] });
  const result = await qualify({ target, artifacts: [retained], requiredFields: ['productionDate', 'trim', 'accessoryQuantity'],
    claims: [claim('productionDate', `${prefix}/sourceContext/productionDate`), claim('trim', `${prefix}/originalRequest/mandatoryElements/0`),
      claim('accessoryQuantity', `${prefix}/resolvedSelection/selectedAccessories/0`, { code: 'SE000001' })] });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.fields.productionDate.reasons, ['missing-locator']);
  assert.deepEqual(result.fields.trim.reasons, ['request-input-only']);
  assert.equal(result.fields.accessoryQuantity.value, null);
});
