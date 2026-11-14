import { ApplicationContext } from '../auth/auth.port';
import { OfferFact, OfferProjection, OfferProvenance } from './offer.types';

export const offerScreenEmployee: ApplicationContext = {
  subject: 'employee-subject', employeeId: 'employee-1', roles: ['employee'], environmentId: 'dev', runId: 'run-1', policyVersion: 'policy-v2', capabilities: [],
};
const observedAt = '2026-11-14T09:00:00.000Z';
const provenance: OfferProvenance = { sourceRef: 'fixture:offer-screen', observedAt, version: 'facts-v1', assurance: 'synthetic-scenario' };
export const screenFact = (value: OfferFact['value'], unit: string | null = null): OfferFact => ({ status: value === null ? 'unknown' : 'known', value, unit, provenance });

export function offerScreenFixture(state: OfferProjection['state'] = 'pending'): OfferProjection {
  return {
    schemaVersion: 1, offerId: 'offer-1', runId: 'run-1', state, reason: state === 'pending' ? 'offer-active' : state,
    serverNow: '2026-11-14T12:30:00.000Z', expiresAt: '2026-11-14T14:30:00.000Z', clockVersion: 'clock-v3',
    offerVersion: 2, holdVersion: 4, offerState: state === 'pending' ? 'active' : state === 'declined' ? 'rejected' : state,
    holdState: state === 'pending' ? 'active' : state === 'accepted' ? 'allocated' : 'released',
    availableActions: state === 'pending' ? ['accept', 'decline'] : [], followup: state === 'declined' ? { decisionId: 'decision-1' } : null,
    handoff: state === 'pending' ? {
      termsVersion: 'terms-v1', termsDigest: 'digest-v1', wording: 'Selection requests allocation of this exact scheme stock order under the recorded quote. Approval, appointment and collection are separate decisions; submission does not end the current contract.',
      fictional: true, mode: 'replacement', blocker: null, driver: null, returnMileage: { maximum: 500000, unit: 'mi' },
      documentSource: { terms: 'ordering.terms.v1', termsVersion: 'terms-v1', recordSource: 'employee-contract' },
      declarations: [{ id: 'terms', label: 'I accept these scheme terms.' }], contact: { phone: '07700 900123', email: 'paula.mason@gcsp-demo.com' }, returnCar: null,
    } : null,
    selection: state === 'accepted' ? { schemaVersion: 1, selectionState: 'acknowledged', approved: false, current: 'HR approval', orderReference: 'GCSP-000123', orderNumber: '0123456',
      stages: [{ name: 'selection received', state: 'complete' }, { name: 'HR approval', state: 'waiting' }, { name: 'sent to ordering', state: 'not-started' }] } : null,
    quote: {
      quoteId: 'quote-1', configurationId: 'configuration-1', orderUuid: 'stock-1', orderNumber: '0123456', briefVersion: 5,
      policyVersion: 'policy-v2', quotedAt: observedAt, validUntil: '2026-11-14T14:30:00.000Z', revisions: { quote: 3 },
      facts: { contractVersion: 'vehicle-snapshot-v1', identityKind: 'exact-stock', candidateKey: 'source:stock-1', sourceNamespace: 'fixture:employee',
        snapshotVersion: 'snapshot-v1', observedAt, sourceKeys: { stockId: 'stock-1' },
        display: { name: 'BMW 330e M Sport Touring', photo: null, images: [], manufacturer: 'BMW', model: '3 Series', derivative: 'M Sport Pro package' },
        facts: { body: screenFact('Touring'), fuel: screenFact('Plug-in hybrid'), boot: screenFact(410, 'litres'), seats: screenFact(5),
          colour: screenFact('Alpine White'), interior: screenFact('Black Veganza'), availableFrom: screenFact('1 December 2026'),
          options: screenFact(['Heated seats', 'Parking assistance']), gearbox: screenFact('Automatic'), mileage: screenFact(null, 'mi'),
          frontIsofix: screenFact(false), rearIsofix: screenFact(true), tags: screenFact([]) },
      },
      decision: { gateStatus: 'eligible', score: 78, reasons: ['Available by Tuesday 1 December 2026.', { code: 'essential-met', field: 'seats', fact: screenFact(5), requirement: { operator: 'gte', value: 5, unit: 'count' } }],
        tradeOffs: ['Less sporty than you prefer.', { code: 'preference-fit', field: 'body', desired: 'Estate', facts: { body: screenFact('Touring') } }], blockers: [], unknowns: [{ text: 'Mileage needs confirmation.', field: 'mileage', fact: screenFact(null, 'mi') }] },
      terms: { kind: 'employee-scheme', termsVersion: 'terms-v1', validFrom: observedAt, validUntil: '2026-11-14T14:30:00.000Z', points: { value: 295, unit: 'points' },
        allowanceInputs: { allowance: { value: 620, unit: 'points' } }, contribution: { amount: 12.5, currency: 'GBP', period: 'month' }, provenance },
      allowance: { allowance: { value: 620, unit: 'points' } },
    },
    comparison: { status: 'partial', reason: 'current-car-facts-recorded', comparisonAvailable: true,
      currentCar: { model: 'BMW 320i M Sport Touring', source: { mode: 'dated-snapshot', sourceVersion: 'contract-v1', observedAt },
        facts: { configuration: { value: '320i Automatic', unit: null }, body: { value: 'Estate', unit: null }, boot: { value: 440, unit: 'L' }, points: { value: 595, unit: 'points-per-month' } } },
      unknowns: ['fuel', 'seats', 'zeroTo62', 'mpg'] },
  };
}
