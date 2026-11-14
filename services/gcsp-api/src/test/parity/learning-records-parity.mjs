// Offline generator for src/test/resources/learning-parity/records-cases.json (never run by the Java tests).
// Run from the repository root: node services/gcsp-api/src/test/parity/learning-records-parity.mjs
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { inputDigest, ok } from '../../../../../server/gcsp/repository/index.js';
import { validateLearningRecord } from '../../../../../server/gcsp/predict/records/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../../../..');
const outPath = join(here, '../resources/learning-parity/records-cases.json');
const clone = (v) => JSON.parse(JSON.stringify(v));
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
const scratch = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'learning-records-parity-'));

// project() is not exported, so load observed.js's own text with its imports made absolute and the function exported.
const serverUrl = pathToFileURL(join(root, 'server/gcsp/')).href;
let source = await readFile(join(root, 'server/gcsp/predict/records/observed.js'), 'utf8');
source = source.replaceAll("from '../../", `from '${serverUrl}`).replace("from './schema.js'", `from '${serverUrl}predict/records/schema.js'`)
  + '\nexport { project };\n';
const patched = join(scratch, 'observed-patched.mjs');
await writeFile(patched, source);
const { project, createObservedLearningRecordService } = await import(pathToFileURL(patched).href);

let state = 20261114;
const rnd = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
const pick = (list) => list[Math.floor(rnd() * list.length)];

// ---- fixtures: the same shapes the repository tables hold, with private fields the projection must drop ----
const R = 'run-1';
const NOW = '2026-11-05T09:10:00.000Z';
const at = (m) => `2026-11-05T09:0${m}:00.000Z`;
const DECLINES = { schemaVersion: 1, reasons: [{ code: 'body-style', label: 'Body style', attribute: 'body' }, { code: 'size', label: 'Size', attribute: 'sizeClass' },
  { code: 'fuel', label: 'Fuel type', attribute: 'fuel' }, { code: 'equipment', label: 'Equipment', attribute: 'equipment' }] };
const DECLINES_PLUS = { schemaVersion: 1, reasons: [...DECLINES.reasons, { code: 'colour', label: 'Colour', attribute: 'colour' }] };
// Fixtures stay lean to keep the case file small; the `priv` ones carry the private fields the projection must drop.
const pref = (value, importance) => ({ value, importance, valueState: 'confirmed', importanceState: 'confirmed' });
const essential = (value) => ({ value, operator: 'gte', unit: 'count', state: 'confirmed' });
const brief = (version, body = 'estate', employeeId = 'emp-1', extra = {}) => ({ runId: R, employeeId, briefVersion: version, status: 'confirmed',
  policyVersion: 'gcsp-policy-v1', confirmedAt: at(0), entitlementSlotId: `slot-${employeeId}`, renewalId: `renewal-${employeeId}`,
  preferences: { body: pref(body, 70) }, essentials: { seats: essential(5) }, ...extra });
const privateBrief = (version) => brief(version, 'estate', 'emp-1', { preferences: { body: { ...pref('estate', 70), source: 'PRIVATE-SOURCE' }, colour: pref('red', 10), comfort: pref(65, 30) },
  essentials: { seats: { ...essential(5), note: 'PRIVATE-NOTE' }, charging: { value: null, operator: 'equals', unit: null, state: 'needs-confirmation' } },
  currentCarRating: { value: 4, contractId: 'PRIVATE-CAR-CONTRACT' } });
const employee = (id = 'emp-1') => ({ runId: R, employeeId: id, roles: ['employee'] });
const slot = (id = 'emp-1') => ({ runId: R, entitlementSlotId: `slot-${id}`, employeeId: id });
const orderOf = (id) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
const world = (employees = ['emp-1']) => ({ briefs: employees.map((e) => brief(1, 'estate', e)), employees: employees.map((e) => employee(e)),
  entitlement_slots: employees.map((e) => slot(e)), offers: [], holds: [], decisions: [], quotes: [], stock: [], receipts: [] });
const clockFor = (extra = {}) => ({ runId: R, now: NOW, clockVersion: 'clock-v1', ...extra });

const ROW_BASES = { empty: world(), offer: addOffer(world(), 1, { state: 'active' }) };
// Expected records are stored as operations on this base: the plain world's unmatched brief record.
const BASE_RECORD = project(clone(world()), { runId: R }, clockFor(), []).at(0);

// Mirrors the outcome() fixture in server/test/gcsp-learning-records.test.js, with overlays for each table.
function addOffer(rows, id, o = {}) {
  const employeeId = o.employeeId ?? 'emp-1'; const orderUuid = orderOf(id); const stateName = o.state ?? 'active';
  const briefVersion = o.briefVersion ?? 1;
  rows.stock.push({ runId: R, orderUuid, configurationId: 'RzIxOlMx', state: stateName === 'selected' ? 'allocated' : 'released',
    allocated: stateName === 'selected', available: stateName !== 'selected', ...(o.priv ? { facts: { private: 'PRIVATE-FACTS' } } : {}), ...o.stock });
  const quote = { runId: R, quoteId: `quote-${id}`, orderUuid, employeeId, entitlementSlotId: `slot-${employeeId}`, briefVersion: o.quoteBriefVersion ?? briefVersion,
    policyVersion: 'gcsp-policy-v1', configurationId: 'RzIxOlMx', monthlyPoints: { value: 1100, unit: 'points' },
    allowance: { allowance: { value: 1300, unit: 'points' }, ...(o.priv ? { name: 'PRIVATE-ALLOWANCE', source: { contact: 'PRIVATE-CONTACT' } } : {}) },
    quotedAt: at(0), validUntil: '2026-11-06T09:00:00.000Z', ...(o.priv ? { facts: { privateBlob: 'PRIVATE-QUOTE' } } : {}), ...o.quote };
  if (!o.noQuote) rows.quotes.push(quote);
  rows.holds.push({ runId: R, holdId: `hold-${id}`, quoteId: quote.quoteId, orderUuid, employeeId, entitlementSlotId: `slot-${employeeId}`,
    state: stateName === 'selected' ? 'allocated' : stateName === 'selection-pending' ? 'selection-pending' : stateName === 'expired' ? 'expired' : 'released',
    policyVersion: 'gcsp-policy-v1', type: 'buddy-offer', ...o.hold });
  if (!o.noOffer) rows.offers.push({ runId: R, offerId: `offer-${id}`, holdId: `hold-${id}`, quoteId: quote.quoteId, employeeId, orderUuid, state: stateName,
    briefVersion, policyVersion: 'gcsp-policy-v1', expiresAt: '2020-01-01T00:00:00.000Z', ...(o.priv ? { tokenHash: 'PRIVATE-TOKEN', tokenMetadata: { email: 'PRIVATE-EMAIL' } } : {}), ...o.offer });
  if (o.decision) rows.decisions.push({ runId: R, decisionId: `decision-${id}`, commandId: `decision-${id}`, offerId: `offer-${id}`, employeeId, decision: o.decision,
    reason: o.reason ?? { code: o.reasonCode ?? 'body-style', ...(o.priv ? { attribute: 'body', text: 'PRIVATE-DECLINE', score: 99 } : {}) },
    versions: { brief: o.decisionBriefVersion ?? briefVersion, policy: 'gcsp-policy-v1' },
    outcome: { status: o.pending ? 'pending' : 'ok', ...(o.priv ? { score: 99, satisfaction: 99 } : {}) }, ...(o.priv ? { actorId: 'PRIVATE-ACTOR' } : {}), ...o.decisionExtra });
  return rows;
}
const receipt = (consumerId, eventId, value, status = 'ok') => ({ runId: R, consumerId, eventId, inputDigest: 'x', state: 'completed', outcome: { status, ...(status === 'ok' ? { value } : {}) },
  version: 1, createdAt: NOW, updatedAt: NOW });
