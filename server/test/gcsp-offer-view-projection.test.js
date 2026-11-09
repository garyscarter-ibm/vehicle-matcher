import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { toOfferPresentation } from '../../blocks/gcsp/offer/offer-projection.js';
import { createOfferController } from '../../blocks/gcsp/offer/offer-controller.js';

const bytes = await readFile(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json', import.meta.url), 'utf8');
const comparisonBytes = await readFile(new URL('../../docs/gcsp/evidence/fucq105/comparison-access.json', import.meta.url), 'utf8');
const producerBytes = await readFile(new URL('../../docs/gcsp/evidence/fucq105/producer-access.json', import.meta.url), 'utf8');
const declineBytes = await readFile(new URL('../../docs/gcsp/evidence/fucq105/producer-decline-access.json', import.meta.url), 'utf8');
const sample = () => JSON.parse(bytes);
const partial = () => JSON.parse(comparisonBytes);
// The published samples predate the handoff record, so an acceptable offer gains one unless a test sets its own.
export const handoffDto = (over = {}) => ({ termsVersion: 'fictional-order-terms-v1', termsDigest: 'terms-digest-1', wording: 'Fictional terms.', fictional: true,
  mode: 'replacement', blocker: null, contact: { phone: '07700 900123', email: 'paula@example.invalid' },
  returnCar: { model: 'G20 320d', contractEndDate: '2026-12-31', currentOdometer: { value: 41250, unit: 'miles' } },
  declarations: [{ id: 'terms', label: 'I accept the terms.' }, { id: 'return', label: 'The return details are correct.' }], ...over });
const withHandoff = (v) => v.handoff === undefined && v.availableActions?.includes('accept') ? { ...v, handoff: handoffDto() } : v;
const envelope = (v = sample()) => ({ status: 'ok', value: withHandoff(v), contractVersion: '1.0.0' });
const known = (value, unit = null) => ({ ...structuredClone(sample().quote.facts.facts.seats), value, unit });

test('schema sample is exactly the reviewed102 evaluator/access evidence, not a100 producer fixture', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '9a406c67d7785353c941b2ba294593e188e6ef6045bf099fe222a1131f37d884');
  assert.equal(createHash('sha256').update(comparisonBytes).digest('hex'), 'e3d8a9065ac85e4088768a27db0cb22b1f4f136b5c6b8f68a960dd5e525ddab6');
  assert.equal(sample().quote.facts.sourceNamespace, 'fixture:employee');
});

test('approved102 DTO binds exact order string, pinned monthly points, shared reasons and unknown comparison', () => {
  const outcome = toOfferPresentation(envelope()); assert.equal(outcome.status, 'ok');
  const v = outcome.value; const member = v.card.members[0];
  assert.equal(v.state, 'pending'); assert.equal(member.display.line, 'Order no. 0999987');
  assert.equal(member.identity.orderUuid, sample().quote.orderUuid);
  assert.equal(member.identity.configurationId, sample().quote.configurationId);
  assert.deepEqual(member.terms[0], { kind: 'points-monthly', value: 1100, allowance: 1300, provenance: sample().quote.terms.provenance });
  assert.equal(member.decision.gateStatus, 'eligible'); assert.equal(member.decision.reasons.length, 2);
  assert.equal(member.facts.find((f) => f.label === 'Derivative').value, null);
  assert.equal(member.facts.find((f) => f.label === 'Options').missingLabel, 'Fitted equipment unknown');
  assert.equal(v.currentCar, null); assert.equal(JSON.stringify(v).includes('320i M Sport Touring'), false);
});

test('hold deadline and supplied DemoClock govern countdown, never quote validity or current time', async () => {
  const c = createOfferController({ read: async () => toOfferPresentation(envelope()) });
  const v = await c.refresh();
  assert.equal(v.seconds, 7200); assert.equal(v.expiresAt, sample().expiresAt);
  assert.notEqual(v.expiresAt, sample().quote.validUntil); assert.equal(v.canAccept, false);
  c.destroy();
});

