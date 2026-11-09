// Fictional, synthetic order-progress examples in the producer shapes (FUCQ-111, 114, 116, 118). Not integration evidence.
const ORDER = '00000000-0000-4000-8000-000000000001';
const RUN = 'demo-run-example';
const EMPLOYEE = 'employee-paula';
const CONTRACT = '1.0.0';
const env = (value) => ({ status: 'ok', value, contractVersion: CONTRACT });
const refusal = (status, extra) => ({ status, ...extra, contractVersion: CONTRACT });
const unavailable = (reason) => refusal('unavailable', { retryable: true, reason });

const REF = { 'HR approval': 'hr', 'sales-manager approval': 'sm', 'sent to ordering': 'sto' };
const t = (hour, day = 5) => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;

function approval({ revision, asOf, hr = true, steps, currentStage, owner, nextStep, outcome, blocked = null, validated = false, live = false }) {
  const approvalStages = hr ? ['HR approval', 'sales-manager approval', 'sent to ordering'] : ['sales-manager approval', 'sent to ordering'];
  const stages = [{ stage: 'selection received', state: 'approved', at: t(9), providerReference: 'synthetic-ordering:v1:selection:example', operationId: 'selection:example' },
    ...approvalStages.map((stage, index) => {
      const [state, at = null] = steps[index]; const started = state !== 'not-started';
      return { stage, state, at: started ? at : null,
        providerReference: state === 'approved' || state === 'declined' ? `synthetic-ordering-status:v1:lifecycle-approval:${REF[stage]}` : null,
        operationId: started ? `lifecycle-approval:${REF[stage]}` : null };
    })];
  return env({ contractVersion: 'lifecycle.stages.v1', schemaVersion: 1, runId: RUN, orderUuid: ORDER, employeeId: EMPLOYEE, entitlementSlotId: 'slot-paula',
    renewalId: validated ? 'renewal:employee-paula' : null, renewalAuthority: validated ? 'validated' : 'missing', route: 'manual',
    source: { operationId: 'selection:example', operationType: 'selection-order', sourceType: 'cart', holdId: 'hold-1', orderReference: 'GCSP-000123', orderNumber: '1000001',
      configurationId: 'config-1', receivedAt: t(9), quoteId: 'quote-1', termsVersion: 'fictional-order-terms-v1', termsDigest: 'f'.repeat(64),
      approvalStages, policyVersion: 'gcsp-policy-v1', operationVersion: 2, providerReference: 'synthetic-ordering:v1:selection:example' },
    policyVersion: 'gcsp-policy-v1',
    policy: { policyVersion: 'gcsp-policy-v1', provenance: ['ordering.approvalStages.v1', 'lifecycle.approval.ticks.v1', 'lifecycle.approval.declineScenario.v1',
      'lifecycle.approval.ownership.v1'].map((key) => ({ key, status: 'assumed', source: key.startsWith('ordering') ? 'docs/gcsp/manual-order-contract.md'
        : 'docs/gcsp/shared-contracts.md#lifecycle-approval-stages--fucq-111', sourceDate: key.startsWith('ordering') ? '2026-11-05' : '2026-11-06' })) },
    lifecycleRevision: revision, asOf, stageList: ['selection received', ...approvalStages], currentStage, stages, owner, nextStep, outcome, blocked,
    provider: live ? { mode: 'live', provider: 'live-ordering-status:stub', synthetic: false } : { mode: 'synthetic', provider: 'synthetic-ordering-status:v1', synthetic: true } });
}

const pendingHr = () => approval({ revision: 1, asOf: t(10), steps: [['pending', t(10)], ['not-started'], ['not-started']], currentStage: 'HR approval', owner: 'HR', nextStep: 'HR decision', outcome: 'in-progress' });
const pendingSm = () => approval({ revision: 2, asOf: t(12), steps: [['approved', t(11)], ['pending', t(11)], ['not-started']], currentStage: 'sales-manager approval',
  owner: 'sales manager', nextStep: 'Sales-manager decision', outcome: 'in-progress' });
// An order from before references: the server projects `orderReference: null`.
const earlierOrder = () => { const stages = pendingSm(); stages.value.source.orderReference = null; return stages; };
const noHr = () => approval({ revision: 2, asOf: t(12), hr: false, steps: [['pending', t(11)], ['not-started']], currentStage: 'sales-manager approval',
  owner: 'sales manager', nextStep: 'Sales-manager decision', outcome: 'in-progress' });
