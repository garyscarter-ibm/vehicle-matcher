import { employeeCardFixture } from '../../vehicle-matcher/employee-card-fixture.js';
import { fieldLabel } from '../kit/plain-copy.js';

export const HANDOFF_NAMES = Object.freeze(['handoff-replacement', 'handoff-blocked', 'fuller-offer']);
export const SELECTION_NAMES = Object.freeze(['selection-hr', 'selection-no-hr', 'selection-pending', 'selection-failed']);
const WORDING = 'Scheme terms: selection requests allocation of this exact scheme stock order under the recorded quote. '
  + 'Approval, appointment and collection are separate decisions; submission does not end the current contract.';
const handoffFixture = (blocked) => ({ termsVersion: 'fictional-order-terms-v1', termsDigest: 'synthetic-terms-digest', wording: WORDING, fictional: true,
  mode: 'replacement', blocker: blocked ? 'contact-required' : null, contact: blocked ? null : { phone: '07700 900123', email: 'paula.mason@gcsp-demo.com' },
  driver: { name: 'Paula Mason', kind: 'employee', licence: { displayNumber: 'MASON900000PM9XX', categories: ['car'], validFrom: '2010-01-01', validUntil: '2030-01-01' } },
  returnMileage: { maximum: 500000, unit: 'mi' }, documentSource: { terms: 'ordering.terms.v1', termsVersion: 'fictional-order-terms-v1', recordSource: 'fixture:manual-records-v1' },
  returnCar: { model: 'BMW 3 Series Touring 320i', contractEndDate: '2026-12-31', currentOdometer: { value: 41250, unit: 'miles' }, expectedReturnMileage: null },
  declarations: [{ id: 'terms', label: 'I accept these scheme terms.' }, { id: 'driver', label: 'The nominated driver and licence details are correct.' },
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


// Review input only: screenshot comparison content, with documented illustrative absolute car values.
function fullerOffer(value) {
  const member = value.card.members[0];
  member.display.name = 'BMW 330e M Sport Touring';
  member.media = { images: [{"src": "/assets/gcsp-vehicle-evidence/07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp", "label": "Front exterior", "alt": "BMW 3 Series Touring, front exterior", "fidelity": "representative-configuration", "sourceRef": "bmw-display-07c269dd7f55fad0a56b"}, {"src": "/assets/gcsp-vehicle-evidence/398f08f4e76862d966a28a3b6a622aea9cf9c83e1b64d36353b374e05303d261.webp", "label": "Rear exterior", "alt": "BMW 3 Series Touring, rear exterior", "fidelity": "representative-configuration", "sourceRef": "bmw-display-398f08f4e76862d966a2"}, {"src": "/assets/gcsp-vehicle-evidence/285aba84d74d7b3c792e4cb47d97f650a5c81e711eeb5b58c8c959d355380464.webp", "label": "Interior", "alt": "BMW 3 Series Touring, interior", "fidelity": "representative-model", "sourceRef": "bmw-display-285aba84d74d7b3c792e"}] };
  member.terms = [{ kind: 'points-monthly', value: 295, allowance: 620 }];
  member.facts = [['Body style', 'Touring'], ['Fuel', 'Plug-in hybrid'], ['Boot', 410, 'litres'], ['Available by', '1 December 2026'],
    ['Colour', 'Alpine White'], ['Interior', 'Black Veganza'], ['Gearbox', 'Automatic'], ['Derivative', 'M Sport Pro package']]
    .map(([label, value, unit]) => ({ label, value, ...unit ? { unit } : {} }));
  member.facts.push({ label: 'Options', value: 'Heated seats, Parking assistance', items: ['Heated seats', 'Parking assistance'] });
  member.decision = { gateStatus: 'eligible', reasons: ['Available by Tuesday 1 December 2026.', 'This car matches your body style preference.', 'This car matches your fuel preference.'],
    tradeOffs: ['Less sporty than you prefer.', 'Less comfortable than you prefer.', 'More economical than you prefer.', 'Larger than you prefer.'] };
  value.now = '2026-11-11T12:30:00.000Z'; value.expiresAt = '2026-11-11T14:30:00.000Z';
  value.currentCar.status = 'complete';
  value.currentCar.facts = [{ key: 'points', label: 'Points a month', value: '595 points' }, { key: 'boot', label: 'Boot', value: '440 litres' }];
  return value;
}

/** Display-only examples; they cannot accept/decline or establish real access/producer integration. */
export function offerFixture(name) {
  if (!FIXTURE_NAMES.includes(name)) return null;
  const source = structuredClone(employeeCardFixture);
  const member = source.members[0]; member.actions = [];
  member.display.line = 'Order no. 0123456';
  // The shared comparison rows, labelled as the live card labels them.
  member.facts = [['body', 'Estate'], ['fuel', 'Petrol'], ['seats', 5], ['boot', 500, 'litres'], ['zeroTo62', 7.6, 's'], ['mpg', 42.8, 'mpg']]
    .map(([key, value, unit]) => ({ label: fieldLabel(key), value, ...unit ? { unit } : {} }));
  member.facts.push({ label: 'Derivative', value: 'M Sport Touring' },
    { label: 'Colour', value: null, missingLabel: 'Colour not supplied' },
    { label: 'Options', value: null, missingLabel: 'Fitted equipment unknown' });
  if (name === 'no-image') member.media = {};
  const handoff = HANDOFF_NAMES.includes(name); const selection = SELECTION_NAMES.includes(name);
  const value = { state: ['no-image', 'low-time', 'checking-expiry', ...HANDOFF_NAMES].includes(name) ? 'pending' : selection ? 'accepted' : name,
    handoff: handoff ? handoffFixture(name === 'handoff-blocked') : null, selection: selection ? selectionFixture(name) : null,
    card: { schemaVersion: 1, members: [member] }, actionable: handoff, actions: { accept: name === 'handoff-replacement' || name === 'fuller-offer', decline: handoff },
    reference: { offerId: 'presentation-example', runId: 'presentation-example', offerVersion: 1, holdVersion: 1, quoteVersion: 1 },
    now: '2026-11-05T12:00:00.000Z', expiresAt: name === 'checking-expiry' ? '2026-11-05T12:00:00.000Z'
      : name === 'low-time' ? '2026-11-05T12:03:00.000Z' : '2026-11-05T14:00:00.000Z',
    currentCar: { status: 'partial', display: { name: '320i M Sport Touring' }, media: {}, configuration: null,
      facts: [['body', 'Estate'], ['fuel', 'Petrol'], ['seats', null], ['boot', '480 litres'], ['zeroTo62', null], ['mpg', '44 mpg'], ['points', null]]
        .map(([key, value]) => ({ key, label: key === 'points' ? 'Points a month' : fieldLabel(key), value, missingLabel: 'Unknown' })) } };
  return { status: 'ok', value: name === 'fuller-offer' ? fullerOffer(value) : value };
}