test('provided exact details, zero/false, arrays and provenance are retained without equipment inference', () => {
  const dto = sample(); Object.assign(dto.quote.facts.display, { model: 'BMW 3 Series', derivative: '320i M Sport Touring', colour: 'Display blue' });
  Object.assign(dto.quote.facts.facts, { colour: known('Portimao Blue metallic'), options: known(['Heated steering wheel', 'Sun protection glass']),
    interior: known(false), gearbox: known('Automatic'), boot: known(0, 'L') });
  const member = toOfferPresentation(envelope(dto)).value.card.members[0];
  assert.equal(member.facts.find((f) => f.label === 'Model').value, 'BMW 3 Series');
  assert.equal(member.facts.find((f) => f.label === 'Colour').value, 'Portimao Blue metallic');
  assert.equal(member.facts.find((f) => f.label === 'Options').value, 'Heated steering wheel, Sun protection glass');
  assert.equal(member.facts.find((f) => f.label === 'Interior').value, false);
  assert.equal(member.facts.find((f) => f.label === 'Boot').value, 0);
  assert.deepEqual(member.provenance.revisions, dto.quote.revisions);
  assert.deepEqual(member.facts.find((f) => f.label === 'Colour').provenance, dto.quote.facts.facts.colour.provenance);
});

test('unknown facts and missing allowance never fall back to display guesses or current policy', () => {
  const dto = sample(); dto.quote.allowance = {}; dto.quote.terms.allowanceInputs = {};
  dto.quote.facts.display.colour = 'Display blue';
  dto.quote.facts.facts.colour = { ...known(null), status: 'unknown' };
  dto.quote.facts.facts.options = known([]);
  const outcome = toOfferPresentation(envelope(dto)); assert.equal(outcome.status, 'ok');
  const member = outcome.value.card.members[0];
  assert.equal(member.terms[0].allowance, null); assert.equal(member.terms[0].value, 1100);
  assert.equal(member.facts.find((f) => f.label === 'Colour').value, null);
  assert.equal(member.facts.find((f) => f.label === 'Options').value, 'None listed');
});

test('media preserves representative caption and supplies truthful fallback qualification', () => {
  const dto = sample(); const display = dto.quote.facts.display;
  display.photo = '/assets/brand-hero/bmw.jpg'; display.images = [{ src: display.photo, alt: 'Representative BMW', caption: 'Brand image, not this car' }];
  assert.deepEqual(toOfferPresentation(envelope(dto)).value.card.members[0].media,
    { src: display.photo, alt: 'Representative BMW', caption: 'Brand image, not this car' });
  display.images = [];
  assert.match(toOfferPresentation(envelope(dto)).value.card.members[0].media.caption, /Representative image/);
});

test('unsupported private fields never enter the display projection or its retained evidence', () => {
  const dto = sample(); const privateValue = 'private-marker-must-not-cross';
  dto.employeeId = privateValue; dto.tokenHash = privateValue; dto.quote.employeeFacts = { employeeId: privateValue };
  dto.quote.facts.sourceKeys.vin = privateValue; dto.quote.facts.display.link = privateValue;
  dto.quote.facts.facts.employeeId = privateValue; dto.quote.terms.provenance.employeeId = privateValue;
  dto.quote.decision.reasons[0].employeeFacts = { privateValue };
  dto.quote.decision.reasons.push({ code: 'unknown-evidence', field: 'charging', fact: { privateValue }, requirement: { privateValue } });
  const outcome = toOfferPresentation(envelope(dto)); assert.equal(outcome.status, 'ok');
  assert.equal(JSON.stringify(outcome).includes(privateValue), false);
});