const declined = () => approval({ revision: 3, asOf: t(14), steps: [['approved', t(11)], ['declined', t(13)], ['not-started']], currentStage: 'sales-manager approval',
  owner: 'scheme team', nextStep: 'Scheme team reviews the decline', outcome: 'declined', validated: true });
const unsupported = () => approval({ revision: 1, asOf: t(12), steps: [['pending', t(11)], ['not-started'], ['not-started']], currentStage: 'HR approval', owner: 'HR',
  nextStep: 'HR decision', outcome: 'in-progress', live: true,
  blocked: { code: 'live-ordering-unsupported', reason: 'Live approval updates are not connected in this demonstration. The order stays at its current step.' } });
const sent = () => approval({ revision: 4, asOf: t(15), steps: [['approved', t(11)], ['approved', t(13)], ['approved', t(14)]], currentStage: 'sent to ordering',
  owner: 'ordering', nextStep: 'Appointment to be arranged', outcome: 'sent-to-ordering' });

// Documents (FUCQ-116). Items follow the keyed policy rows; employee items carry the action text.
const ASSUMPTION = { key: 'lifecycle.documents.v1', status: 'assumed', unit: 'document and readiness item registry; seconds of demo-clock time',
  basis: 'Synthetic documents and readiness steps after an order is sent to ordering. Not BMW policy.', source: 'docs/gcsp/shared-contracts.md#lifecycle-documents-and-readiness--fucq-116',
  sourceDate: '2026-11-06', policyVersion: 'gcsp-policy-v1' };
const REGISTRY = [['agreement-acknowledgement', 'document', 'Vehicle agreement', 'employee', 'Acknowledge the agreement', 2 * 24],
  ['licence-check', 'document', 'Driving licence check', 'scheme-team', null, 24], ['vehicle-preparation', 'readiness', 'Vehicle preparation', 'retailer', null, 3 * 24],
  ['delivery-to-retailer', 'readiness', 'Delivery to the retailer', 'retailer', null, 5 * 24]];
const ACK = { kind: 'synthetic-acknowledgement', label: 'Synthetic acknowledgement. Not a signature.', at: t(16), actorId: 'demo-paula' };

function documents({ now, status, overdue = [], reasons = {}, ready = false }) {
  const opened = t(15);
  const items = REGISTRY.map(([itemId, kind, label, owner, action, hours]) => {
    const state = status[itemId]; const dueAt = new Date(Date.parse(opened) + hours * 3600000).toISOString();
    return { itemId, kind, label, owner, status: state, dueAt, providerReference: state === 'complete' && owner !== 'employee' ? `synthetic-ordering:documents:v1:${itemId}` : null,
      reason: reasons[itemId] ?? null, completedAt: state === 'complete' ? t(16) : null, ...(action ? { action } : {}),
      ...(state === 'complete' && owner === 'employee' ? { acknowledgement: ACK } : {}),
      assumption: { key: ASSUMPTION.key, itemId, status: 'assumed', basis: 'Synthetic demo assumption.', synthetic: true }, overdue: overdue.includes(itemId) };
  });
  const documentsComplete = items.filter((i) => i.kind === 'document').every((i) => i.status === 'complete');
  const vehicleReady = items.filter((i) => i.kind === 'readiness').every((i) => i.status === 'complete');
  const failed = items.filter((i) => i.status === 'failed').map((i) => i.itemId);
  const order = { contractVersion: 'lifecycle.documents.v1', runId: RUN, orderUuid: ORDER, employeeId: EMPLOYEE, documentsRevision: 1, policyVersion: 'gcsp-policy-v1',
    openedAt: opened, opening: { contractVersion: 'lifecycle.stages.v1', stage: 'sent to ordering', state: 'approved', stageAt: t(14), providerReference: 'synthetic-ordering-status:v1:lifecycle-approval:sto',
      lifecycleRevision: 4, stagePolicyVersion: 'gcsp-policy-v1' },
    lastObservedRevision: 4, providerMode: 'synthetic', items,
    tasks: items.filter((i) => i.owner === 'employee').map((i) => ({ itemId: i.itemId, label: i.label, action: i.action, status: i.status, dueAt: i.dueAt, overdue: i.overdue,
      actionable: i.status === 'waiting-for-employee', acknowledgement: i.acknowledgement ?? null })),
    readiness: { ready: ready && documentsComplete && vehicleReady, state: ready ? 'ready' : failed.length ? 'failed' : 'waiting', documentsComplete, vehicleReady,
      blocking: items.filter((i) => i.status !== 'complete').map((i) => i.itemId), failed },
    assumptions: [ASSUMPTION], fictional: true };
  return env({ contractVersion: 'lifecycle.documents.v1', now, orders: [order] });
}
const notOpen = () => env({ orderUuid: ORDER, opened: false, ready: false, state: 'not-open', reason: 'opening-stage-not-reached', documentsComplete: false, vehicleReady: false });
const WAITING = { 'agreement-acknowledgement': 'waiting-for-employee', 'licence-check': 'in-progress', 'vehicle-preparation': 'not-started', 'delivery-to-retailer': 'not-started' };
const docsWaiting = () => documents({ now: t(18), status: WAITING });
const docsProgress = () => documents({ now: t(18), status: { ...WAITING, 'agreement-acknowledgement': 'complete', 'licence-check': 'complete', 'vehicle-preparation': 'in-progress' } });
const docsReady = () => documents({ now: t(18, 12), ready: true, status: Object.fromEntries(REGISTRY.map(([id]) => [id, 'complete'])) });