const decisionReceipt = (decisionId, occurredAt, status = 'ok') => receipt('offer-decisions:events:v1', `event-${decisionId}`, { event: { decisionId, occurredAt, private: 'PRIVATE-EVENT' } }, status);
const consumers = ['offer-decisions:events:v1', 'buddy-expiry', 'brief-selection:v1'];
const ordered = (receipts) => consumers.flatMap((c) => receipts.filter((r) => r.consumerId === c));

// A record is stored as set/delete operations on a named base, which keeps the case file small. The path is a JSON pointer.
const diff = (from, to, path = '', ops = []) => {
  const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (plain(from) && plain(to)) {
    for (const key of Object.keys(from)) if (!(key in to)) ops.push([`${path}/${key}`]);
    for (const key of Object.keys(to)) diff(from[key], to[key], `${path}/${key}`, ops);
  } else if (Array.isArray(from) && Array.isArray(to) && to.length >= from.length) {
    to.forEach((item, i) => diff(from[i], item, `${path}/${i}`, ops));
  } else if (JSON.stringify(from) !== JSON.stringify(to)) ops.push([path, to]);
  return ops;
};
const apply = (base, ops) => {
  const out = clone(base);
  for (const [path, value] of ops) {
    if (path === '') return clone(value);
    const parts = path.slice(1).split('/'); let at = out;
    for (const part of parts.slice(0, -1)) at = at[part];
    if (value === undefined) delete at[parts.at(-1)]; else at[parts.at(-1)] = clone(value);
  }
  return out;
};

// ---- Node outcome for one projection case: the direct project() result and the real service's read ----
const cases = [];
async function projectCase(name, source, { clock = clockFor(), declines = DECLINES, group = 'project' } = {}) {
  // Repository rows are plain JSON, so an overlay set to undefined is simply an absent field.
  const rows = clone(source); rows.receipts = ordered(rows.receipts);
  const codes = declines.reasons.map((r) => r.code);
  let direct; let error = null;
  try { direct = project(clone(rows), { runId: R, policyVersion: 'pv' }, clone(clock), codes); } catch (e) { error = e.message; }
  const tables = ['briefs', 'employees', 'entitlement_slots', 'offers', 'holds', 'decisions', 'quotes', 'stock'];
  const service = createObservedLearningRecordService({
    repository: { async query(context, table, filter) {
      if (table === 'event_receipts') return ok(clone(rows.receipts.filter((r) => r.consumerId === filter.consumerId)));
      return tables.includes(table) ? ok(clone(rows[table])) : { status: 'unavailable' }; } },
    identity: { async requireRole() { return ok({}); } },
    clock: { async now() { return ok(clone(clock)); } },
    policy: { async getAssumption() { return { status: 'ok', policyVersion: 'pv', value: { value: clone(declines) } }; } },
  });
  const read = await service.readRecords({ runId: R, policyVersion: 'pv' });
  let expected;
  if (error === null) {
    assert.equal(read.status, 'ok', `${name}: ${JSON.stringify(read)}`);
    assert.deepEqual(read.value.records, direct, name);
    assert.equal(read.value.projectionVersion, inputDigest({ rows, clock, declineReasons: declines }), name);
    for (const r of direct) assert.equal(validateLearningRecord(r, { declineReasonCodes: codes }).status, 'ok', name);
    expected = { status: 'ok', records: direct, projectionVersion: read.value.projectionVersion };
  } else {
    assert.equal(read.status, 'unavailable', name); assert.equal(read.code, 'source-invalid', name);
    expected = { status: 'failed', error };
  }
  const rowBase = Object.entries(ROW_BASES).map(([key, base]) => ({ key, ops: diff(base, rows) })).sort((a, b) => JSON.stringify(a.ops).length - JSON.stringify(b.ops).length)[0];
  assert.deepEqual(apply(ROW_BASES[rowBase.key], rowBase.ops), rows, name);
  cases.push({ kind: group, name, rowBase: rowBase.key, rowOps: rowBase.ops, clock, declineReasons: declines, expected: expected.status === 'ok' ? { ...expected, records: expected.records.map((r) => diff(BASE_RECORD, r)) } : expected });
  return expected;
}

