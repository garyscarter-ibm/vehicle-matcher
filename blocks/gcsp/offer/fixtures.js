import { employeeCardFixture } from '../../vehicle-matcher/employee-card-fixture.js';

export const HANDOFF_NAMES = Object.freeze(['handoff-replacement', 'handoff-blocked']);
export const SELECTION_NAMES = Object.freeze(['selection-hr', 'selection-no-hr', 'selection-pending', 'selection-failed']);
const WORDING = 'Fictional demonstration terms: selection requests allocation of this exact scheme stock order under the recorded quote. '
  + 'Approval, appointment and collection are separate decisions; submission does not end the current contract.';
const handoffFixture = (blocked) => ({ termsVersion: 'fictional-order-terms-v1', termsDigest: 'synthetic-terms-digest', wording: WORDING, fictional: true,
  mode: 'replacement', blocker: blocked ? 'contact-required' : null, contact: blocked ? null : { phone: '07700 900123', email: 'paula@example.invalid' },
  returnCar: { model: 'G20 320d M Sport', contractEndDate: '2026-12-31', currentOdometer: { value: 41250, unit: 'miles' } },
  declarations: [{ id: 'terms', label: 'I accept these fictional scheme terms.' }, { id: 'driver', label: 'The nominated driver and licence details are correct.' },
    { id: 'return', label: 'The old contract and expected return mileage are correct.' }] });
const selectionFixture = (name) => {
  const hr = name !== 'selection-no-hr'; const approval = [...hr ? ['HR approval'] : [], 'sales-manager approval', 'sent to ordering'];
  const state = { 'selection-pending': 'handoff-pending', 'selection-failed': 'handoff-failed' }[name] ?? 'acknowledged';
  return { selectionState: state, current: state === 'acknowledged' ? approval[0] : 'selection received',
    orderReference: name === 'selection-no-hr' ? null : 'GCSP-000123', orderNumber: '0123456',
    stages: [{ name: 'selection received', state: { 'handoff-pending': 'pending', 'handoff-failed': 'failed' }[state] ?? 'complete' },
      ...approval.map((stage, i) => ({ name: stage, state: i === 0 && state === 'acknowledged' ? 'waiting' : 'not-started' }))] };
};

export const FIXTURE_NAMES = Object.freeze(['pending', 'accepted', 'declined', 'expired', 'earlier-run', 'not-found',
  'uncertain', 'loading', 'error', 'no-image', 'low-time', 'checking-expiry', ...HANDOFF_NAMES, ...SELECTION_NAMES]);

/** Display-only examples; they cannot accept/decline or establish real access/producer integration. */
export function offerFixture(name) {
  if (!FIXTURE_NAMES.includes(name)) return null;
  const source = structuredClone(employeeCardFixture);
  const member = source.members[0]; member.actions = [];
  member.display.line = 'Order no. 0123456 · synthetic presentation example';
  member.facts.push({ label: 'Derivative', value: 'M Sport Touring', provenance: 'Synthetic presentation example' },
    { label: 'Colour', value: null, missingLabel: 'Colour not supplied' },
    { label: 'Options', value: null, missingLabel: 'Fitted equipment unknown' });
  if (name === 'no-image') member.media = {};
  const handoff = HANDOFF_NAMES.includes(name); const selection = SELECTION_NAMES.includes(name);
  return { status: 'ok', value: { state: ['no-image', 'low-time', 'checking-expiry', ...HANDOFF_NAMES].includes(name) ? 'pending' : selection ? 'accepted' : name,
    handoff: handoff ? handoffFixture(name === 'handoff-blocked') : null, selection: selection ? selectionFixture(name) : null,
    card: { schemaVersion: 1, members: [member] }, actionable: handoff, actions: { accept: name === 'handoff-replacement', decline: handoff },
    reference: { offerId: 'presentation-example', runId: 'presentation-example', offerVersion: 1, holdVersion: 1, quoteVersion: 1 },
    now: '2026-11-05T12:00:00.000Z', expiresAt: name === 'checking-expiry' ? '2026-11-05T12:00:00.000Z'
      : name === 'low-time' ? '2026-11-05T12:03:00.000Z' : '2026-11-05T14:00:00.000Z',
    currentCar: { display: { name: 'G21 320i M Sport Touring' }, media: {},
      facts: [{ label: 'Derivative', value: 'M Sport Touring' }, { label: 'Colour', value: null, missingLabel: 'Not supplied' },
        { label: 'Options', value: null, missingLabel: 'Fitted equipment unknown' }],
      provenance: 'Scenario name from the HLD. Presentation example; current-car equipment is unknown.' },
    fixtureNotice: 'Synthetic presentation example. This page does not read a real offer or record a decision.' } };
}