// Appointment (FUCQ-114). Slots are 60 minutes at 09:00 and 13:00 UTC, as the keyed policy offers.
const two = (n) => String(n).padStart(2, '0');
const slot = (day, hour) => ({ slotId: `slot-202611${two(day)}t${two(hour)}00`, start: `2026-11-${two(day)}T${two(hour)}:00:00.000Z`, end: `2026-11-${two(day)}T${two(hour + 1)}:00:00.000Z` });
const OFFERED = [slot(8, 9), slot(8, 13), slot(9, 9), slot(9, 13), slot(10, 9), slot(10, 13)];
const row = (state, at) => ({ state, at, providerReference: `synthetic-appointments:v1:${state}` });
const OWNERS = { 'not-requested': ['employee', 'Choose a handover slot.'], requested: ['retailer', 'Waiting for the retailer to confirm your slot.'],
  'change-proposed': ['employee', 'Accept the new time to confirm your handover.'], scheduled: ['retailer', 'The retailer prepares your car for the handover.'],
  completed: ['employee', 'Your handover is complete.'], 'no-show': ['employee', 'Your handover was missed. Choose a new slot to rebook.'],
  ineligible: ['scheme-team', 'Waiting for your order to be sent to ordering.'], pending: ['scheme-team', 'Waiting for the scheme team to confirm the last update.'] };

function appointmentValue({ state, key = state, slot: confirmed = null, requestedSlot = null, proposedSlot = null, proposalId = null, history = [], pending = null,
  offeredSlots = [], eligible = true, outcome = null, attempt = 1, previousAttempts = [] }) {
  const [owner, nextStep] = OWNERS[key];
  return { contractVersion: 'lifecycle.appointments.v1', runId: RUN, orderUuid: ORDER, employeeId: EMPLOYEE, state, booked: state === 'scheduled', slot: confirmed, requestedSlot,
    proposedSlot, proposalId, history, owner, nextStep, pending, blocked: null, offeredSlots,
    eligibility: eligible ? { eligible: true, code: null, reason: null } : { eligible: false, code: 'opening-stage-not-reached', reason: 'Your order has not been sent to ordering yet.' },
    policyVersion: 'gcsp-policy-v1', assumptions: [{ key: 'lifecycle.appointments.slots.v1', status: 'assumed', unit: 'days; minutes; UTC HH:MM start times',
      basis: 'Synthetic slot rules. Not BMW policy.', source: 'docs/gcsp/shared-contracts.md#lifecycle-appointments--fucq-114', sourceDate: '2026-11-06', policyVersion: 'gcsp-policy-v1' }],
    outcome, attempt, previousAttempts, provider: { mode: 'synthetic', synthetic: true }, fictional: true };
}
const apptClosed = () => env(appointmentValue({ state: 'not-requested', key: 'ineligible', eligible: false }));
const apptOpen = () => env(appointmentValue({ state: 'not-requested', offeredSlots: OFFERED }));
const apptRequested = () => env(appointmentValue({ state: 'requested', requestedSlot: OFFERED[0], history: [row('requested', t(16))] }));
const apptProposed = () => env(appointmentValue({ state: 'change-proposed', requestedSlot: OFFERED[0], proposedSlot: OFFERED[1], proposalId: 'proposal-1',
  history: [row('requested', t(16)), row('change-proposed', t(17))] }));
