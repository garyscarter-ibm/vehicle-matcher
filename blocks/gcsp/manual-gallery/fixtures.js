// Dated synthetic gallery examples only. This module is never imported by the live adapter.
const provenance = { sourceRef: 'fixture:manual-gallery:2026-11-05', observedAt: '2026-11-05T12:00:00.000Z', version: 'gallery-v1', assurance: 'synthetic-scenario' };
const fact = (value, unit = null, assurance = 'synthetic-scenario') => ({ status: value == null ? 'unknown' : 'known', value, unit, provenance: { ...provenance, assurance } });
export const MANUAL_GALLERY_FIXTURES = ['available', 'empty-stock', 'nothing-released-yet', 'no-suitable-stock', 'source-unavailable', 'context-refresh', 'car-taken'];
export function createManualGalleryFixture(name = 'available') {
  if (!MANUAL_GALLERY_FIXTURES.includes(name)) throw new RangeError('Unknown manual gallery fixture');
  if (name === 'source-unavailable') return { status: 'unavailable' };
  if (name === 'context-refresh') return { status: 'stale-version' };
  if (name === 'car-taken') return { status: 'conflict', view: { state: 'car-taken' } };
  const decisions = Array.from({ length: 3 }, (_, index) => {
    const orderUuid = `gallery-stock-${index + 1}`; const orderNumber = `481516${index + 1}`;
    const eligible = name !== 'no-suitable-stock' && index !== 2;
    const photo = index === 1 ? null : '/assets/brand-hero/bmw.jpg';
    const display = { name: index === 1 ? 'BMW 330e M Sport Pro Edition Touring with Technology Plus and Comfort Pack' : index === 2 ? 'BMW 530e M Sport Touring' : 'BMW 320i M Sport Touring',
      photo, images: photo ? [{ src: photo, alt: 'BMW brand image', caption: 'BMW brand image, not this car', provenance }] : [] };
    const facts = { model: fact(index === 2 ? '530e' : index === 1 ? '330e' : '320i'), series: fact(index === 2 ? '5 Series' : '3 Series'), body: fact('Touring'), engine: fact(index ? 'Plug-in hybrid' : 'Petrol'),
      exterior: fact(index ? 'Brooklyn Grey metallic' : 'Portimao Blue metallic'), interior: fact('Black Vernasca leather'), transmission: fact('Automatic'), insuranceGroup: fact(index === 2 ? 42 : 25),
      earliestCollection: fact(index ? '2026-12-21' : '2026-12-14'), nedcCo2: fact(index ? null : { value: 0, unit: 'g/km', basis: 'NEDC-correlated' }),
      wltpCo2: fact(index === 1 ? null : { value: index ? 29 : 143, unit: 'g/km', basis: 'WLTP' }),
      equipment: fact([{ code: 'S0488', name: 'Lumbar support for driver and front passenger with additional comfort adjustment' }, { code: 'S05DN', name: 'Parking Assistant Plus' }]),
      specifications: fact({ electricRange: index ? '58 km' : null, fuelConsumption: 'Not supplied' }, null, 'model-reference'), historic: fact({ previousSchemeUse: 'Not supplied' }) };
    const snapshot = { identityKind: 'exact-stock', sourceNamespace: 'fixture:manual-gallery', sourceKeys: { stockId: orderUuid }, snapshotVersion: 'gallery-v1', observedAt: provenance.observedAt, display, facts };
    return { orderUuid, orderNumber, configurationId: `gallery-config-${index + 1}`, candidateKey: `fixture:${orderUuid}`, snapshot, gateStatus: eligible ? 'eligible' : 'ineligible',
      blockers: eligible ? [] : [{ code: 'allowance-exceeded', text: 'This car exceeds your monthly points allowance.' }], unknowns: [], draftVersion: 2,
      versions: { stock: 4 }, terms: { kind: 'employee-scheme', points: { value: index === 2 ? 1400 : 1100, unit: 'points' }, allowanceInputs: { allowance: { value: 1300, unit: 'points' } }, contribution: null },
      claimInput: eligible ? { orderUuid, expectedStockVersion: 4, expectedDraftVersion: 2, expectedContextVersion: 'fixture-context', expectedTermsDigest: `fixture-terms-${index}` } : null };
  });
  return { status: 'ok', value: { state: ['empty-stock', 'nothing-released-yet'].includes(name) ? name : name === 'no-suitable-stock' ? 'no-eligible-stock' : 'available-stock',
    decisions: ['empty-stock', 'nothing-released-yet'].includes(name) ? [] : decisions, versions: { context: 'fixture-context', draft: 2 }, ranked: false, browsingReservesStock: false } };
}
export function createManualGalleryFixtureAdapter(name = 'available') {
  return { readOnly: true, loadAccount: async () => ({ status: 'ready', name: 'Paula Mason', context: 'Read-only fixture · 5 November 2026' }),
    browseStock: async () => createManualGalleryFixture(name), readClaim: async () => ({ status: 'not-found' }),
    claim: async () => ({ status: 'forbidden', code: 'read-only-gallery' }) };
}