// ---- 1. confirmed brief only, offers in every state ----
await projectCase('brief-only', world());
await projectCase('brief-only-integer-clock', world(), { clock: clockFor({ clockVersion: 7 }) });
await projectCase('brief-only-two-employees', world(['emp-2', 'emp-1']));
{
  const rows = world(); addOffer(rows, 1, { state: 'accepted', decision: 'accept' }); addOffer(rows, 2, { state: 'selected', decision: 'select' });
  addOffer(rows, 3, { state: 'declined', decision: 'decline' }); addOffer(rows, 4, { state: 'expired' }); addOffer(rows, 5, { state: 'active' });
  addOffer(rows, 6, { state: 'selection-pending' });
  await projectCase('offers-all-states', rows);
}
{
  const rows = world(); rows.briefs = [privateBrief(1)]; addOffer(rows, 1, { state: 'declined', decision: 'decline', reasonCode: 'PRIVATE-NAME', priv: true });
  rows.employees[0] = { ...employee(), name: 'PRIVATE-NAME', schemeId: 'current-only', gradeId: 'current-only', contract: { tripHistory: ['PRIVATE-TRIP'] } };
  await projectCase('private-fields-never-survive', rows);
}
for (const [name, o] of [['offered-active', { state: 'active' }], ['selected-no-decision', { state: 'selected' }], ['accepted-offer-only', { state: 'accepted' }],
  ['declined-reviewed-code', { state: 'declined', decision: 'decline', reasonCode: 'size' }],
  ['declined-unregistered-code', { state: 'declined', decision: 'decline', reasonCode: 'PRIVATE-NAME' }],
  ['declined-no-code', { state: 'declined', decision: 'decline', reason: { attribute: 'body', text: 'PRIVATE-DECLINE', score: 99 } }],
  ['declined-code-outside-list', { state: 'declined', decision: 'decline', reasonCode: 'timing' }],
  ['declined-offer-state-rejected', { state: 'rejected' }], ['declined-decision-only', { state: 'active', decision: 'decline', reasonCode: 'fuel' }],
  ['expired', { state: 'expired' }], ['selection-pending', { state: 'selection-pending' }], ['decision-pending', { state: 'decision-pending' }],
  ['pending-accept-decision', { state: 'active', decision: 'accept', pending: true }],
  ['select-decision-selected-literal', { state: 'active', decision: 'selected' }],
  ['decision-original-response-pending', { state: 'active', decision: 'accept', decisionExtra: { outcome: { status: 'ok' }, originalResponse: { status: 'pending' } } }],
  ['decision-failed-outcome-ignored', { state: 'active', decision: 'accept', decisionExtra: { outcome: { status: 'failed' } } }],
  ['accept-decision-and-selected-offer-state', { state: 'selected', decision: 'accept' }]]) {
  const rows = world(); addOffer(rows, 1, o); await projectCase(name, rows);
}
{
  const rows = world(); addOffer(rows, 1, { state: 'declined', decision: 'decline', reasonCode: 'colour' });
  await projectCase('declined-code-added-to-registry', rows, { declines: DECLINES_PLUS });
  await projectCase('declined-code-not-in-default-registry', clone(rows));
}
// ---- 2. quotes: without offer, draft-only, missing, dated terms ----
{
  const rows = world(); addOffer(rows, 1, { state: 'selected', noOffer: true }); rows.briefs.push(brief(2, 'suv'));
  await projectCase('quote-without-offer-selected-hold', rows);
}
{
  const rows = world(); addOffer(rows, 1, { state: 'active', noOffer: true, quote: { briefVersion: 0 } });
  await projectCase('draft-only-quote-no-record', rows);
}
{
  const rows = world(); addOffer(rows, 1, { state: 'active', noOffer: true, quote: { briefVersion: 1.5 } });
  await projectCase('non-integer-quote-brief-version', rows);
}
{ const rows = world(); addOffer(rows, 1, { state: 'active', noQuote: true }); await projectCase('missing-quote-terms-unknown', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active' }); rows.quotes = []; rows.holds = []; await projectCase('missing-quote-and-hold', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { quotedAt: null } }); await projectCase('quote-undated-terms-unknown', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { validUntil: undefined, expiresAt: '2026-11-07T09:00:00.000Z' } }); await projectCase('quote-expires-at-fallback', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { monthlyPoints: { value: 1100, unit: 'gbp' } } }); await projectCase('quote-wrong-unit-terms-unknown', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { monthlyPoints: { value: 0, unit: 'points' }, allowance: { allowance: { value: 0, unit: 'points' } } } }); await projectCase('quote-zero-points-known', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { policyVersion: undefined } }); await projectCase('quote-no-policy-version-terms-unknown', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { configurationId: '' } }); await projectCase('quote-empty-configuration-id', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { quotedAt: '2026-11-06T09:00:00.000Z', validUntil: '2026-11-07T09:00:00.000Z' } }); await projectCase('quote-after-clock-fails', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { validUntil: at(0).replace('09:00', '08:00') } }); await projectCase('quote-valid-until-before-quoted-invalid-record', rows); }
// ---- 3. explicit timestamps ----
{
  const rows = world();
  addOffer(rows, 1, { state: 'accepted', decision: 'accept', offer: { offeredAt: at(1), acceptedAt: at(3) }, decisionExtra: { decidedAt: at(3) } });
  addOffer(rows, 2, { state: 'selected', decision: 'select', offer: { selectedAt: at(2) }, hold: { selectedAt: at(2) }, decisionExtra: { decidedAt: at(2) } });
  addOffer(rows, 3, { state: 'rejected', offer: { rejectedAt: at(4) } });
  addOffer(rows, 4, { state: 'declined', decision: 'decline', offer: { declinedAt: at(5) }, decisionExtra: { decidedAt: at(5) } });
  addOffer(rows, 5, { state: 'expired', offer: { expiredAt: at(6) } });
  addOffer(rows, 6, { state: 'active', decision: 'accept', pending: true, decisionExtra: { decidedAt: at(7) } });
  addOffer(rows, 7, { state: 'decision-pending', offer: { pendingAt: at(8) } });
  addOffer(rows, 8, { state: 'selection-pending', hold: { pendingAt: at(8) } });
  await projectCase('explicit-times-from-rows', rows);
}
{
  const rows = world();
  addOffer(rows, 1, { state: 'accepted', decision: 'accept' }); rows.receipts.push(decisionReceipt('decision-1', at(3)));
  addOffer(rows, 2, { state: 'declined', decision: 'decline' }); rows.receipts.push(decisionReceipt('decision-2', at(4)));
  addOffer(rows, 3, { state: 'expired' }); rows.receipts.push(receipt('buddy-expiry', 'e3', { offerId: 'offer-3', expiredAt: at(5), private: 'PRIVATE' }));
  addOffer(rows, 4, { state: 'selected' }); rows.receipts.push(receipt('brief-selection:v1', 'e4', { offerId: 'offer-4', selectedAt: at(6) }));
  addOffer(rows, 5, { state: 'active', decision: 'accept', pending: true }); rows.receipts.push(decisionReceipt('decision-5', at(7)));
  await projectCase('explicit-times-from-each-receipt-consumer', rows);
}
{
  const rows = world(); addOffer(rows, 1, { state: 'accepted', decision: 'accept' });
  rows.receipts.push(decisionReceipt('decision-1', at(3), 'failed'), receipt('buddy-expiry', 'e1', { offerId: 'offer-1', expiredAt: at(4) }, 'unavailable'),
    receipt('other-consumer', 'e2', { offerId: 'offer-1', selectedAt: at(5) }), receipt('brief-selection:v1', 'e3', { offerId: 'offer-other', selectedAt: at(5) }));
  await projectCase('receipts-ignored-when-not-ok-or-not-matching', rows);
}
{
  const rows = world(); addOffer(rows, 1, { state: 'accepted', decision: 'accept', offer: { acceptedAt: at(3) }, decisionExtra: { decidedAt: '2026-11-05T11:03:00.000+02:00' } });
  await projectCase('same-instant-different-offset-agrees', rows);
}
{
  const rows = world(); addOffer(rows, 1, { state: 'accepted', decision: 'accept', offer: { acceptedAt: at(3) }, decisionExtra: { decidedAt: '2026-11-05T09:03:00Z' } });
  await projectCase('same-instant-no-millis-agrees', rows);
}
{
  const rows = world(); addOffer(rows, 1, { state: 'accepted', offer: { acceptedAt: '2026-11-05T09:03:00.1Z' } });
  await projectCase('single-digit-fraction-time', rows);
}
// remote offer with an operationId: offeredAt stays unknown
{ const rows = world(); addOffer(rows, 1, { state: 'active', hold: { operationId: 'op-1' } }); await projectCase('remote-offer-operation-id-offered-unknown', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', hold: { operationId: '' } }); await projectCase('hold-empty-operation-id-is-local', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', hold: { operationId: 'op-1' }, offer: { offeredAt: at(2) } }); await projectCase('remote-offer-explicit-offered-at', rows); }
// historical versions
{
  const rows = world(); addOffer(rows, 1, { state: 'accepted', decision: 'accept' }); rows.briefs.push(brief(2, 'suv'));
  await projectCase('historical-brief-and-unmatched-current', rows);
}
{
  const rows = world(['emp-1', 'emp-2']); addOffer(rows, 1, { state: 'accepted', decision: 'accept' }); addOffer(rows, 2, { state: 'active', employeeId: 'emp-2' });
  rows.briefs.push(brief(2, 'suv'), brief(3, 'mpv', 'emp-2'), { ...brief(4, 'coupe'), status: 'draft' });
  await projectCase('two-employees-with-later-briefs', rows);
}
{
  const rows = world(); rows.briefs = [brief(1), brief(3, 'suv'), brief(2, 'estate')];
  await projectCase('latest-brief-by-version-not-order', rows);
}
{
  const rows = world(); rows.briefs[0].preferences.body.value = ['suv', 'estate']; rows.briefs[0].preferences.fuel = pref(['ev'], 40); rows.briefs[0].preferences.comfort = pref(65, 30);
  rows.briefs[0].essentials.equipment = { value: ['Heated Seats'], operator: 'includes', unit: 'equipment-key', state: 'confirmed' };
  rows.briefs[0].essentials.frontIsofix = { value: true, operator: 'equals', unit: null, state: 'inferred' };
  await projectCase('brief-with-list-valued-intent', rows);
}
{ const rows = world(); rows.briefs[0].renewalId = undefined; rows.briefs[0].entitlementSlotId = undefined; await projectCase('brief-without-slot-or-renewal', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', hold: { renewalId: 'renewal-emp-1' } }); await projectCase('hold-renewal-agrees', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'selected', stock: { state: 'released', allocated: true } }); await projectCase('stock-allocated-flag-corroborates-hold', rows); }
{
  const rows = world(); addOffer(rows, 1, { state: 'active', hold: { state: 'allocated' }, stock: { state: 'allocated', allocated: false } });
  await projectCase('stock-allocated-state-corroborates-hold', rows);
}
{ const rows = world(); addOffer(rows, 1, { state: 'active', hold: { state: 'allocated' }, stock: { state: 'released', allocated: false } }); await projectCase('allocated-hold-without-stock-not-selected', rows); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { quoteId: 'quote-1' }, offer: { quoteId: undefined } }); await projectCase('offer-quote-via-hold', rows); }
// ---- 4. every thrown failure ----
{ const rows = world(); rows.decisions.push({ runId: R, decisionId: 'd', offerId: 'missing', employeeId: 'emp-1', decision: 'accept' }); await projectCase('failure-orphan-decision', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active' }); rows.employees = []; await projectCase('failure-missing-employee', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active' }); rows.employees[0].roles = ['greg']; await projectCase('failure-employee-without-role', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active' }); rows.holds.push({ ...rows.holds[0] }); await projectCase('failure-ambiguous-hold', rows, { group: 'failure' }); }
{ const rows = world(['emp-1', 'emp-2']); addOffer(rows, 1, { state: 'active', quote: { employeeId: 'emp-2' } }); await projectCase('failure-owner-mismatch-quote', rows, { group: 'failure' }); }
{ const rows = world(['emp-1', 'emp-2']); addOffer(rows, 1, { state: 'active', hold: { employeeId: 'emp-2' } }); await projectCase('failure-owner-mismatch-hold', rows, { group: 'failure' }); }
{ const rows = world(['emp-1', 'emp-2']); addOffer(rows, 1, { state: 'accepted', decision: 'accept', decisionExtra: { employeeId: 'emp-2' } }); await projectCase('failure-owner-mismatch-decision', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', hold: { quoteId: 'quote-other' } }); await projectCase('failure-reference-mismatch-hold-quote', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { orderUuid: orderOf(99) } }); await projectCase('failure-reference-mismatch-order', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', noOffer: true, hold: { orderUuid: orderOf(98) } }); await projectCase('failure-reference-mismatch-hold-order', rows, { group: 'failure' }); }
for (const [name, o] of [['offer', { briefVersion: 2 }], ['quote', { quoteBriefVersion: 2 }], ['decision', { decision: 'accept', state: 'accepted', decisionBriefVersion: 2 }]]) {
  const rows = world(); addOffer(rows, 1, { state: 'active', ...o }); rows.briefs.push(brief(2, 'suv'));
  if (name === 'offer') rows.briefs = [brief(1)];
  await projectCase(`failure-brief-version-mismatch-${name}`, rows, { group: 'failure' });
}
{ const rows = world(); addOffer(rows, 1, { state: 'active', briefVersion: 0, quoteBriefVersion: 0 }); await projectCase('failure-brief-version-zero', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', briefVersion: undefined, quoteBriefVersion: undefined, offer: { briefVersion: undefined }, quote: { briefVersion: undefined } }); await projectCase('failure-no-brief-version', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', briefVersion: 2 }); await projectCase('failure-missing-confirmed-brief', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active' }); rows.briefs[0].status = 'draft'; await projectCase('failure-brief-not-confirmed', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', quote: { entitlementSlotId: 'different-slot' } }); await projectCase('failure-entitlement-reference-mismatch', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', hold: { renewalId: 'other-renewal' } }); await projectCase('failure-renewal-mismatch', rows, { group: 'failure' }); }
{ const rows = world(['emp-1', 'emp-2']); addOffer(rows, 1, { state: 'active' }); rows.entitlement_slots[0].employeeId = 'emp-2'; await projectCase('failure-slot-owner-mismatch', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'declined', decision: 'accept' }); await projectCase('failure-contradictory-declined-accepted', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'expired', decision: 'accept' }); await projectCase('failure-contradictory-expired-accepted', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'expired', decision: 'select' }); await projectCase('failure-contradictory-expired-selected', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'declined', decision: 'select' }); await projectCase('failure-contradictory-declined-selected', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'expired', decision: 'decline' }); await projectCase('failure-contradictory-declined-expired', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'selection-pending', decision: 'accept' }); await projectCase('failure-contradictory-pending-accepted', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'decision-pending', decision: 'decline' }); await projectCase('failure-contradictory-pending-declined', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'accepted', offer: { offeredAt: at(4), acceptedAt: at(3) } }); await projectCase('failure-event-before-offer', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'expired', offer: { expiredAt: at(0) }, quote: { quotedAt: at(2) } }); await projectCase('failure-event-before-quoted-offer', rows, { group: 'failure' }); }
for (const [name, patch] of [['invalid-instant', { acceptedAt: 'invalid' }], ['future-instant', { acceptedAt: '2026-11-06T09:00:00.000Z' }],
  ['impossible-date', { acceptedAt: '2026-02-30T09:00:00.000Z' }], ['no-offset', { acceptedAt: '2026-11-05T09:03:00' }], ['numeric-time', { acceptedAt: 1762333380000 }],
  ['future-offered', { offeredAt: '2026-11-06T09:00:00.000Z' }], ['future-expired', { expiredAt: '2026-11-06T09:00:00.000Z' }]]) {
  const rows = world(); addOffer(rows, 1, { state: name.endsWith('expired') ? 'expired' : 'accepted', decision: name.endsWith('expired') ? undefined : 'accept', offer: patch });
  await projectCase(`failure-event-time-${name}`, rows, { group: 'failure' });
}
{ const rows = world(); addOffer(rows, 1, { state: 'accepted', decision: 'accept', decisionExtra: { decidedAt: '2026-11-06T09:00:00.000Z' } }); await projectCase('failure-future-decision-time', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'accepted', decision: 'accept' }); rows.receipts.push(decisionReceipt('decision-1', 'not-a-time')); await projectCase('failure-receipt-invalid-time', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'selected' }); rows.receipts.push(receipt('brief-selection:v1', 'e', { offerId: 'offer-1', selectedAt: '2026-12-01T00:00:00.000Z' })); await projectCase('failure-receipt-future-time', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'accepted', decision: 'accept', offer: { acceptedAt: at(3) }, decisionExtra: { decidedAt: at(4) } }); await projectCase('failure-contradictory-event-time-offer-vs-decision', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'rejected', offer: { rejectedAt: at(2), declinedAt: at(3) } }); await projectCase('failure-contradictory-event-time-decline', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', offer: { acceptedAt: at(3) } }); await projectCase('failure-time-without-state', rows, { group: 'failure' }); }
{ const rows = world(); addOffer(rows, 1, { state: 'active', offer: { selectedAt: at(2), pendingAt: at(3) }, hold: { state: 'selection-pending' } }); await projectCase('failure-contradictory-pending-times', rows, { group: 'failure' }); }
{ const rows = world(); rows.briefs[0].preferences.body.importance = 150; await projectCase('failure-invalid-record-importance', rows, { group: 'failure' }); }
{ const rows = world(); rows.briefs[0].preferences.body.value = 'tractor'; await projectCase('failure-invalid-record-body', rows, { group: 'failure' }); }
{ const rows = world(); rows.briefs[0].confirmedAt = '2026-11-06T09:00:00.000Z'; await projectCase('failure-invalid-record-future-brief', rows, { group: 'failure' }); }
{ const rows = world(); rows.briefs[0].policyVersion = ''; await projectCase('failure-invalid-record-policy-version', rows, { group: 'failure' }); }
{ const rows = world(); rows.briefs[0].essentials.seats = { value: 5, operator: 'lte', unit: 'count', state: 'confirmed' }; await projectCase('failure-invalid-record-operator', rows, { group: 'failure' }); }

// ---- 5. deterministic random worlds ----
const stateKinds = [{ state: 'active' }, { state: 'accepted', decision: 'accept' }, { state: 'selected', decision: 'select' }, { state: 'declined', decision: 'decline' },
  { state: 'expired' }, { state: 'selection-pending' }, { state: 'decision-pending' }, { state: 'rejected' }, { state: 'active', decision: 'accept', pending: true }];
for (let n = 0; n < 4; n += 1) {
  const people = pick([['emp-1'], ['emp-1', 'emp-2'], ['emp-2', 'emp-1', 'emp-3']]); const rows = world(people);
  const count = 1 + Math.floor(rnd() * 5);
  for (let i = 1; i <= count; i += 1) {
    const o = { ...pick(stateKinds), employeeId: pick(people) };
    if (o.decision === 'decline') o.reasonCode = pick(['body-style', 'size', 'fuel', 'equipment', 'timing', undefined]);
    if (rnd() < 0.3) o.noOffer = true;
    if (rnd() < 0.15) o.hold = { operationId: 'op' };
    if (rnd() < 0.3) o.offer = { ...(o.offer ?? {}), offeredAt: at(1) };
    addOffer(rows, i, o);
    const id = `decision-${i}`;
    if (o.decision && rnd() < 0.5) rows.receipts.push(decisionReceipt(id, at(2 + Math.floor(rnd() * 5))));
    if (o.state === 'expired' && rnd() < 0.5) rows.receipts.push(receipt('buddy-expiry', `x${i}`, { offerId: `offer-${i}`, expiredAt: at(2 + Math.floor(rnd() * 5)) }));
    if (o.state === 'selected' && rnd() < 0.5) rows.receipts.push(receipt('brief-selection:v1', `s${i}`, { offerId: `offer-${i}`, selectedAt: at(2 + Math.floor(rnd() * 5)) }));
  }
  if (rnd() < 0.5) rows.briefs.push(brief(2, pick(['suv', 'saloon', 'mpv']), pick(people)));
  await projectCase(`random-${n}`, rows, { group: 'random', declines: pick([DECLINES, DECLINES_PLUS]), clock: clockFor({ clockVersion: pick(['clock-v1', 3, 1000]) }) });
}

// ---- 6. validator cases over a known-good projected record and the retained fixture ----
const good = (() => { const rows = world(); addOffer(rows, 1, { state: 'accepted', decision: 'accept' }); return project(clone(rows), { runId: R }, clockFor(), DECLINES.reasons.map((r) => r.code))[0]; })();
const declined = (() => { const rows = world(); addOffer(rows, 1, { state: 'declined', decision: 'decline' }); return project(clone(rows), { runId: R }, clockFor(), DECLINES.reasons.map((r) => r.code))[0]; })();
const retained = JSON.parse(await readFile(join(root, 'server/test/fixtures/gcsp-learning-record.json'), 'utf8'));
const CODES = DECLINES.reasons.map((r) => r.code);
const known = (value) => ({ status: 'known', value });
const termsValue = (over = {}) => ({ quoteRef: 'quote:abc', configurationId: 'RzIxOlMx', monthlyPoints: 1100, allowance: 1300, unit: 'points/month', quotedAt: at(0), validUntil: '2026-11-06T09:00:00.000Z', policyVersion: 'pv', ...over });
const alt = (over = {}) => ({ configurationId: 'RzIxOlMx', eligible: true, available: false, exposure: known({ from: at(0), until: at(2), seconds: 120 }), terms: known(termsValue()), ...over });
const edits = {
  'valid-projected': () => {}, 'valid-fixture-offered-pending': null,
  'extra-top-level': (r) => { r.name = 'PRIVATE'; }, 'extra-preference-field': (r) => { r.brief.preferences.body.source = {}; },
  'object-essential-value': (r) => { r.brief.essentials.seats.value = { personal: 'PRIVATE' }; }, 'extra-outcome-field': (r) => { r.outcomes.satisfaction.score = 99; },
  'extra-choice-set-field': (r) => { r.choiceSet.blob = {}; }, 'extra-provenance-seed-on-observed': (r) => { r.provenance.seed = 1; },
  'score-state': (r) => { r.outcomes.acceptance.state = 'score'; }, 'synthetic-without-generator-version': (r) => { r.provenance = { kind: 'synthetic', seed: 1 }; },
  'accepted-and-expired': (r) => { r.outcomes.expiry.state = 'expired'; },
  'known-config-object': (r) => { r.target.configurationId = known({ blob: true }); },
  'null-record': () => null, 'array-record': () => [], 'string-record': () => 'x', 'empty-record': () => ({}),
  'schema-version-2': (r) => { r.schemaVersion = 2; }, 'schema-version-string': (r) => { r.schemaVersion = '1'; },
  'empty-record-id': (r) => { r.recordId = ''; }, 'long-record-id': (r) => { r.recordId = 'x'.repeat(513); }, 'max-record-id': (r) => { r.recordId = 'x'.repeat(512); },
  'null-slot-ref': (r) => { r.subject.entitlementSlotRef = null; }, 'missing-employee-ref': (r) => { delete r.subject.employeeRef; },
  'null-offer-ref': (r) => { r.target.offerRef = null; }, 'numeric-hold-ref': (r) => { r.target.holdRef = 7; },
  'configuration-id-long-ok': (r) => { r.target.configurationId = known('x'.repeat(2048)); }, 'configuration-id-too-long': (r) => { r.target.configurationId = known('x'.repeat(2049)); },
  'unknown-bad-reason': (r) => { r.target.configurationId = { status: 'unknown', reason: 'because' }; },
  'unknown-with-value': (r) => { r.renewal.cohort = { status: 'unknown', reason: 'not-captured', value: 'x' }; },
  'known-cohort': (r) => { r.renewal.cohort = known('G7'); }, 'known-period': (r) => { r.renewal.period = known({ from: at(0), until: at(5) }); },
  'period-reversed': (r) => { r.renewal.period = known({ from: at(5), until: at(0) }); },
  'entitlement-known': (r) => { r.entitlement = { schemeId: known('S1'), gradeId: known('G7'), allowanceBand: known('1000-1500') }; },
  'entitlement-bad-category': (r) => { r.entitlement.gradeId = known('-bad'); }, 'entitlement-extra-key': (r) => { r.entitlement.extra = known('x'); },
  'brief-version-zero': (r) => { r.brief.briefVersion = 0; }, 'brief-version-fraction': (r) => { r.brief.briefVersion = 1.5; },
  'brief-confirmed-future': (r) => { r.brief.confirmedAt = '2026-11-06T09:00:00.000Z'; }, 'brief-confirmed-bad': (r) => { r.brief.confirmedAt = 'tomorrow'; },
  'preference-unknown-key': (r) => { r.brief.preferences.colour = { value: 'red', importance: 10, valueState: 'confirmed', importanceState: 'confirmed' }; },
  'preference-slider-101': (r) => { r.brief.preferences.comfort = { value: 101, importance: 5, valueState: 'confirmed', importanceState: 'confirmed' }; }, 'preference-slider-fraction': (r) => { r.brief.preferences.body.importance = 10.5; },
  'preference-body-list': (r) => { r.brief.preferences.body.value = ['suv', 'estate']; }, 'preference-body-duplicate': (r) => { r.brief.preferences.body.value = ['suv', 'suv']; },
  'preference-body-empty-list': (r) => { r.brief.preferences.body.value = []; }, 'preference-fuel-bad': (r) => { r.brief.preferences.fuel = { value: 'steam', importance: 1, valueState: 'draft', importanceState: 'inferred' }; },
  'preference-state-bad': (r) => { r.brief.preferences.body.valueState = 'needs-confirmation'; },
  'essential-needs-confirmation-null': (r) => { r.brief.essentials.boot = { value: null, operator: 'gte', unit: 'L', state: 'needs-confirmation' }; },
  'essential-null-confirmed': (r) => { r.brief.essentials.boot = { value: null, operator: 'gte', unit: 'L', state: 'confirmed' }; },
  'essential-negative-seats': (r) => { r.brief.essentials.seats.value = -1; }, 'essential-wrong-unit': (r) => { r.brief.essentials.seats.unit = 'L'; },
  'essential-equipment': (r) => { r.brief.essentials.equipment = { value: ['Heated Seats', 'abc'], operator: 'includes', unit: 'equipment-key', state: 'draft' }; },
  'essential-equipment-bad': (r) => { r.brief.essentials.equipment = { value: ['!'], operator: 'includes', unit: 'equipment-key', state: 'draft' }; },
  'essential-isofix-bool': (r) => { r.brief.essentials.rearIsofix = { value: false, operator: 'equals', unit: null, state: 'inferred' }; },
  'essential-isofix-string': (r) => { r.brief.essentials.rearIsofix = { value: 'yes', operator: 'equals', unit: null, state: 'inferred' }; },
  'essential-charging-ok': (r) => { r.brief.essentials.charging = { value: 'home', operator: 'equals', unit: null, state: 'confirmed' }; },
  'essential-charging-bad': (r) => { r.brief.essentials.charging = { value: 'garage', operator: 'equals', unit: null, state: 'confirmed' }; },
  'essential-model-line': (r) => { r.brief.essentials.modelLine = { value: 'G21 Touring', operator: 'equals', unit: null, state: 'confirmed' }; },
  'essential-unknown-key': (r) => { r.brief.essentials.colour = { value: 'red', operator: 'equals', unit: null, state: 'confirmed' }; },
  'choice-set-known-empty': (r) => { r.choiceSet = known([]); }, 'choice-set-known-one': (r) => { r.choiceSet = known([alt()]); },
  'choice-set-order-ref': (r) => { r.choiceSet = known([alt({ orderRef: 'order:abc' })]); }, 'choice-set-order-ref-bad': (r) => { r.choiceSet = known([alt({ orderRef: '' })]); },
  'choice-set-null-flags': (r) => { r.choiceSet = known([alt({ eligible: null, available: null })]); }, 'choice-set-string-flag': (r) => { r.choiceSet = known([alt({ eligible: 'yes' })]); },
  'choice-set-exposure-unknown': (r) => { r.choiceSet = known([alt({ exposure: { status: 'unknown', reason: 'not-captured' }, terms: { status: 'unknown', reason: 'missing-quote' } })]); },
  'choice-set-exposure-seconds-wrong': (r) => { r.choiceSet = known([alt({ exposure: known({ from: at(0), until: at(2), seconds: 119 }) })]); },
  'choice-set-exposure-fractional-seconds': (r) => { r.choiceSet = known([alt({ exposure: known({ from: '2026-11-05T09:00:00.000Z', until: '2026-11-05T09:00:01.500Z', seconds: 1.5 }) })]); },
  'choice-set-exposure-zero': (r) => { r.choiceSet = known([alt({ exposure: known({ from: at(0), until: at(0), seconds: 0 }) })]); },
  'choice-set-exposure-offset-pair': (r) => { r.choiceSet = known([alt({ exposure: known({ from: '2026-11-05T09:00:00.000Z', until: '2026-11-05T11:02:00.000+02:00', seconds: 120 }) })]); },
  'choice-set-exposure-reversed': (r) => { r.choiceSet = known([alt({ exposure: known({ from: at(2), until: at(0), seconds: -120 }) })]); },
  'choice-set-exposure-extra-key': (r) => { r.choiceSet = known([alt({ exposure: known({ from: at(0), until: at(2), seconds: 120, note: 'x' }) })]); },
  'choice-set-not-array': (r) => { r.choiceSet = known({}); },
  'choice-set-alt-future-terms': (r) => { r.choiceSet = known([alt({ terms: known(termsValue({ quotedAt: '2026-11-06T09:00:00.000Z', validUntil: '2026-11-07T09:00:00.000Z' })) })]); },
  'terms-known': (r) => { r.terms = known(termsValue()); }, 'terms-unknown-quote-missing': (r) => { r.terms = { status: 'unknown', reason: 'missing-quote' }; },
  'terms-extra-key': (r) => { r.terms = known({ ...termsValue(), extra: 1 }); }, 'terms-wrong-unit': (r) => { r.terms = known(termsValue({ unit: 'gbp/month' })); },
  'terms-negative-points': (r) => { r.terms = known(termsValue({ monthlyPoints: -1 })); }, 'terms-valid-until-before': (r) => { r.terms = known(termsValue({ validUntil: '2026-11-04T09:00:00.000Z' })); },
  'terms-future-quote': (r) => { r.terms = known(termsValue({ quotedAt: '2026-11-06T09:00:00.000Z', validUntil: '2026-11-07T09:00:00.000Z' })); },
  'terms-fractional-points': (r) => { r.terms = known(termsValue({ monthlyPoints: 1100.5 })); },
  'outcomes-state-offered-with-time': (r) => { r.outcomes.offered = { state: 'offered', at: at(1) }; },
  'outcomes-unknown-with-time': (r) => { r.outcomes.selection = { state: 'unknown', at: at(1) }; },
  'outcomes-time-future': (r) => { r.outcomes.acceptance.at = '2026-11-06T09:00:00.000Z'; }, 'outcomes-time-invalid': (r) => { r.outcomes.acceptance.at = 'now'; },
  'outcomes-time-at-projected': (r) => { r.outcomes.acceptance.at = NOW; },
  'outcomes-independent-times-ok': (r) => { r.outcomes.selection = { state: 'selected', at: at(2) }; r.outcomes.acceptance.at = at(1); },
  'outcomes-offered-pending-selection': (r) => { r.outcomes.acceptance = { state: 'pending', at: null }; r.outcomes.selection = { state: 'pending', at: null }; },
  'outcomes-pending-and-accepted': (r) => { r.outcomes.selection = { state: 'pending', at: null }; },
  'outcomes-selected-declined': (r) => { r.outcomes.selection = { state: 'selected', at: null }; r.outcomes.acceptance = { state: 'unknown', at: null }; r.outcomes.decline = { state: 'declined', at: null, reasonType: 'unclassified' }; },
  'outcomes-expired-selected': (r) => { r.outcomes.acceptance = { state: 'unknown', at: null }; r.outcomes.selection = { state: 'selected', at: null }; r.outcomes.expiry = { state: 'expired', at: null }; },
  'outcomes-missing-key': (r) => { delete r.outcomes.satisfaction; }, 'outcomes-extra-key': (r) => { r.outcomes.mood = { state: 'unknown', at: null }; },
  'outcomes-satisfied': (r) => { r.outcomes.satisfaction = { state: 'satisfied', at: at(4) }; },
  'outcomes-dissatisfied-unknown-at': (r) => { r.outcomes.satisfaction = { state: 'dissatisfied', at: null }; },
  'outcomes-decline-reason-without-decline': (r) => { r.outcomes.decline.reasonType = 'size'; },
  'outcomes-decline-null-reason': (r) => { r.outcomes.decline = { state: 'declined', at: null, reasonType: null }; r.outcomes.acceptance = { state: 'unknown', at: null }; },
  'outcomes-decline-unclassified': (r) => { r.outcomes.decline = { state: 'declined', at: null, reasonType: 'unclassified' }; r.outcomes.acceptance = { state: 'unknown', at: null }; },
  'outcomes-wait-reason-wrong': (r) => { r.outcomes.wait = { state: 'waited', at: null, reasonType: 'impatient' }; },
  'outcomes-wait-without-reason': (r) => { r.outcomes.wait = { state: 'unknown', at: null, reasonType: 'no-acceptable-choice' }; },
  'timestamps-projected-bad': (r) => { r.timestamps.projectedAt = 'later'; }, 'timestamps-clock-string': (r) => { r.timestamps.clockVersion = 'clock-v1'; },
  'timestamps-clock-zero': (r) => { r.timestamps.clockVersion = 0; }, 'timestamps-clock-empty': (r) => { r.timestamps.clockVersion = ''; },
  'timestamps-clock-fraction': (r) => { r.timestamps.clockVersion = 1.5; }, 'timestamps-extra-key': (r) => { r.timestamps.extra = 1; },
  'synthetic-ok': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: 'test-only', seed: 1 }; },
  'synthetic-string-seed': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: 'test-only', seed: 'abc' }; },
  'synthetic-negative-seed-ok': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: 'test-only', seed: -5 }; },
  'synthetic-fractional-seed': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: 'test-only', seed: 1.5 }; },
  'synthetic-without-seed': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: 'test-only' }; },
  'synthetic-empty-generator': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: '', seed: 1 }; },
  'synthetic-extra-key': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: 'g', seed: 1, note: 'x' }; },
  'provenance-unknown-kind': (r) => { r.provenance = { kind: 'estimated' }; }, 'provenance-null': (r) => { r.provenance = null; },
  'provenance-missing': (r) => { delete r.provenance; },
  'synthetic-with-observed-decline-type': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: 'g', seed: 1 }; r.outcomes.acceptance = { state: 'unknown', at: null };
    r.outcomes.decline = { state: 'declined', at: null, reasonType: 'body-style' }; },
  'synthetic-with-synthetic-decline-type': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: 'g', seed: 1 }; r.outcomes.acceptance = { state: 'unknown', at: null };
    r.outcomes.decline = { state: 'declined', at: null, reasonType: 'just-not-this-one' }; },
  'observed-with-synthetic-decline-type': (r) => { r.outcomes.acceptance = { state: 'unknown', at: null }; r.outcomes.decline = { state: 'declined', at: null, reasonType: 'just-not-this-one' }; },
  'synthetic-wait-evaluation-limit': (r) => { r.provenance = { kind: 'synthetic', generatorVersion: 'g', seed: 'run-7' };
    r.outcomes = { offered: { state: 'unknown', at: null }, selection: { state: 'unknown', at: null }, acceptance: { state: 'unknown', at: null },
      decline: { state: 'unknown', at: null, reasonType: null }, expiry: { state: 'unknown', at: null }, wait: { state: 'waited', at: null, reasonType: 'no-acceptable-choice' },
      satisfaction: { state: 'unknown', at: null } }; },
};
for (const field of ['offered', 'selection', 'acceptance', 'decline', 'expiry']) {
  edits[`waited-with-${field}`] = (r) => {
    for (const value of Object.values(r.outcomes)) { value.state = 'unknown'; value.at = null; if ('reasonType' in value) value.reasonType = null; }
    r.outcomes.wait = { state: 'waited', at: null, reasonType: 'no-acceptable-choice' };
    r.outcomes[field].state = { offered: 'offered', selection: 'selected', acceptance: 'accepted', decline: 'declined', expiry: 'expired' }[field];
    if (field === 'decline') r.outcomes.decline.reasonType = 'unclassified';
  };
}
edits['waited-alone'] = (r) => {
  for (const value of Object.values(r.outcomes)) { value.state = 'unknown'; value.at = null; if ('reasonType' in value) value.reasonType = null; }
  r.outcomes.wait = { state: 'waited', at: null, reasonType: 'no-acceptable-choice' };
};
const validatorOut = (record, codes) => {
  const out = validateLearningRecord(record, codes === undefined ? undefined : { declineReasonCodes: codes });
  return out.status === 'ok' ? { status: 'ok' } : { status: out.status, code: out.code, reasons: out.reasons };
};
const bases = { good, declined, retained };
const validations = [];
const pushValidate = (name, baseName, record, codeSets) => {
  const ops = diff(bases[baseName], record);
  assert.deepEqual(apply(bases[baseName], ops), record, name);
  validations.push({ kind: 'validate', name, base: baseName, ops, runs: codeSets.map((codes) => ({ declineReasonCodes: codes ?? null, expected: validatorOut(record, codes) })) });
};
for (const [name, edit] of Object.entries(edits)) {
  if (edit === null) continue;
  let record = clone(good); const replaced = edit(record); if (replaced !== undefined) record = replaced;
  pushValidate(name, 'good', record, [undefined, CODES]);
}
pushValidate('retained-fixture', 'retained', retained, [undefined, CODES]);
pushValidate('observed-decline-body-style', 'declined', declined, [undefined, [], CODES, ['body-style']]);
{ const r = clone(declined); r.outcomes.decline.reasonType = 'timing'; pushValidate('observed-decline-timing', 'declined', r, [undefined, CODES]); }
{ const r = clone(declined); r.outcomes.decline.reasonType = 'unclassified'; pushValidate('observed-decline-unclassified', 'declined', r, [undefined, CODES]); }
{ const r = clone(declined); r.outcomes.decline.reasonType = 'just-not-this-one'; pushValidate('observed-decline-synthetic-type', 'declined', r, [CODES]); }
{ const r = clone(declined); r.provenance = { kind: 'synthetic', generatorVersion: 'g', seed: 1 }; r.outcomes.decline.reasonType = 'unclassified'; pushValidate('synthetic-decline-unclassified', 'declined', r, [undefined]); }
// validator ok-outcomes carry the validated clone, so the retained fixture is also recorded verbatim for the Java file check
cases.push(...validations);
const counts = {}; for (const c of cases) counts[c.kind] = (counts[c.kind] ?? 0) + 1;
const outcomes = {}; for (const c of cases) for (const e of c.kind === 'validate' ? c.runs.map((r) => r.expected) : [c.expected]) { const k = `${c.kind}:${e.status}`; outcomes[k] = (outcomes[k] ?? 0) + 1; }
const errors = {}; for (const c of cases) if (c.expected?.error) errors[c.expected.error] = (errors[c.expected.error] ?? 0) + 1;
const file = { generator: { source: ['services/gcsp-api/src/test/parity/learning-records-parity.mjs', 'server/gcsp/predict/records/schema.js', 'server/gcsp/predict/records/observed.js'],
  gitShortSha: sha }, bases, rowBases: ROW_BASES, baseRecord: BASE_RECORD, counts, outcomes, failures: errors, cases };
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, `${JSON.stringify(file)}\n`);
await rm(scratch, { recursive: true, force: true });
console.log(JSON.stringify({ counts, outcomes, failures: errors, bytes: JSON.stringify(file).length }));