const apptPending = () => env(appointmentValue({ state: 'requested', key: 'pending', requestedSlot: OFFERED[0], pending: { step: 'confirm', reason: 'Waiting for the provider to confirm the last update.' },
  history: [row('requested', t(16))] }));
const apptScheduled = () => env(appointmentValue({ state: 'scheduled', slot: OFFERED[0], requestedSlot: OFFERED[0], history: [row('requested', t(16)), row('scheduled', t(17))] }));
// FUCQ-167 outcomes: the missed handover keeps its slot; Paula rebooks as attempt 2 and the miss stays in previousAttempts.
const apptCompleted = () => env(appointmentValue({ state: 'completed', slot: OFFERED[0], requestedSlot: OFFERED[0], outcome: row('completed', t(10, 8)),
  history: [row('requested', t(16)), row('scheduled', t(17)), row('completed', t(10, 8))] }));
const NO_SHOW_HISTORY = [row('requested', t(16)), row('scheduled', t(17)), row('no-show', t(10, 8))];
const apptNoShow = () => env(appointmentValue({ state: 'no-show', slot: OFFERED[0], requestedSlot: OFFERED[0], outcome: row('no-show', t(10, 8)), history: NO_SHOW_HISTORY,
  offeredSlots: [slot(9, 9), slot(9, 13), slot(10, 9)] }));
const apptRebooked = () => env(appointmentValue({ state: 'requested', requestedSlot: slot(9, 9), attempt: 2, history: [...NO_SHOW_HISTORY, row('requested', t(11, 8))],
  previousAttempts: [{ attempt: 1, state: 'no-show', slot: OFFERED[0], outcome: row('no-show', t(10, 8)) }] }));
const apptOutcomePending = () => env(appointmentValue({ state: 'scheduled', key: 'pending', slot: OFFERED[0], requestedSlot: OFFERED[0],
  pending: { step: 'complete', reason: 'Waiting for the provider to confirm the last update.' }, history: [row('requested', t(16)), row('scheduled', t(17))] }));

// Return plan (FUCQ-118). A replacement order only; the handover must be scheduled before a choice opens.
const CURRENT_CAR = { contractId: 'current:employee-paula', slotId: 'slot-paula', status: 'current', model: 'Fictional BMW 320i Touring',
  vehicle: { configuration: 'G21 320i M Sport Touring', body: 'estate', fuel: 'petrol', seats: 5 }, source: 'account' };
const CHOICES = [{ id: 'same-visit', label: 'Return it when the new car is handed over' }, { id: 'separate', label: 'Return it on a separate day' }];
const RETURN_OWNERS = { 'not-planned': ['employee', "Confirm your new car's handover first, then plan the return."], requested: ['retailer', 'Waiting for the retailer to confirm your return slot.'],
  'change-proposed': ['employee', 'Accept the new time to confirm your return.'], scheduled: ['retailer', 'Keep driving your current car until the return.'] };
const RETURN_SLOTS = [slot(12, 9), slot(12, 13), slot(13, 9)];
const returnRow = (state, appointmentState, at) => ({ state, appointmentState, at, providerReference: `synthetic-appointments:v1:return:${appointmentState}` });
const RETURN_PLAN_STATE = { 'not-requested': 'not-planned', requested: 'return-requested', 'change-proposed': 'return-requested', scheduled: 'return-scheduled' };

const HOME = (label) => ({ locationId: null, kind: 'home-address', label, rule: 'home-address' });
// FUCQ-168 current-car relationship before any confirmed handover or return.
const relationship = (replacement, extra = {}) => ({ contractVersion: 'lifecycle.current-car.v1', runId: RUN, orderUuid: ORDER, employeeId: EMPLOYEE,
  currentCar: replacement ? { kind: 'contract', contractId: CURRENT_CAR.contractId, slotId: 'slot-paula' } : null,
  oldCar: replacement ? { contractId: CURRENT_CAR.contractId, slotId: 'slot-paula', status: 'held', returnedAt: null, providerReference: null, location: null } : null,
  newCar: { orderUuid: ORDER, configurationId: null, status: 'on-order', collectedAt: null, vin: null, providerReference: null }, changes: [], fictional: true, ...extra });