test('malformed identities, units, facts and unsupported schemas fail closed without a card', () => {
  const changes = [
    (v) => { v.schemaVersion = 2; }, (v) => { v.quote.orderNumber = 999987; }, (v) => { v.quote.orderNumber = '999987'; },
    (v) => { v.quote.facts.sourceKeys.stockId = 'other-car'; }, (v) => { v.offerVersion = 0; }, (v) => { v.quote.revisions.quote = 0; },
    (v) => { v.quote.terms.points.unit = 'GBP'; }, (v) => { v.quote.terms.points.value = -1; },
    (v) => { v.quote.terms.allowanceInputs.allowance.value = 900; },
    (v) => { v.quote.facts.facts.seats.value = { private: 'object' }; },
    (v) => { v.quote.facts.facts.seats.status = 'unknown'; },
    (v) => { v.quote.facts.display.photo = 'javascript:alert(1)'; },
    (v) => { v.quote.facts.facts.seats.provenance.assurance = 'invented'; },
    (v) => { v.availableActions = ['accept', 'accept']; }, (v) => { v.availableActions = ['accept']; }, (v) => { v.state = 'accepted'; },
    (v) => { v.serverNow = null; }, (v) => { v.quote.quotedAt = '2026-02-30T12:00:00Z'; },
  ];
  for (const mutate of changes) {
    const dto = sample(); mutate(dto); const outcome = toOfferPresentation(envelope(dto));
    assert.equal(outcome.status, 'unavailable'); assert.equal(outcome.value, undefined);
  }
});

test('locator binding prevents another offer or run response replacing this page', () => {
  for (const reference of [{ offerId: 'other' }, { offerId: sample().offerId, runId: 'other' }]) {
    assert.equal(toOfferPresentation(envelope(), { reference }).status, 'unavailable');
  }
  assert.equal(toOfferPresentation(envelope(), { reference: { offerId: sample().offerId, runId: null } }).status, 'ok');
});

test('uncertain pending reasons suppress actions without inventing operation or decision IDs', () => {
  for (const reason of ['decision-pending', 'release-pending']) {
    const dto = sample(); dto.reason = reason; dto.availableActions = [];
    const outcome = toOfferPresentation(envelope(dto)); assert.equal(outcome.value.state, 'uncertain');
    assert.deepEqual(outcome.value.actions, { accept: false, decline: false });
    assert.equal(outcome.value.operationId, undefined); assert.equal(outcome.value.intendedDecision, undefined);
    assert.match(outcome.value.message, /being confirmed/);
  }
});

test('terminal states and earlier-run refusal retain one state without claiming new actions or old quote access', () => {
  for (const state of ['accepted', 'declined', 'expired', 'superseded']) {
    const dto = sample(); dto.state = state; dto.availableActions = [];
    const result = toOfferPresentation(envelope(dto)); assert.equal(result.value.state, state);
    assert.deepEqual(result.value.actions, { accept: false, decline: false });
  }
  assert.deepEqual(toOfferPresentation({ status: 'stale-run', value: sample() }), { status: 'stale-run' });
});

test('projection never mutates the immutable server response', () => {
  const input = envelope(); const before = structuredClone(input);
  const result = toOfferPresentation(input); assert.equal(result.status, 'ok');
  result.value.card.members[0].facts[0].value = 'local edit';
  assert.deepEqual(input, before);
});

test('approved partial metadata displays only the model and dated source with all eight facts unknown', () => {
  const dto = partial(); const before = structuredClone(dto);
  const outcome = toOfferPresentation(envelope(dto)); assert.equal(outcome.status, 'ok');
  const v = outcome.value; const car = v.currentCar;
  assert.equal(v.comparisonAvailable, false); assert.equal(car.status, 'partial');
  assert.deepEqual(car.display, { name: dto.comparison.currentCar.model }); assert.deepEqual(car.media, {});
  assert.deepEqual(car.source, dto.comparison.currentCar.source);
  assert.equal(car.provenance, undefined);
  assert.deepEqual(car.facts.map((f) => f.label), ['Configuration', 'Body', 'Fuel', 'Seats', 'Boot', 'MPG', '0–62 mph', 'Points a month']);
  assert.ok(car.facts.every((f) => f.value === null && f.missingLabel === 'Unknown'));
  assert.equal(v.card.members[0].terms[0].value, 1100); assert.equal(v.card.members[0].terms[0].allowance, 1300);
  car.source.sourceVersion = 'local edit'; car.facts[0].value = 'local edit'; assert.deepEqual(dto, before);
});

