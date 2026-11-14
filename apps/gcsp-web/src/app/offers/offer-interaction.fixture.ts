import { offerScreenFixture } from './offer-screen.fixture';
import { OfferDecisionInput, OfferDecisionReceipt, OfferFollowupQuestion, OfferProjection, OfferSavedChange } from './offer.types';

export function actionableOffer(): OfferProjection {
  const offer = offerScreenFixture();
  return { ...offer, handoff: { ...offer.handoff!, driver: { name: 'Paula Mason', kind: 'employee',
    licence: { displayNumber: 'MASON900000PM9XX', categories: ['car'], validFrom: '2010-01-01', validUntil: '2030-01-01' } },
    returnCar: { model: 'BMW 320i Touring', contractEndDate: '2026-12-01', currentOdometer: { value: 5200, unit: 'mi' }, expectedReturnMileage: null },
    declarations: [{ id: 'terms', label: 'I accept these scheme terms.' }, { id: 'driver', label: 'The nominated driver and licence details are correct.' },
      { id: 'return', label: 'The old contract and expected return mileage are correct.' }] } };
}
export function decisionReceipt(input: OfferDecisionInput): OfferDecisionReceipt {
  const offer = actionableOffer();
  return { schemaVersion: 1, runId: input.runId, offerId: input.offerId, commandId: input.commandId, requestedDecision: input.decision,
    decisionId: 'decision-1', state: input.decision === 'accept' ? 'accepted' : 'declined', reason: input.decision === 'accept' ? 'accepted' : 'declined',
    offerState: input.decision === 'accept' ? 'accepted' : 'rejected', holdState: input.decision === 'accept' ? 'allocated' : 'released',
    offerVersion: 3, holdVersion: 5, quoteVersion: 3, quoteId: offer.quote.quoteId, policyVersion: offer.quote.policyVersion,
    expiresAt: offer.expiresAt, serverNow: offer.serverNow, clockVersion: offer.clockVersion, availableActions: [], operationId: null, reconciliationRequired: false };
}
export function followupQuestion(control: OfferFollowupQuestion['question']['control'] = {
  kind: 'options', options: [{ value: 'estate', label: 'Estate' }, { value: 'suv', label: 'SUV' }],
}, currentValue: OfferFollowupQuestion['question']['currentValue'] = 'estate'): OfferFollowupQuestion {
  return { schemaVersion: 1, state: 'question', decisionId: 'decision-1', briefVersion: 7, question: { schemaVersion: 1,
    reasonCode: 'body', path: 'preferences.body.value', prompt: 'Which body style would suit you better?', control, currentValue,
    policyVersion: 'policy-v2', questionVersion: 'question-v2', provenance: { key: 'offer.followupQuestions.v1', status: 'assumed',
      basis: 'Fixture for the existing follow-up contract', source: 'fixture:followup', sourceDate: '2026-11-14' } } };
}
export function savedFollowup(): OfferSavedChange {
  return { schemaVersion: 1, state: 'change-saved', decisionId: 'decision-1', briefVersion: 8, policyVersion: 'policy-v2',
    event: { receiptReference: `brief-change:${'a'.repeat(64)}`, eventType: 'brief-changed', briefVersion: 8, occurredAt: '2026-11-14T12:35:00.000Z' },
    change: { path: 'preferences.body.value', before: 'estate', after: 'suv' } };
}