function returnValue({ appt, handoverReady = true, slot: confirmed = null, requestedSlot = null, proposedSlot = null, proposalId = null, history = [], choice = null, location,
  outcome = null, car = null, pending = null, blocked = null }) {
  const planned = appt !== 'not-requested'; const [owner, nextStep] = RETURN_OWNERS[appt === 'not-requested' ? 'not-planned' : appt];
  const idle = !planned && !handoverReady;
  const choices = CHOICES.map(({ id, label }) => ({ id, label, available: !planned && handoverReady,
    reason: planned ? 'Your return is already planned.' : handoverReady ? null : "Confirm your new car's handover first.", selected: choice === id }));
  const handoverSlot = OFFERED[0]; const place = location ?? { locationId: 'handover-retailer', kind: 'collection-location', label: 'Fictional BMW retailer', rule: choice ? 'handover-retailer' : null };
  const [outOwner, outNext] = outcome ? RETURN_OUTCOME_OWNERS[outcome.state] : [];
  return { contractVersion: 'lifecycle.return-plan.v1', runId: RUN, orderUuid: ORDER, employeeId: EMPLOYEE, applicable: true, state: outcome ? outcome.state : RETURN_PLAN_STATE[appt],
    scheduled: appt === 'scheduled' && !outcome, oldContractId: CURRENT_CAR.contractId, vehicleSlotId: 'slot-paula', currentCar: CURRENT_CAR,
    returnMileage: { value: 5200, unit: 'mi', recordedAt: t(9), source: 'selection' }, choice,
    location: place,
    appointment: { contractVersion: 'lifecycle.appointments.v1', purpose: 'return', runId: RUN, orderUuid: ORDER, employeeId: EMPLOYEE, state: appt, booked: appt === 'scheduled',
      slot: confirmed, requestedSlot, proposedSlot, proposalId, history: history.map((h) => ({ state: h.appointmentState, at: h.at, providerReference: h.providerReference })),
      owner, nextStep, pending: null, blocked: null, eligibility: { eligible: true, code: null, reason: null }, plan: choice ? { choice } : null,
      provider: { mode: 'synthetic', synthetic: true }, fictional: true },
    handover: { state: handoverReady ? 'scheduled' : 'requested', booked: handoverReady, slot: handoverReady ? handoverSlot : null, providerReference: 'synthetic-appointments:v1:handover' },
    slot: confirmed, requestedSlot, proposedSlot, proposalId, providerReference: history.at(-1)?.providerReference ?? null,
    history: outcome ? [...history, { state: outcome.state, appointmentState: null, at: outcome.at, providerReference: outcome.providerReference }] : history,
    owner: outOwner ?? (pending ? 'scheme-team' : idle ? 'employee' : owner), nextStep: outNext ?? (pending ? 'Waiting for the scheme team to confirm the last update.' : nextStep),
    pending, blocked, choices,
    offeredSlots: { 'same-visit': !planned && handoverReady ? [handoverSlot] : [], separate: !planned && handoverReady ? RETURN_SLOTS : [] },
    outcome: outcome && { state: outcome.state, at: outcome.at, location: place, oldContractId: CURRENT_CAR.contractId, providerReference: outcome.providerReference,
      appointment: { purpose: 'return', slotId: confirmed.slotId, slot: confirmed, providerReference: 'synthetic-appointments:v1:return:scheduled' } },
    relationship: car ?? relationship(true), policyVersion: 'gcsp-policy-v1', assumptions: [{ key: 'lifecycle.return.options.v1', status: 'assumed', unit: 'choice IDs with labels; handover states; days; minutes',
      basis: 'Synthetic return choices. Not BMW policy.', source: 'docs/gcsp/shared-contracts.md#lifecycle-return-plan--fucq-118', sourceDate: '2026-11-07', policyVersion: 'gcsp-policy-v1' }],
    fictional: true };
}
const newOrder = () => env({ contractVersion: 'lifecycle.return-plan.v1', runId: RUN, orderUuid: ORDER, employeeId: EMPLOYEE, applicable: false, state: null, scheduled: false,
  oldContractId: null, vehicleSlotId: null, currentCar: null, returnMileage: null, choice: null, location: null, appointment: null, handover: null, slot: null,
  requestedSlot: null, proposedSlot: null, proposalId: null, providerReference: null, history: [], owner: null, nextStep: null, pending: null, blocked: null, choices: [],
  offeredSlots: {}, outcome: null, relationship: relationship(false), policyVersion: 'gcsp-policy-v1', assumptions: [], fictional: true });
