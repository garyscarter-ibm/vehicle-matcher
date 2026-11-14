import { describe, expect, it } from 'vitest';
import { offerDate, offerExplanation, offerFailureView, offerValue, offerViewModel } from './offer-view-model';
import { offerScreenFixture, screenFact } from './offer-screen.fixture';

describe('offer read presentation projection', () => {
  it('retains supplied exact identity, every fact, equipment and pinned terms without mutation', () => {
    const offer = offerScreenFixture(); const before = JSON.stringify(offer); const vm = offerViewModel(offer);
    expect(vm.name).toBe(offer.quote.facts.display.name);
    expect(vm.rows.length).toBe(Object.keys(offer.quote.facts.facts).length - 2 + 3);
    expect(vm.rows).toContainEqual({ label: 'Mileage', value: 'Unknown' });
    expect(vm.rows).toContainEqual({ label: 'Front ISOFIX', value: 'No' });
    expect(vm.equipment).toEqual(['Heated seats', 'Parking assistance']);
    expect(vm.points).toBe('295'); expect(vm.allowance).toBe('620'); expect(vm.contribution).toBe('£12.50 a month');
    expect(JSON.stringify(offer)).toBe(before);
  });
  it('preserves zero, false, arrays and unknown rather than filling defaults', () => {
    expect(offerValue(0)).toBe('0'); expect(offerValue(false)).toBe('No');
    expect(offerValue([null, 'A', 0, false])).toBe('Not supplied, A, 0, No');
    const source = offerScreenFixture();
    const vm = offerViewModel({ ...source, quote: { ...source.quote, terms: { ...source.quote.terms, points: { value: 0, unit: 'points' }, allowanceInputs: {}, contribution: null },
      facts: { ...source.quote.facts, facts: { options: screenFact(null) } } } });
    expect(vm.points).toBe('0'); expect(vm.allowance).toBeNull(); expect(vm.contribution).toBeNull(); expect(vm.equipment).toEqual([]);
  });
  it('formats nested grounded explanations without object coercion or omitted facts', () => {
    const entry = offerExplanation({ code: 'essential-met', field: 'seats', fact: screenFact(5), requirement: { operator: 'gte', value: 5, unit: 'count' }, facts: { boot: screenFact(null) }, desired: 'Estate' });
    expect(entry.title).toBe('Meets your requirement: Seats');
    expect(entry.details).toEqual(['Seats: 5', 'Boot: Unknown', 'Required: at least 5', 'Desired: Estate']);
    expect(JSON.stringify(entry)).not.toContain('[object Object]');
  });
  it('uses only server time for the displayed duration and never changes server state', () => {
    const offer = offerScreenFixture();
    expect(offerViewModel(offer).remaining).toBe('2:00');
    const contradictory = offerViewModel({ ...offer, expiresAt: '2026-11-14T11:00:00.000Z' });
    expect(contradictory.remaining).toBe('0:00'); expect(contradictory.title).toBe('Your offer');
    expect(offerDate('2026-07-14T12:30:00.000Z')).toContain('13:30 BST');
  });
  it.each(['decision-pending', 'release-pending'])('retains pending confirmation for %s', (reason) => {
    const vm = offerViewModel({ ...offerScreenFixture(), reason });
    expect(vm.title).toBe('Checking your decision'); expect(vm.message).toContain('being confirmed');
  });
  it('retains current-car partial and unavailable unknowns without deriving winners', () => {
    const offer = offerScreenFixture(); const vm = offerViewModel(offer);
    expect(vm.comparison).toContainEqual({ label: 'Boot', current: '440 litres', offered: '410 litres' });
    expect(vm.comparison).toContainEqual({ label: 'Fuel', current: 'Unknown', offered: 'Plug-in hybrid' });
    expect(vm.reasons).toContainEqual({ title: '300 fewer points', details: ['Every month, compared with your current car'] });
    expect(vm.tradeOffs).toContainEqual({ title: '30 litres less', details: ['Boot space compared with your current car'] });
    expect(vm.currentName).toBe('BMW 320i M Sport Touring, 320i Automatic');
    const absent = offerViewModel({ ...offer, comparison: { status: 'unavailable', reason: 'unavailable', comparisonAvailable: false, currentCar: null, unknowns: ['configuration', 'body'] } });
    expect(absent.currentName).toBe('Current car not supplied'); expect(absent.comparison.every((row) => row.current === 'Unknown')).toBe(true);
  });
  it('does not promote handoff acknowledgement to approval or lose refused stages', () => {
    const offer = offerScreenFixture('accepted');
    expect(offerViewModel(offer).message).toContain('Waiting for HR approval');
    expect(offerViewModel(offer).showVehicle).toBe(false);
    const refused = offerViewModel({ ...offer, selection: { ...offer.selection!, selectionState: 'handoff-failed' } });
    expect(refused.title).toBe('Your selection was not sent to ordering'); expect(refused.selectionStages).toEqual(offer.selection!.stages);
  });
  it('never presents private error payloads and retries only retryable read failures', () => {
    expect(offerFailureView({ status: 'unavailable', reason: 'private-id stacktrace', retryable: true })).toEqual({ title: 'Your offer could not be loaded', message: 'Please try again in a moment.', retry: true });
    expect(offerFailureView({ status: 'denied', retryable: true }).retry).toBe(false);
    expect(offerFailureView({ status: 'conflict', retryable: false }).retry).toBe(false);
  });
});
