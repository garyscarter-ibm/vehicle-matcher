import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { toOfferPresentation } from '../../blocks/gcsp/offer/offer-projection.js';
import { createOfferController } from '../../blocks/gcsp/offer/offer-controller.js';

const bytes = await readFile(new URL('../../docs/gcsp/evidence/fucq105/representative-access.json', import.meta.url), 'utf8');
const sample = () => JSON.parse(bytes);
const envelope = (v = sample()) => ({ status: 'ok', value: v, contractVersion: '1.0.0' });
const known = (value, unit = null) => ({ ...structuredClone(sample().quote.facts.facts.seats), value, unit });

test('schema sample is exactly the reviewed102 evaluator/access evidence, not a100 producer fixture', () => {
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '04272860d8783820235cbc76b25ac1a96898350be2305e81bbbc56ca558f0f1f');
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
  assert.equal(v.currentCar, null); assert.equal(JSON.stringify(v).includes('G21 320i M Sport Touring'), false);
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
    (v) => { v.availableActions = ['accept', 'accept']; }, (v) => { v.state = 'accepted'; },
    (v) => { v.serverNow = null; }, (v) => { v.comparison = { status: 'ok', currentCar: { name: 'unapproved' } }; },
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