test('exact published producer samples preserve decline-only server authority and the original hold deadline', () => {
  assert.equal(createHash('sha256').update(producerBytes).digest('hex'), 'e50f3c56f3df4d3437a6fd2ec91e62fd713e0c1c5a42ce0d44753110a5535080');
  assert.equal(createHash('sha256').update(declineBytes).digest('hex'), 'c9a63f5b6dacfeb0c3720904ee218c085039903f55a74b551fb463fd70a626f5');
  for (const bytes of [producerBytes, declineBytes]) {
    const dto = JSON.parse(bytes); const result = toOfferPresentation(envelope(dto));
    assert.equal(result.status, 'ok'); assert.equal(result.value.state, 'pending');
    assert.deepEqual(result.value.actions, { accept: dto.availableActions.includes('accept'), decline: true });
    assert.equal(result.value.expiresAt, '2026-11-05T14:00:00.000Z');
    assert.equal(result.value.card.members[0].display.line, 'Order no. 0123456');
    assert.deepEqual(result.value.currentCar.source, dto.comparison.currentCar.source);
    assert.equal(result.value.comparisonAvailable, false);
    assert.ok(result.value.currentCar.facts.every((f) => f.value === null));
    assert.equal(JSON.stringify(result).match(/employeeId|principalId|tokenHash|tokenMetadata|contractId|employeeVersion|slotVersion|"binding"/), null);
  }
});

test('decline-only authority survives missing comparison, while unavailable access discloses no offer', () => {
  const dto = JSON.parse(declineBytes); delete dto.comparison;
  const result = toOfferPresentation(envelope(dto)); assert.equal(result.status, 'ok');
  assert.deepEqual(result.value.actions, { accept: false, decline: true }); assert.equal(result.value.currentCar, null);
  for (const status of ['unavailable', 'forbidden', 'not-found', 'stale-run']) {
    const outcome = toOfferPresentation({ status, value: JSON.parse(declineBytes) });
    assert.equal(outcome.status, status); assert.equal(outcome.value, undefined);
  }
});

test('all approved source modes and model length boundary retain dated provenance, including equal quote instants', () => {
  for (const mode of ['synthetic', 'dated-snapshot', 'authorised-live']) {
    const dto = partial(); const car = dto.comparison.currentCar;
    car.model = 'x'.repeat(256); car.source.mode = mode; car.source.observedAt = dto.quote.quotedAt;
    const result = toOfferPresentation(envelope(dto)).value;
    assert.equal(result.currentCar.display.name.length, 256); assert.equal(result.currentCar.source.mode, mode);
    assert.equal(result.comparisonAvailable, false);
  }
  const dto = partial(); dto.comparison.currentCar.source.observedAt = dto.quote.quotedAt.replace('.000Z', 'Z');
  assert.ok(toOfferPresentation(envelope(dto)).value.currentCar);
});

test('private comparison bindings and unreviewed facts never cross or replace the eight unknowns', () => {
  const dto = partial(); const marker = 'private-comparison-marker'; const car = dto.comparison.currentCar;
  Object.assign(dto.comparison, { binding: { employeeId: marker }, sourceRef: marker, rawRecords: [marker] });
  Object.assign(car, { binding: marker, employeeId: marker, contractId: marker, slotId: marker, contractRevision: marker,
    configurationId: marker, points: 999, body: 'Estate', media: { src: marker } });
  Object.assign(car.source, { sourceRef: marker, rawRecord: marker, revision: marker });
  const result = toOfferPresentation(envelope(dto)); assert.equal(result.status, 'ok');
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.deepEqual(Object.keys(result.value.currentCar.source).sort(), ['mode', 'observedAt', 'sourceVersion']);
  assert.ok(result.value.currentCar.facts.every((f) => f.value === null));
});

