import { describe, expect, it } from 'vitest';
import { projectStock, validateStockPayload } from './stock.projection';
// @ts-expect-error The existing pure source producer is JavaScript without TypeScript declarations.
import { compactStockPayload } from '../../../../../server/gcsp/manual-gallery/stock-payload.js';
// @ts-expect-error Source contract constructors are JavaScript without TypeScript declarations.
import { createEmployeeTerms, createVehicleSnapshot } from '../../../../../server/vehicles/index.js';

// Small source-shaped DTO from ManualContextService, ManualClaimsService and VehicleSnapshot v1.
const origin = (assurance = 'confirmed-build') => ({ sourceRef: 'fixture:released-stock', observedAt: '2026-11-05T12:00:00.000Z', version: 'detail-v1', assurance });
const fact = (value: unknown, unit: string | null = null, assurance = value === null ? 'unknown' : 'confirmed-build') => ({ status: value === null ? 'unknown' : 'known', value, unit, provenance: origin(assurance) });
function decision(id: number, gateStatus = 'eligible') {
  const orderUuid = `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`;
  const candidateKey = `fixture%3Areleased-stock:exact-stock:${orderUuid}`;
  return { orderUuid, orderNumber: String(id).padStart(7, '0'), configurationId: 'RzIxOlMx', candidateKey, draftVersion: 2,
    gateStatus, suitable: gateStatus === 'eligible', score: null, components: [], reasons: [{ code: 'policy-include', ruleIds: ['rule-1'] }], tradeOffs: [],
    blockers: gateStatus === 'ineligible' ? [{ code: 'insurance-grade-limit' }] : [], unknowns: gateStatus === 'needs-confirmation' ? [{ code: 'insurance-unconfirmed' }] : [],
    evaluatedAt: '2026-11-05T12:00:00.000Z',
    snapshot: { contractVersion: 'vehicle-snapshot-v1', candidateKey, sourceNamespace: 'fixture:released-stock', identityKind: 'exact-stock',
      sourceKeys: { stockId: orderUuid }, snapshotVersion: `snapshot-${id}`, observedAt: '2026-11-05T12:00:00.000Z',
      display: { name: `Source car ${id}` }, facts: { series: fact('3 Series'), body: fact('estate'), insuranceGroup: fact(25, 'insurance-group'),
        engine: fact('320i'), equipment: fact([{ code: 'S0488', name: 'Lumbar support' }]),
        boot: fact(500, 'L', 'model-reference'), transmission: fact(null), derived: fact('Source derived', null, 'derived') } },
    terms: { kind: 'employee-scheme', termsVersion: `policy-v1:price-${id}:allowance:2026-11-05T12:00:00.000Z`,
      points: { value: id * 100, unit: 'points' }, allowanceInputs: { allowance: { value: 1300, unit: 'points' } }, contribution: null,
      validFrom: '2026-11-05T12:00:00.000Z', validUntil: '2026-11-05T14:00:00.000Z', provenance: { ...origin('derived'), version: 'policy-v1' } },
    versions: { brief: 2, facts: 'facts-v1', policy: 'policy-v1', stock: 'source-v1', snapshot: `snapshot-${id}`,
      terms: `policy-v1:price-${id}:allowance:2026-11-05T12:00:00.000Z`, clock: 'clock-v1', availability: `availability-${id}` },
    evidence: { availability: { state: 'available', version: `availability-${id}` } },
    claimInput: gateStatus === 'eligible' ? { orderUuid, expectedStockVersion: id + 3, expectedDraftVersion: 2,
      expectedContextVersion: 'context-v1', expectedTermsDigest: `issued-opaque-digest-${id}` } : null };
}
function full(gates = ['eligible', 'eligible', 'ineligible', 'needs-confirmation']) {
  const decisions = gates.map((gate, index) => decision(index + 1, gate)); const cars = decisions.filter((row) => row.gateStatus === 'eligible');
  return { state: decisions.length ? cars.length ? 'available-stock' : 'no-eligible-stock' : 'empty-stock', decisions, cars, total: cars.length,
    ranked: false, browsingReservesStock: false,
    versions: { brief: 2, facts: 'facts-v1', policy: 'policy-v1', stock: 'source-v1', clock: 'clock-v1', draft: 2, context: 'context-v1' } };
}
// Literal manual-stock-compact-v1 wire layout: shared decision pins and eligible-only ids.
function compact() {
  const source = full(); const sharedVersionKeys = ['brief', 'facts', 'policy', 'stock', 'clock'];
  const { cars, ...rest } = source;
  return { ...rest, payloadShape: 'manual-stock-compact-v1', sharedVersionKeys, carIds: cars.map((row) => row.orderUuid),
    decisions: source.decisions.map((row) => ({ ...row, versions: { snapshot: row.versions.snapshot, terms: row.versions.terms, availability: row.versions.availability } })) };
}
const envelope = (value: unknown) => ({ status: 'ok', value });
function history(released = false) {
  return { runId: 'run-v1', observedAt: '2026-11-05T12:00:00.000Z', source: { state: 'current-version-unknown' },
    history: { state: released ? 'released' : 'none-visible', releasedCarCount: released ? 4 : 0, releaseCount: released ? 1 : 0,
      latestReleasedAt: released ? '2026-11-05T11:00:00.000Z' : null, sourceVersions: released ? ['source-v1'] : [] } };
}

