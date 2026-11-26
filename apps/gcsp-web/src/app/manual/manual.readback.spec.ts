import { describe, expect, it } from 'vitest';
import { manualContextRows, manualCountdown, manualReadbackCards, manualReadbackMatches, ManualReadbackSource } from './manual.readback';
import type { ManualProjection } from './manual.types';

const projection = (): ManualProjection => ({ claim: { state: 'quoted', now: '2026-11-23T11:30:00Z',
  hold: { holdId: 'hold-secret', phase: 'preview', expiresAt: '2026-11-23T11:32:00Z', mode: 'replacement' },
  quote: { driverId: 'driver-secret', draftVersion: 2, contextVersion: 'context-secret', timing: { previewSeconds: 120, reviewSeconds: 600 },
    terms: { kind: 'employee-scheme', points: { value: 0, unit: 'points' }, allowanceInputs: { allowance: { value: 1300, unit: 'points' } }, contribution: null } } },
  reviewDetails: { binding: { employeeId: 'employee', runId: 'run', entitlementSlotId: 'slot' }, mode: 'replacement', oldContractId: 'contract-secret',
    now: '2026-11-23T11:30:00Z', contract: { months: 6, annualMileage: 8000, mileageUnit: 'mi/year' },
    requestedCollection: { date: '2026-11-30', locationId: 'location-secret' }, currentContract: { model: 'BMW 3 Series', registration: 'AB12 CDE' },
    details: { contact: { phone: '01632 960000', email: 'avery@example.test' }, expectedReturnMileage: 0, specialRequirements: '' } } } as unknown as ManualProjection);
const source = (): ManualReadbackSource => ({ account: { state: 'ready', actions: [], account: { employeeId: 'employee', name: 'Avery' },
  drivers: [{ driverId: 'driver-secret', name: 'Selected driver', kind: 'employee', licence: { displayNumber: 'ABCD••••', categories: ['car'], validFrom: '2020-01-01', validUntil: '2030-01-01' } },
    { driverId: 'other-driver', name: 'Wrong driver' }], choices: { collectionLocations: [{ locationId: 'location-secret', label: 'Vehicle Collection Centre' }] } },
  draft: { draftVersion: 2, contextVersion: 'context-secret', choices: { driverId: 'driver-secret', slotId: 'slot', mode: 'replacement', oldContractId: 'contract-secret', schemeId: 'scheme' } } });

describe('manual authoritative presentation readback', () => {
  it('reads exactly the pinned driver and labelled collection while retaining zero values and absent data', () => {
    const cards = manualReadbackCards(projection(), source()); const shown = JSON.stringify(cards);
    expect(cards).toHaveLength(6); expect(shown).toContain('Avery'); expect(shown).toContain('Selected driver'); expect(shown).not.toContain('Wrong driver');
    expect(shown).toContain('Vehicle Collection Centre'); expect(shown).not.toContain('location-secret'); expect(shown).not.toContain('driver-secret');
    expect(cards.find((card) => card.key === 'points')?.rows[0].value).toBe(0);
    expect(cards.find((card) => card.key === 'return')?.rows.at(-1)?.value).toBe(0);
    expect(manualContextRows(projection(), source()).map((row) => row.label)).toEqual(['Journey', 'Requested collection', 'Contract term', 'Returning car']);
    expect(JSON.stringify(manualContextRows(projection(), source()))).not.toContain('secret');
  });
  it('reads the pinned employee-scheme null contribution as no cash contribution', () => {
    const cards = manualReadbackCards(projection(), source());
    expect(cards.find((card) => card.key === 'points')?.rows.find((row) => row.label === 'Cash contribution')?.value).toBe('None');
  });
  it.each(['employee', 'draft', 'context', 'slot', 'driver', 'return'] as const)('rejects a mismatched %s join instead of leaking another private readback', (field) => {
    const value = source();
    const changed = { ...value, account: field === 'employee' ? { ...value.account, account: { employeeId: 'other', name: 'Other person' } } : value.account,
      draft: { ...value.draft, draftVersion: field === 'draft' ? 3 : 2, contextVersion: field === 'context' ? 'other' : 'context-secret',
        choices: { ...value.draft.choices, ...(field === 'slot' ? { slotId: 'other' } : field === 'driver' ? { driverId: 'other' } : field === 'return' ? { oldContractId: 'other' } : {}) } } };
    expect(manualReadbackMatches(projection(), changed)).toBe(false);
    const shown = JSON.stringify(manualReadbackCards(projection(), changed)); expect(shown).not.toContain('Avery'); expect(shown).not.toContain('Other person'); expect(shown).not.toContain('Selected driver');
  });
  it.each([[91, '1:31', false, false], [30, '0:30', true, false], [0, '0:00', false, true], [-1, '0:00', false, true]] as const)('projects %s server seconds with quarter-duration and expiry boundaries', (seconds, shown, low, expired) => {
    const p = projection(); const value = { ...p, claim: { ...p.claim!, now: new Date(Date.parse('2026-11-23T11:32:00Z') - seconds * 1000).toISOString() }, reviewDetails: null };
    const countdown = manualCountdown(value); expect(countdown?.label).toBe(`Car reservation: ${shown} remaining`); expect(countdown?.low).toBe(low); expect(countdown?.expired).toBe(expired);
  });
  it('uses the newer server details time and the review phase duration without any browser clock', () => {
    const p = projection(); const countdown = manualCountdown({ ...p, claim: { ...p.claim!, hold: { ...p.claim!.hold, phase: 'order-review', expiresAt: '2026-11-23T11:40:00Z' } },
      reviewDetails: { ...p.reviewDetails!, now: '2026-11-23T11:37:30Z' } });
    expect(countdown?.label).toBe('Order review: 2:30 remaining'); expect(countdown?.low).toBe(true); expect(countdown?.consequence).toContain('Submitting places your order.');
  });
});