const recorded = (dto, facts) => {
  const c = dto.comparison; const keys = Object.keys(facts);
  c.currentCar.facts = Object.fromEntries(keys.map((k) => [k, { value: facts[k], unit: null }]));
  c.unknowns = c.unknowns.filter((k) => !keys.includes(k));
  c.comparisonAvailable = true; c.reason = 'current-car-facts-recorded'; c.status = c.unknowns.length ? 'partial' : 'available';
  return dto;
};

test('recorded current-car facts display formatted beside Unknown ones', () => {
  const dto = recorded(partial(), { configuration: '320i M Sport Touring', body: 'estate', boot: 500, mpg: 42.8, zeroTo62: 7.6, points: 1100 });
  const { value } = toOfferPresentation(envelope(dto)); const by = Object.fromEntries(value.currentCar.facts.map((f) => [f.label, f.value]));
  assert.equal(value.comparisonAvailable, true); assert.equal(value.currentCar.status, 'partial');
  assert.deepEqual(by, { Configuration: '320i M Sport Touring', Body: 'Estate', Fuel: null, Seats: null, Boot: '500 litres',
    MPG: '42.8 mpg', '0–62 mph': '7.6 s', 'Points a month': '1,100 points' });
});

test('all eight recorded facts give an available comparison with no unknowns', () => {
  const dto = recorded(partial(), { configuration: '320i M Sport Touring', body: 'estate', fuel: 'petrol', seats: 5, boot: 500, mpg: 42.8, zeroTo62: 7.6, points: 1100 });
  const { value } = toOfferPresentation(envelope(dto));
  assert.equal(value.currentCar.status, 'available'); assert.ok(value.currentCar.facts.every((f) => f.value !== null));
  assert.equal(value.currentCar.facts.find((f) => f.label === 'Fuel').value, 'Petrol');
});

for (const [name, bad] of [['string number', '500'], ['negative', -1], ['NaN', null], ['object', { v: 1 }]]) {
  test(`malformed recorded fact (${name}) is refused rather than shown`, () => {
    const dto = recorded(partial(), { boot: 500 }); dto.comparison.currentCar.facts.boot.value = bad;
    const { value } = toOfferPresentation(envelope(dto)); assert.equal(value.currentCar, null); assert.equal(value.comparisonAvailable, false);
  });
}

test('facts that contradict the unknowns list are refused', () => {
  const dto = recorded(partial(), { boot: 500 }); dto.comparison.unknowns.push('boot');
  assert.equal(toOfferPresentation(envelope(dto)).value.currentCar, null);
});