describe('employee released stock typed projection', () => {
  it('projects equivalent full and compact source DTOs without modifying them', () => {
    const source = full(); const wire = compact(); const before = structuredClone({ source, wire });
    expect(compactStockPayload(source)).toEqual(wire);
    expect(validateStockPayload(compactStockPayload(source))).toEqual(source);
    for (const row of source.decisions) {
      expect(createVehicleSnapshot(row.snapshot)).toEqual(row.snapshot);
      expect(createEmployeeTerms(row.terms)).toEqual(row.terms);
    }
    expect(validateStockPayload(wire)).toEqual(source);
    expect(projectStock(envelope(wire))).toEqual(projectStock(envelope(source)));
    expect({ source, wire }).toEqual(before);
  });

  it('retains all unranked decisions, separate eligible membership and exact same-configuration cars', () => {
    const view = projectStock(envelope(full()));
    expect(view.counts).toEqual({ records: 4, eligible: 2 });
    expect(view.allCars.map((row) => row.gateStatus)).toEqual(['eligible', 'eligible', 'ineligible', 'needs-confirmation']);
    expect(view.cars.map((row) => row.id)).toEqual(full().cars.map((row) => row.orderUuid));
    const [first, second] = view.cars;
    expect(first.identity.configurationId).toBe(second.identity.configurationId);
    expect(first.id).not.toBe(second.id);
    for (const [index, row] of view.allCars.entries()) {
      const input = full().decisions[index];
      expect(row.identity).toEqual({ orderUuid: input.orderUuid, configurationId: input.configurationId, orderNumber: input.orderNumber, candidateKey: input.candidateKey });
      expect(row.detail.snapshot).toEqual(input.snapshot); expect(row.review.terms).toEqual(input.terms);
      expect(row.review.decisionVersions).toEqual(input.versions); expect(row.review.claimInput).toEqual(input.claimInput);
      expect(row.evidence).toEqual(input); expect(row.evidence['score']).toBeNull();
      expect(row.cost.value).toBe((index + 1) * 100);
    }
    expect([view.ranked, view.browsingReservesStock]).toEqual([false, false]);
    expect(view.allCars.map((row) => row.reviewAvailable)).toEqual([true, true, false, false]);
  });

  const invalid = (mutate: (value: ReturnType<typeof full>) => void) => { const source = structuredClone(full()); mutate(source); return source; };
  it.each([
    ['stock id', (v: ReturnType<typeof full>) => { v.decisions[0].snapshot.sourceKeys.stockId = v.decisions[1].orderUuid; }],
    ['candidate key', (v: ReturnType<typeof full>) => { v.decisions[0].candidateKey = v.decisions[1].candidateKey; }],
    ['order reference', (v: ReturnType<typeof full>) => { v.decisions[0].orderNumber = '123'; }],
    ['duplicate exact car', (v: ReturnType<typeof full>) => { v.decisions.push(v.decisions[0]); }],
    ['duplicate order reference', (v: ReturnType<typeof full>) => { v.decisions[1].orderNumber = v.decisions[0].orderNumber; }],
    ['snapshot pin', (v: ReturnType<typeof full>) => { v.decisions[0].versions.snapshot = 'other'; }],
    ['terms pin', (v: ReturnType<typeof full>) => { v.decisions[0].versions.terms = 'other'; }],
    ['decision context', (v: ReturnType<typeof full>) => { Object.assign(v.decisions[0].versions, { context: 'other' }); }],
    ['shared policy', (v: ReturnType<typeof full>) => { v.decisions[0].versions.policy = 'other'; }],
    ['availability pin', (v: ReturnType<typeof full>) => { v.decisions[0].evidence.availability.version = 'other'; }],
    ['draft pin', (v: ReturnType<typeof full>) => { v.decisions[0].draftVersion = 3; }],
    ['claim car', (v: ReturnType<typeof full>) => { v.decisions[0].claimInput!.orderUuid = v.decisions[1].orderUuid; }],
    ['claim draft', (v: ReturnType<typeof full>) => { v.decisions[0].claimInput!.expectedDraftVersion = 3; }],
    ['claim context', (v: ReturnType<typeof full>) => { v.decisions[0].claimInput!.expectedContextVersion = 'other'; }],
    ['claim stock version', (v: ReturnType<typeof full>) => { v.decisions[0].claimInput!.expectedStockVersion = 0; }],
    ['claim digest', (v: ReturnType<typeof full>) => { v.decisions[0].claimInput!.expectedTermsDigest = ''; }],
    ['ranked score', (v: ReturnType<typeof full>) => { Object.assign(v.decisions[0], { score: 99 }); }],
    ['different car quote', (v: ReturnType<typeof full>) => { v.cars[0] = { ...v.cars[0], terms: v.cars[1].terms }; }],
    ['eligible omission', (v: ReturnType<typeof full>) => { v.cars.pop(); v.total -= 1; }],
    ['noneligible inclusion', (v: ReturnType<typeof full>) => { v.cars.push(v.decisions[2]); v.total += 1; }],
    ['duplicate car', (v: ReturnType<typeof full>) => { v.cars[1] = v.cars[0]; }],
    ['total', (v: ReturnType<typeof full>) => { v.total = 99; }],
    ['state', (v: ReturnType<typeof full>) => { v.state = 'empty-stock'; }],
    ['points unit', (v: ReturnType<typeof full>) => { v.decisions[0].terms.points.unit = 'GBP'; }],
    ['invalid fact', (v: ReturnType<typeof full>) => { v.decisions[0].snapshot.facts.transmission.value = 'not unknown'; }],
  ])('refuses inconsistent %s rather than exposing a validated car', (_name, mutate) => {
    const view = projectStock(envelope(invalid(mutate)));
    expect(view.state).toBe('source-unavailable'); expect(view.allCars).toEqual([]); expect(view.source).toBeNull();
  });

  it.each(['dangling', 'duplicate-id', 'duplicate-key', 'missing-key', 'shared-shadow', 'unknown-shape'])('rejects malformed compact mappings: %s', (kind) => {
    const wire = compact();
    if (kind === 'dangling') wire.carIds.push('missing');
    if (kind === 'duplicate-id') wire.carIds[1] = wire.carIds[0];
    if (kind === 'duplicate-key') wire.sharedVersionKeys.push('stock');
    if (kind === 'missing-key') wire.sharedVersionKeys.push('missing');
    if (kind === 'shared-shadow') Object.assign(wire.decisions[0].versions, { stock: 'wrong' });
    if (kind === 'unknown-shape') wire.payloadShape = 'other';
    expect(validateStockPayload(wire)).toBeNull();
  });

  it('preserves known evidence, reference evidence and unknowns with truthful media fallback', () => {
    const view = projectStock(envelope(full())); const car = view.allCars[0];
    expect(car.detail.exactFacts.map((row) => row.key)).toContain('equipment');
    expect(car.detail.referenceFacts.map((row) => row.key)).toEqual(['boot']);
    expect(car.detail.unclassifiedFacts.map((row) => row.key)).toEqual(['transmission', 'derived']);
    expect(car.fields['transmission']).toMatchObject({ status: 'unknown', value: null, missingLabel: 'Not supplied' });
    expect(car.fields['insuranceGroup'].unit).toBeNull();
    expect(car.media).toMatchObject({ src: null, alt: 'Source car 1', caption: null, images: [] });
    expect(car.emissions.map((row) => row.status)).toEqual(['unknown', 'unknown']);
  });

  it('uses only supplied car names, images, units and emission basis', () => {
    const source = full(); const d = source.decisions[0];
    Object.assign(d.snapshot.display, { name: null, photo: '/stock/one.jpg', images: [{ src: '/stock/one.jpg', alt: 'Supplied alt', caption: 'Supplied caption', provenance: { sourceRef: 'image-source' } }] });
    Object.assign(d.snapshot.facts, { nedcCo2: fact({ value: 122, unit: 'g/km', basis: 'NEDC-correlated' }), wltpCo2: fact({ value: 133, unit: 'g/km', basis: 'NEDC' }) });
    const view = projectStock(envelope(source)); const car = view.allCars[0];
    expect(car.name).toBe('Car name not supplied'); expect(car.media).toMatchObject({ src: '/stock/one.jpg', alt: 'Supplied alt', caption: 'Supplied caption' });
    expect(car.emissions[0]).toMatchObject({ value: 122, status: 'known', basis: 'NEDC-correlated', unit: 'g/km' });
    expect(car.emissions[1]).toMatchObject({ value: null, status: 'unknown', basis: null });
  });

  it('allows no claim input without inventing authority and honours held buddy custody', () => {
    const source = full(); source.decisions[0].claimInput = null;
    expect(projectStock(envelope(source)).allCars[0]).toMatchObject({ reviewAvailable: false, reviewDisabledReason: 'Refresh to review this car.' });
    const held = projectStock(envelope({ ...full(), heldOffer: { offerId: null, runId: 'run-v1' } }));
    expect(held.allCars[0]).toMatchObject({ reviewAvailable: false, reviewDisabledReason: 'Decide on your car offer first.' });
    expect(held.allCars[0].review.claimInput).toEqual(full().decisions[0].claimInput);
  });

  it('supports missing terms for a noneligible car and preserves contribution units', () => {
    const source = full(['needs-confirmation']); Object.assign(source.decisions[0], { terms: null }); source.decisions[0].versions.terms = null as unknown as string;
    expect(projectStock(envelope(source)).allCars[0].cost.value).toBeNull();
    const cash = full(); Object.assign(cash.decisions[0].terms, { contribution: { amount: 45, currency: 'GBP', period: 'month' } });
    expect(projectStock(envelope(cash)).allCars[0].contribution).toEqual({ amount: 45, currency: 'GBP', period: 'month' });
  });

  it('keeps empty stock, no suitable cars and release history distinct', () => {
    expect(projectStock(envelope(full([]))).state).toBe('empty-stock');
    expect(projectStock(envelope(full(['ineligible']))).state).toBe('no-suitable-stock');
    expect(projectStock(envelope({ ...full([]), state: 'nothing-released-yet' })).state).toBe('nothing-released-yet');
    expect(projectStock(envelope({ ...full([]), releaseHistory: history() })).state).toBe('no-visible-releases');
    expect(projectStock(envelope({ ...full([]), state: 'nothing-released-yet', releaseHistory: history(true) })).state).toBe('empty-stock');
    expect(projectStock(envelope({ ...full(), releaseHistory: history(true) })).releaseHistory).toEqual(history(true));
  });

  it.each(['future', 'count', 'duplicate-version', 'wrong-run', 'source-state'])('rejects inconsistent release history: %s', (kind) => {
    const h = history(true);
    if (kind === 'future') h.history.latestReleasedAt = '2026-11-06T12:00:00.000Z';
    if (kind === 'count') h.history.releasedCarCount = 0;
    if (kind === 'duplicate-version') h.history.sourceVersions.push('source-v1');
    if (kind === 'source-state') h.source.state = 'available';
    expect(projectStock(envelope({ ...full(), runId: kind === 'wrong-run' ? 'other' : 'run-v1', releaseHistory: h })).state).toBe('source-unavailable');
  });

  it.each([
    [{ status: 'unavailable', reason: 'source offline' }, 'source-unavailable'],
    [{ status: 'invalid', reasons: [{ field: 'requestedCollectionDate' }] }, 'choices-invalid'],
    [{ status: 'stale-version' }, 'context-refresh'], [{ status: 'stale-run' }, 'context-refresh'],
    [{ status: 'conflict', view: { state: 'car-taken' } }, 'car-taken'],
    [{ status: 'forbidden' }, 'source-unavailable'],
  ])('retains meaningful source failure %j', (failure, state) => {
    expect(projectStock(failure)).toMatchObject({ state, failure, allCars: [], source: null });
  });

  it('detaches source evidence from the transport object', () => {
    const source = full(); const projected = projectStock(envelope(source));
    source.decisions[0].terms.points.value = 9999;
    expect(projected.allCars[0].review.terms?.points.value).toBe(100);
  });
});
