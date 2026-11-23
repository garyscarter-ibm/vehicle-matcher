import { describe, expect, it } from 'vitest';
import { offerDate, offerExplanation, offerFailureView, offerValue, offerViewModel } from './offer-view-model';
import { offerScreenFixture, screenFact } from './offer-screen.fixture';
import { isOfferProjection } from './offer.validation';

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
  it('projects only the pending source card facts while retaining every raw fact and contribution', () => {
    const offer = offerScreenFixture(); const before = JSON.stringify(offer); const vm = offerViewModel(offer);
    expect(vm).toHaveProperty('detailRows', [
      { label: 'Model', value: '3 Series' }, { label: 'Derivative', value: 'M Sport Pro package' },
      { label: 'Body style', value: 'Touring', unit: undefined }, { label: 'Fuel', value: 'Plug in hybrid', unit: undefined },
      { label: 'Seats', value: 5, unit: undefined }, { label: 'Boot', value: 410, unit: 'litres' },
      { label: '0 to 62 mph', value: null, unit: undefined }, { label: 'Fuel economy', value: null, unit: undefined },
      { label: 'Gearbox', value: 'Automatic', unit: undefined, missingLabel: 'Not supplied' },
    ]);
    expect(vm.rows).toContainEqual({ label: 'Front ISOFIX', value: 'No' }); expect(vm.contribution).toBe('£12.50 a month');
    expect(JSON.stringify(offer)).toBe(before);
  });
  it('uses source String/valueText finish and equipment copy without replacing supplied false or zero', () => {
    const source = offerScreenFixture(); const offer = { ...source, quote: { ...source.quote, facts: { ...source.quote.facts,
      facts: { ...source.quote.facts.facts, colour: screenFact(false), interior: screenFact(0), options: screenFact([false, 0, null, '']) } } } };
    const before = JSON.stringify(offer); const vm = offerViewModel(offer);
    expect(vm.finishes).toEqual([{ label: 'Paint', value: 'false' }, { label: 'Upholstery', value: '0' }]);
    expect(vm.equipment).toEqual(['false', '0', 'Not supplied', '']); expect(JSON.stringify(offer)).toBe(before);
  });
  it.each([[false, false], [[], 'None listed']] as const)('keeps scalar or empty equipment %s in source facts rather than manufacturing a selected item', (value, rendered) => {
    const source = offerScreenFixture(); const offer = { ...source, quote: { ...source.quote, facts: { ...source.quote.facts,
      display: { ...source.quote.facts.display, colour: 'Do not borrow this paint' },
      facts: { ...source.quote.facts.facts, colour: screenFact(null), interior: screenFact(null), options: screenFact(value) } } } };
    const vm = offerViewModel(offer);
    expect(vm.finishes).toEqual([{ label: 'Paint', value: null }, { label: 'Upholstery', value: null }]);
    expect(vm.equipment).toEqual([]);
    expect(vm).toHaveProperty('detailRows', expect.arrayContaining([{ label: 'Options', value: rendered, unit: undefined, missingLabel: 'Fitted equipment unknown' }]));
  });
  it('formats nested grounded explanations without object coercion or omitted facts', () => {
    const entry = offerExplanation({ code: 'essential-met', field: 'seats', fact: screenFact(5), requirement: { operator: 'gte', value: 5, unit: 'count' }, facts: { boot: screenFact(null) }, desired: 'Estate' });
    expect(entry.title).toBe('Meets your requirement: Seats');
    expect(entry.details).toEqual(['Seats: 5', 'Boot: Unknown', 'Required: at least 5', 'Desired: Estate']);
    expect(JSON.stringify(entry)).not.toContain('[object Object]');
  });
  it('uses only server time for the displayed duration and never changes server state', () => {
    const offer = offerScreenFixture();
    expect(offerViewModel(offer).remaining).toBe('2h 00m');
    const contradictory = offerViewModel({ ...offer, expiresAt: '2026-11-14T11:00:00.000Z' });
    expect(contradictory.remaining).toBe('0h 00m'); expect(contradictory.title).toBe('Your offer');
    expect(offerDate('2026-07-14T12:30:00.000Z')).toContain('13:30 BST');
  });
  it.each([
    ['2026-11-14T14:30:00.001Z', '2h 01m'],
    ['2026-11-14T12:35:00.001Z', '0h 06m'],
    ['2026-11-14T12:35:00.000Z', '0h 05m'],
    ['2026-11-14T12:30:00.001Z', '0h 01m'],
    ['2026-11-14T12:30:00.000Z', '0h 00m'],
    ['2026-11-14T12:29:00.000Z', '0h 00m'],
  ])('rounds authoritative remaining time up for deadline %s', (expiresAt, remaining) => {
    const offer = { ...offerScreenFixture(), expiresAt };
    expect(offerViewModel(offer).remaining).toBe(remaining);
    expect(offer.state).toBe('pending');
  });
  it.each(['decision-pending', 'release-pending'])('retains pending confirmation for %s', (reason) => {
    const vm = offerViewModel({ ...offerScreenFixture(), reason });
    expect(vm.title).toBe('Checking your decision'); expect(vm.message).toContain('being confirmed');
  });
  it('retains current-car partial and unavailable unknowns without deriving winners', () => {
    const offer = offerScreenFixture(); const vm = offerViewModel(offer);
    expect(vm.comparison).toContainEqual({ label: 'Boot', current: '440 litres', offered: '410 litres' });
    expect(vm.comparison).toContainEqual({ label: 'Fuel', current: 'Unknown', offered: 'Plug in hybrid' });
    expect(vm.reasons).toContainEqual({ title: '300 fewer points', details: ['Every month, compared with your current car'] });
    expect(vm.tradeOffs).toContainEqual({ title: '30 litres less', details: ['Boot space compared with your current car'] });
    expect(vm.currentName).toBe('BMW 320i M Sport Touring, 320i Automatic');
    const absent = offerViewModel({ ...offer, comparison: { status: 'unavailable', reason: 'unavailable', comparisonAvailable: false, currentCar: null, unknowns: ['configuration', 'body'] } });
    expect(absent.currentName).toBe('Current car not supplied'); expect(absent.comparison.every((row) => row.current === 'Unknown')).toBe(true);
  });
  it('builds the source saving and structured numeric highlights directly from comparable facts', () => {
    const offer = offerScreenFixture();
    expect(offerViewModel(offer)).toMatchObject({ monthlyPoints: 295, monthlyAllowance: 620, pointsDifference: '300 fewer than your current car',
      benefits: [
        { number: '300', title: 'fewer points', detail: 'Every month, compared with your current car' },
        { title: 'Available by Tuesday 1 December 2026.' },
      ], tradeoffs: [
        { number: '30', title: 'litres less', detail: 'Boot space compared with your current car' },
        { title: 'Less sporty than you prefer.' },
        { title: 'Touring, not the estate you prefer.' },
      ],
    });
  });
  it('normalizes source reason sentences while omitting coded checks and measured-field duplicates', () => {
    const offer = offerScreenFixture();
    const vm = offerViewModel({ ...offer, quote: { ...offer.quote, decision: { ...offer.quote.decision,
      reasons: [{ code: 'driver-eligible', text: 'Driver checked' }, { code: 'essential-met', text: 'Seats checked' },
        { field: 'points', text: 'Repeated saving' }, { code: 'preference-fit', field: 'body' }, { text: 'Explicit benefit' }],
      tradeOffs: [{ field: 'boot', text: 'Repeated boot difference' }, 'Explicit tradeoff'],
    } } });
    expect(vm).toMatchObject({ benefits: [
      { number: '300', title: 'fewer points', detail: 'Every month, compared with your current car' },
      { title: 'This car differs from your body style preference.' }, { title: 'Explicit benefit' },
    ], tradeoffs: [
      { number: '30', title: 'litres less', detail: 'Boot space compared with your current car' }, { title: 'Explicit tradeoff' },
    ] });
  });
  it('keeps ties and absent current-car facts neutral rather than manufacturing savings or numeric highlights', () => {
    const source = offerScreenFixture(); const offer = { ...source, quote: { ...source.quote, decision: { ...source.quote.decision, reasons: [], tradeOffs: [] } } };
    expect(offerViewModel({ ...offer, comparison: { ...offer.comparison, currentCar: { ...offer.comparison.currentCar!, facts: {
      points: { value: 295, unit: 'points' }, boot: { value: 410, unit: 'litres' }, seats: { value: 7, unit: 'count' },
    } } } })).toMatchObject({ pointsDifference: null, benefits: [], tradeoffs: [] });
    expect(offerViewModel({ ...offer, comparison: { ...offer.comparison, currentCar: null, comparisonAvailable: false } }))
      .toMatchObject({ hasCurrentCar: false, pointsDifference: null, benefits: [], tradeoffs: [], comparisonNote: 'Current-car details not supplied. Equipment is unknown.' });
  });
  it('uses the overview facts actually projected by the live Node card adapter', () => {
    const offer = offerScreenFixture();
    expect(offerViewModel(offer).overview).toEqual([
      { label: 'Body style', value: 'Touring' }, { label: 'Fuel', value: 'Plug in hybrid' }, { label: 'Boot', value: '410 litres' }, { label: 'Seats', value: '5' },
    ]);
    expect(offer.quote.facts.facts['availableFrom'].value).toBe('1 December 2026');
  });
  it('formats valid recorded current facts by their source fields even when unit metadata is null', () => {
    const source = offerScreenFixture();
    const offer = { ...source, comparison: { status: 'available' as const, reason: 'current-car-facts-recorded', comparisonAvailable: true, unknowns: [],
      currentCar: { ...source.comparison.currentCar!, facts: {
        configuration: { value: '320i Automatic', unit: null }, body: { value: 'estate', unit: null }, fuel: { value: 'petrol', unit: null },
        seats: { value: 5, unit: null }, boot: { value: 440, unit: null }, mpg: { value: 42.8, unit: null },
        zeroTo62: { value: 7.6, unit: null }, points: { value: 595, unit: null },
      } } } };
    const before = JSON.stringify(offer); expect(isOfferProjection(offer, { offerId: 'offer-1', runId: 'run-1' })).toBe(true);
    const vm = offerViewModel(offer);
    expect(vm.comparison).toEqual([
      { label: 'Body style', current: 'Estate', offered: 'Touring' }, { label: 'Fuel', current: 'Petrol', offered: 'Plug in hybrid' },
      { label: 'Seats', current: '5', offered: '5' }, { label: 'Boot', current: '440 litres', offered: '410 litres' },
      { label: '0 to 62 mph', current: '7.6 s', offered: 'Not supplied' }, { label: 'Fuel economy', current: '42.8 mpg', offered: 'Not supplied' },
      { label: 'Points a month', current: '595 points', offered: '295 points' },
    ]);
    expect(vm).toMatchObject({ pointsDifference: '300 fewer than your current car', benefits: [{ number: '300', title: 'fewer points', detail: 'Every month, compared with your current car' }, { title: 'Available by Tuesday 1 December 2026.' }] });
    expect(JSON.stringify(offer)).toBe(before);
  });
  it('does not silently promote a display-only offered unit into the canonical DTO unit', () => {
    const source = offerScreenFixture(); const offer = { ...source, quote: { ...source.quote,
      facts: { ...source.quote.facts, facts: { ...source.quote.facts.facts, boot: screenFact(410, 'litres') } } } };
    expect(isOfferProjection(offer, { offerId: 'offer-1', runId: 'run-1' })).toBe(true);
    const vm = offerViewModel(offer);
    expect(vm.comparison).toContainEqual({ label: 'Boot', current: '440 litres', offered: '410' });
    expect(vm).toMatchObject({ tradeoffs: [{ title: 'Less sporty than you prefer.' }, { title: 'Touring, not the estate you prefer.' }] });
  });
  it('uses normalized source sentences in decision details instead of exposing raw provider codes', () => {
    const source = offerScreenFixture();
    expect(offerViewModel({ ...source, quote: { ...source.quote, decision: { ...source.quote.decision,
      gateStatus: 'needs-confirmation', unknowns: [{ code: 'licence-unconfirmed' }], blockers: [{ code: 'essential-unmet', field: 'seats' }],
    } } })).toMatchObject({ decisionDetails: [
      { label: 'Why it is not eligible', entries: ['Does not meet your seats requirement.'] },
      { label: 'Needs confirmation', entries: ['Your licence details still need confirming.'] },
    ] });
  });
  it('keeps configuration-only current-car context distinct from recorded specification facts', () => {
    const source = offerScreenFixture(); const offer = { ...source, comparison: { ...source.comparison,
      currentCar: { ...source.comparison.currentCar!, facts: { configuration: { value: '320i Automatic', unit: null } } },
      unknowns: ['body', 'fuel', 'seats', 'boot', 'zeroTo62', 'mpg', 'points'],
    } };
    expect(isOfferProjection(offer, { offerId: 'offer-1', runId: 'run-1' })).toBe(true);
    expect(offerViewModel(offer)).toMatchObject({ currentName: 'BMW 320i M Sport Touring, 320i Automatic',
      comparisonNote: 'Partial comparison. Current-car specifications and points are unknown.', pointsDifference: null });
  });
  it('does not promote handoff acknowledgement to approval or lose refused stages', () => {
    const offer = offerScreenFixture('accepted');
    expect(offerViewModel(offer).message).toContain('Waiting for HR approval');
    expect(offerViewModel(offer).showVehicle).toBe(false);
    const refused = offerViewModel({ ...offer, selection: { ...offer.selection!, selectionState: 'handoff-failed' } });
    expect(refused.title).toBe('Your selection was not sent to ordering'); expect(refused.selectionStages).toEqual(offer.selection!.stages);
  });
  it('projects only the supplied short accepted identity, without adding the order reference', () => {
    const offer = offerScreenFixture('accepted');
    expect(offerViewModel(offer)).toMatchObject({ acceptedIdentityRows: [
      { label: 'Your new car', value: 'BMW 330e M Sport Touring' }, { label: 'Car order number', value: '0123456' },
    ], message: 'Selection received. Waiting for HR approval.' });
    expect(offerViewModel({ ...offer, selection: { ...offer.selection!, orderNumber: null }, quote: { ...offer.quote, orderNumber: null } }))
      .toMatchObject({ acceptedIdentityRows: [{ label: 'Your new car', value: 'BMW 330e M Sport Touring' }] });
  });
  it.each([
    ['GCSP-000123', [{ label: 'Order reference', value: 'GCSP-000123' }, { label: 'Car order number', value: '7654321' }]],
    [null, [{ label: 'Car order number', value: '7654321' }]],
    ['invalid reference!', [{ label: 'Car order number', value: '7654321' }]],
  ])('keeps refused selection identity exact with reference %s', (orderReference, selectionIdentityRows) => {
    const offer = offerScreenFixture('accepted');
    const vm = offerViewModel({ ...offer, selection: { ...offer.selection!, selectionState: 'handoff-failed', orderReference: orderReference as string | null, orderNumber: '7654321' } });
    expect(vm).toMatchObject({ showSelection: true, selectionIdentityRows });
    expect(vm.selectionStages).toEqual(offer.selection!.stages);
  });
  it.each([
    ['GCSP-000123', 'The car stays reserved for you. Nothing has been ordered. Quote order reference GCSP-000123 when you contact scheme support.'],
    [null, 'The car stays reserved for you. Nothing has been ordered.'],
  ])('uses the frozen support-linked refusal message with reference %s', (orderReference, message) => {
    const offer = offerScreenFixture('accepted');
    expect(offerViewModel({ ...offer, selection: { ...offer.selection!, selectionState: 'handoff-failed', orderReference } }).message).toBe(message);
  });
  it('never presents private error payloads and retries only retryable read failures', () => {
    expect(offerFailureView({ status: 'unavailable', reason: 'private-id stacktrace', retryable: true })).toEqual({ title: 'Your offer could not be loaded', message: 'The current offer could not be loaded.', retry: true });
    expect(offerFailureView({ status: 'denied', retryable: true }).retry).toBe(false);
    expect(offerFailureView({ status: 'conflict', retryable: false }).retry).toBe(false);
  });
});