const invalidComparisons = [
  ['missing comparison', (v) => { delete v.comparison; }],
  ['unreviewed shape', (v) => { v.comparison = { status: 'ok', currentCar: { name: 'unapproved' } }; }],
  ['unavailable state', (v) => { v.comparison.status = 'unavailable'; }],
  ['unreviewed reason', (v) => { v.comparison.reason = 'complete'; }],
  ['claimed complete comparison', (v) => { v.comparison.comparisonAvailable = true; }],
  ['missing availability', (v) => { delete v.comparison.comparisonAvailable; }],
  ['missing current car', (v) => { v.comparison.currentCar = null; }],
  ['blank model', (v) => { v.comparison.currentCar.model = '   '; }],
  ['overlong model', (v) => { v.comparison.currentCar.model = 'x'.repeat(257); }],
  ['nontext model', (v) => { v.comparison.currentCar.model = { name: 'BMW' }; }],
  ['missing source', (v) => { delete v.comparison.currentCar.source; }],
  ['unreviewed source mode', (v) => { v.comparison.currentCar.source.mode = 'verified'; }],
  ['nontext source mode', (v) => { v.comparison.currentCar.source.mode = ['synthetic']; }],
  ['blank source version', (v) => { v.comparison.currentCar.source.sourceVersion = ' '; }],
  ['malformed source date', (v) => { v.comparison.currentCar.source.observedAt = 'yesterday'; }],
  ['non-UTC source date', (v) => { v.comparison.currentCar.source.observedAt = '2026-11-05T11:00:00+00:00'; }],
  ['calendar rollover', (v) => { v.comparison.currentCar.source.observedAt = '2026-02-30T11:00:00Z'; }],
  ['hour rollover', (v) => { v.comparison.currentCar.source.observedAt = '2026-11-04T24:00:00Z'; }],
  ['future source date', (v) => { v.comparison.currentCar.source.observedAt = '2026-11-05T12:00:00.001Z'; }],
  ['future fractional instant', (v) => { v.comparison.currentCar.source.observedAt = '2026-11-05T12:00:00.0001Z'; }],
  ['missing unknowns', (v) => { delete v.comparison.unknowns; }],
  ['incomplete unknowns', (v) => { v.comparison.unknowns.pop(); }],
  ['duplicate unknown', (v) => { v.comparison.unknowns[7] = 'body'; }],
  ['unsupported unknown', (v) => { v.comparison.unknowns[7] = 'vin'; }],
  ['nontext unknown', (v) => { v.comparison.unknowns[7] = ['points']; }],
];
for (const [name, mutate] of invalidComparisons) test(`invalid comparison falls back while retaining the valid offer: ${name}`, () => {
  const dto = partial(); mutate(dto); const outcome = toOfferPresentation(envelope(dto));
  assert.equal(outcome.status, 'ok'); assert.equal(outcome.value.currentCar, null);
  assert.equal(outcome.value.comparisonAvailable, false); assert.equal(outcome.value.state, 'pending');
  assert.equal(outcome.value.card.members[0].display.line, 'Order no. 0999987');
  assert.deepEqual(outcome.value.actions, { accept: true, decline: true });
});

test('decision reference forwards the validated immutable quote revision without internal authority', () => {
  const dto = sample(); dto.quote.revisions.quote = 7;
  const outcome = toOfferPresentation({ status: 'ok', value: dto });
  assert.equal(outcome.status, 'ok');
  assert.deepEqual(outcome.value.reference, { offerId: dto.offerId, runId: dto.runId,
    offerVersion: dto.offerVersion, holdVersion: dto.holdVersion, quoteVersion: 7 });
});

const acceptedDto = (selection) => ({ ...sample(), state: 'accepted', reason: 'accepted', offerState: 'accepted', holdState: 'allocated', availableActions: [], selection });
const selectionDto = (over = {}) => ({ schemaVersion: 1, selectionState: 'acknowledged', approved: false, current: 'HR approval', orderReference: 'GCSP-000123', orderNumber: '0999987',
  stages: [{ name: 'selection received', state: 'complete' }, { name: 'HR approval', state: 'waiting' }, { name: 'sent to ordering', state: 'not-started' }], ...over });

test('the handoff record crosses with the server digest, declarations and return car, and gates the accept action', () => {
  const value = toOfferPresentation(envelope()).value;
  assert.deepEqual(value.handoff, handoffDto()); assert.deepEqual(value.actions, { accept: true, decline: true }); assert.equal(value.selection, null);
  const blocked = toOfferPresentation(envelope({ ...sample(), availableActions: ['decline'], handoff: handoffDto({ blocker: 'return-data-required' }) })).value;
  assert.equal(blocked.handoff.blocker, 'return-data-required'); assert.deepEqual(blocked.actions, { accept: false, decline: true });
  const missing = toOfferPresentation(envelope({ ...sample(), handoff: null })).value;
  assert.equal(missing.handoff, null); assert.deepEqual(missing.actions, { accept: false, decline: true });
  const unavailable = handoffDto({ blocker: 'ordering-terms-unavailable', termsVersion: null, termsDigest: null, wording: null, declarations: [] });
  assert.equal(toOfferPresentation(envelope({ ...sample(), availableActions: ['decline'], handoff: unavailable })).status, 'ok');
});

