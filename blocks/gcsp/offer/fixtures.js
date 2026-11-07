import { employeeCardFixture } from '../../vehicle-matcher/employee-card-fixture.js';

export const FIXTURE_NAMES = Object.freeze(['pending', 'accepted', 'declined', 'expired', 'earlier-run', 'not-found',
  'uncertain', 'loading', 'error', 'no-image', 'low-time', 'checking-expiry']);

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
  return { status: 'ok', value: { state: ['no-image', 'low-time', 'checking-expiry'].includes(name) ? 'pending' : name,
    card: { schemaVersion: 1, members: [member] }, actionable: false, actions: { accept: false, decline: false },
    reference: { offerId: 'presentation-example', runId: 'presentation-example', offerVersion: 1, holdVersion: 1, quoteVersion: 1 },
    now: '2026-11-05T12:00:00.000Z', expiresAt: name === 'checking-expiry' ? '2026-11-05T12:00:00.000Z'
      : name === 'low-time' ? '2026-11-05T12:03:00.000Z' : '2026-11-05T14:00:00.000Z',
    currentCar: { display: { name: 'G21 320i M Sport Touring' }, media: {},
      facts: [{ label: 'Derivative', value: 'M Sport Touring' }, { label: 'Colour', value: null, missingLabel: 'Not supplied' },
        { label: 'Options', value: null, missingLabel: 'Fitted equipment unknown' }],
      provenance: 'Scenario name from the HLD. Presentation example; current-car equipment is unknown.' },
    fixtureNotice: 'Synthetic presentation example. This page does not read a real offer or record a decision.' } };
}