const retWaiting = () => env(returnValue({ appt: 'not-requested', handoverReady: false }));
const retOpen = () => env(returnValue({ appt: 'not-requested' }));
const retRequested = () => env(returnValue({ appt: 'requested', choice: 'separate', requestedSlot: RETURN_SLOTS[0], history: [returnRow('return-requested', 'requested', t(18))] }));
const retProposed = () => env(returnValue({ appt: 'change-proposed', choice: 'separate', requestedSlot: RETURN_SLOTS[0], proposedSlot: RETURN_SLOTS[1], proposalId: 'return-proposal-1',
  history: [returnRow('return-requested', 'requested', t(18)), returnRow('return-requested', 'change-proposed', t(19))] }));
const retScheduled = () => env(returnValue({ appt: 'scheduled', choice: 'separate', slot: RETURN_SLOTS[0], requestedSlot: RETURN_SLOTS[0],
  history: [returnRow('return-requested', 'requested', t(18)), returnRow('return-scheduled', 'scheduled', t(19))] }));

// FUCQ-168 outcomes: the slot ends 12 Nov 10:00 and the keyed delay puts the outcome at 10:30. The current car follows the relationship, not the plan state.
const RETURN_OUTCOME_OWNERS = { returned: ['retailer', 'Your current car has been returned. Nothing more is needed from you.'],
  'return-missed': ['scheme-team', 'The scheme team will contact you to rearrange the return of your current car.'] };
const RETURN_HISTORY = [returnRow('return-requested', 'requested', t(18)), returnRow('return-scheduled', 'scheduled', t(19))];
const outcomeOf = (state, ref) => ({ state, at: '2026-11-12T10:30:00.000Z', providerReference: ref });
const change = (type, at, purpose) => ({ type, at, providerReference: `SYN-${purpose}-0001`, appointment: { purpose, slotId: purpose === 'return' ? RETURN_SLOTS[0].slotId : OFFERED[0].slotId,
  providerReference: `synthetic-appointments:v1:${purpose}:scheduled` } });
const heldCar = (vin) => relationship(true, { currentCar: { kind: 'order', orderUuid: ORDER, vin },
  newCar: { orderUuid: ORDER, configurationId: null, status: 'collected', collectedAt: t(10, 8), vin, providerReference: 'SYN-HAN-0001' }, changes: [change('handover-completed', t(10, 8), 'handover')] });
const returnedCar = (current) => {
  const base = current ? heldCar(null) : relationship(true);
  const old = { ...base.oldCar, status: 'returned', returnedAt: '2026-11-12T10:30:00.000Z', providerReference: 'SYN-RET-0001', location: { locationId: 'handover-retailer', kind: 'collection-location', label: 'Fictional BMW retailer', rule: 'handover-retailer' } };
  return { ...base, currentCar: current ? base.currentCar : null, oldCar: old, changes: [...base.changes, change('return-confirmed', '2026-11-12T10:30:00.000Z', 'return')] };
};
const scheduledReturn = (extra = {}) => returnValue({ appt: 'scheduled', choice: 'separate', slot: RETURN_SLOTS[0], requestedSlot: RETURN_SLOTS[0], history: RETURN_HISTORY, ...extra });
const retReturned = () => env(scheduledReturn({ outcome: outcomeOf('returned', 'SYN-RET-0001'), car: returnedCar(true) }));
const retReturnedFirst = () => env(scheduledReturn({ outcome: outcomeOf('returned', 'SYN-RET-0001'), car: returnedCar(false) }));
const retMissed = () => env(scheduledReturn({ outcome: outcomeOf('return-missed', 'SYN-RET-0001') }));
const retHandoverDone = () => env(scheduledReturn({ car: heldCar('ZZSYNTHETICVIN0001') }));
const retOutcomePending = () => env(scheduledReturn({ pending: { step: 'outcome', reason: 'Waiting for the provider to confirm the last update.' } }));
const retRefused = () => env(scheduledReturn({ blocked: { code: 'live-return-outcomes-unsupported', reason: 'Live return confirmation is not connected in this mode.' } }));