for (const [name, mutate] of [
  ['not an object', () => 'terms'], ['unknown blocker', (h) => ({ ...h, blocker: 'maybe' })], ['not fictional', (h) => ({ ...h, fictional: false })],
  ['bad mode', (h) => ({ ...h, mode: 'swap' })], ['missing digest with no blocker', (h) => ({ ...h, termsDigest: null })],
  ['no declarations with no blocker', (h) => ({ ...h, declarations: [] })], ['no contact with no blocker', (h) => ({ ...h, contact: null })],
  ['duplicate declaration ids', (h) => ({ ...h, declarations: [h.declarations[0], h.declarations[0]] })],
  ['blank declaration label', (h) => ({ ...h, declarations: [{ id: 'terms', label: ' ' }] })],
  ['negative odometer', (h) => ({ ...h, returnCar: { ...h.returnCar, currentOdometer: { value: -1, unit: 'miles' } } })],
  ['odometer without unit', (h) => ({ ...h, returnCar: { ...h.returnCar, currentOdometer: { value: 10 } } })],
  ['contact without email', (h) => ({ ...h, contact: { phone: '07700 900123' } })],
]) test(`malformed handoff fails closed: ${name}`, () => {
  const dto = { ...sample(), handoff: mutate(handoffDto()) };
  assert.equal(toOfferPresentation(envelope(dto)).status, 'unavailable');
});

test('a handoff is refused outside a pending offer', () => {
  assert.equal(toOfferPresentation(envelope({ ...acceptedDto(null), handoff: handoffDto() })).status, 'unavailable');
});

test('the selection record keeps the server stage names, order and states', () => {
  const value = toOfferPresentation(envelope(acceptedDto(selectionDto()))).value;
  assert.equal(value.state, 'accepted'); assert.equal(value.handoff, null);
  assert.deepEqual(value.selection, { selectionState: 'acknowledged', current: 'HR approval', orderReference: 'GCSP-000123', orderNumber: '0999987',
    stages: selectionDto().stages });
  const legacy = ({ orderReference, ...rest }) => rest;
  for (const dto of [legacy(selectionDto()), selectionDto({ orderReference: null })]) {
    assert.equal(toOfferPresentation(envelope(acceptedDto(dto))).value.selection.orderReference, null);
  }
  assert.equal(toOfferPresentation(envelope(acceptedDto(null))).value.selection, null);
  const pending = toOfferPresentation(envelope(acceptedDto(selectionDto({ selectionState: 'handoff-pending', orderNumber: null })))).value;
  assert.equal(pending.selection.selectionState, 'handoff-pending'); assert.equal(pending.selection.orderNumber, null);
});

for (const [name, mutate] of [
  ['claims approval', (s) => ({ ...s, approved: true })], ['missing approved flag', ({ approved, ...s }) => s], ['unknown selection state', (s) => ({ ...s, selectionState: 'approved' })],
  ['unknown stage state', (s) => ({ ...s, stages: [{ name: 'selection received', state: 'approved' }] })], ['no stages', (s) => ({ ...s, stages: [] })],
  ['blank stage name', (s) => ({ ...s, stages: [{ name: '', state: 'complete' }] })], ['bad order number', (s) => ({ ...s, orderNumber: '12' })],
  ['bad order reference', (s) => ({ ...s, orderReference: 'GCSP 1' })], ['numeric order reference', (s) => ({ ...s, orderReference: 123 })],
  ['overlong order reference', (s) => ({ ...s, orderReference: `GCSP-${'1'.repeat(40)}` })],
  ['missing current', (s) => ({ ...s, current: '' })], ['wrong schema', (s) => ({ ...s, schemaVersion: 2 })], ['not an object', () => 'sent'],
]) test(`malformed selection fails closed: ${name}`, () => {
  assert.equal(toOfferPresentation(envelope(acceptedDto(mutate(selectionDto())))).status, 'unavailable');
});

test('a selection is refused on an offer that is not accepted', () => {
  assert.equal(toOfferPresentation(envelope({ ...sample(), selection: selectionDto() })).status, 'unavailable');
});