const ready = (stages, docs, appointment, returnPlan = newOrder()) => ({ phase: 'ready', stages, documents: docs, appointment, returnPlan });
const early = (stages) => ready(stages, notOpen(), apptClosed());
const afterSent = (docs, appointment, returnPlan) => ready(sent(), docs, appointment, returnPlan);

/** One progress object per state, plus the fictional car the host would supply. Built fresh so a caller may mutate its copy. */
export function orderProgressFixtures() {
  return {
    source: 'Synthetic, fictional examples in the shapes of the FUCQ-111, 114, 116 and 118 producers. Not integration evidence.',
    car: { name: 'Fictional BMW i4 eDrive40 M Sport', photo: undefined, line: 'Fictional example' },
    states: {
      'waiting-hr': early(pendingHr()), 'waiting-sales-manager': early(pendingSm()), 'no-hr': early(noHr()), 'earlier-order': early(earlierOrder()), declined: early(declined()), 'provider-unsupported': early(unsupported()),
      'sent-to-ordering-no-slot': afterSent(docsWaiting(), apptOpen()),
      'appointment-requested': afterSent(docsWaiting(), apptRequested()), 'appointment-change-proposed': afterSent(docsWaiting(), apptProposed()),
      'appointment-pending': afterSent(docsWaiting(), apptPending()), 'appointment-scheduled': afterSent(docsProgress(), apptScheduled()),
      'appointment-completed': afterSent(docsReady(), apptCompleted()), 'appointment-no-show': afterSent(docsReady(), apptNoShow()),
      'appointment-rebooked': afterSent(docsReady(), apptRebooked()), 'appointment-outcome-pending': afterSent(docsReady(), apptOutcomePending()),
      'documents-waiting-for-you': afterSent(docsWaiting(), apptScheduled()), 'documents-in-progress': afterSent(docsProgress(), apptScheduled()),
      'documents-overdue': afterSent(documents({ now: t(6, 8), status: WAITING, overdue: ['agreement-acknowledgement'] }), apptScheduled()),
      'documents-failed': afterSent(documents({ now: t(18), status: { ...WAITING, 'agreement-acknowledgement': 'complete', 'licence-check': 'failed' },
        reasons: { 'licence-check': 'The synthetic provider reported this step as failed.' } }), apptScheduled()),
      'ready-for-handover': afterSent(docsReady(), apptScheduled()),
      'return-unavailable': afterSent(docsProgress(), apptRequested(), retWaiting()), 'return-not-planned': afterSent(docsProgress(), apptScheduled(), retOpen()),
      'return-requested': afterSent(docsProgress(), apptScheduled(), retRequested()), 'return-change-proposed': afterSent(docsProgress(), apptScheduled(), retProposed()),
      'return-scheduled': afterSent(docsReady(), apptScheduled(), retScheduled()),
      'return-returned': afterSent(docsReady(), apptCompleted(), retReturned()), 'return-returned-first': afterSent(docsReady(), apptScheduled(), retReturnedFirst()),
      'return-missed': afterSent(docsReady(), apptScheduled(), retMissed()), 'return-handover-complete': afterSent(docsReady(), apptCompleted(), retHandoverDone()),
      'return-outcome-pending': afterSent(docsReady(), apptScheduled(), retOutcomePending()), 'return-outcome-refused': afterSent(docsReady(), apptScheduled(), retRefused()),
      // FUCQ-194: the buddy route collects the old car from her home address, or says it is not supplied.
      'return-buddy-home': afterSent(docsProgress(), apptScheduled(), env(returnValue({ appt: 'not-requested', location: HOME('1 Fictional Way, Example Town, ZZ1 1ZZ') }))),
      'return-buddy-no-address': afterSent(docsProgress(), apptScheduled(), env(returnValue({ appt: 'not-requested', location: HOME(null) }))),
      'new-order': afterSent(docsProgress(), apptScheduled(), newOrder()),
      loading: { phase: 'loading' }, unavailable: { phase: 'unavailable' },
      'partial-failure': ready(pendingSm(), unavailable('Document tracking is unavailable. Ask the scheme team to check the service.'), apptClosed(), newOrder()),
    },
  };
}
/** The four approval envelopes that also exist as producer fixtures, for equality checks. */
export const approvalExamples = { pending: pendingSm, declined, 'sent-to-ordering': sent, unsupported };
export const orderProgressFixtureNames = Object.freeze(Object.keys(orderProgressFixtures().states));
