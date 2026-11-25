import type { ProductionValueDto } from './planning.types';
// Reduced from the real native HTTP producer capture, 25 November 2026; synthetic identities only.
export function ordersFixture(): ProductionValueDto {
  return { asOf: '2026-11-05T09:01:00Z', provider: { mode: 'synthetic', status: 'available',
    choices: [{ model: '3 Series Saloon', derivative: '320i' }, { model: 'i5 Touring', derivative: 'eDrive40' }] },
    versions: { policy: 'p1', stock: 's1', clock: '2026-11-05T09:01:00Z' },
    submissions: [{ submissionId: 'submission-1', planId: 'manual:submission-1', requestedAt: '2026-11-05T09:01:00Z' }],
    requests: [{ requestId: 'request-1', submissionId: 'submission-1', planId: 'manual:submission-1', model: '3 Series Saloon', derivative: '320i',
      quantity: 3, state: 'delayed', stage: 'delayed', version: 6, confirmedQuantity: 1, queuedQuantity: 1, releasedQuantity: 0,
      outstandingQuantity: 2, message: 'Delayed: Transport delayed. 1 of 3 confirmed.', reason: 'Transport delayed.', delayUntil: '2099-01-20T09:00:00Z',
      supplies: [{ supplyId: 'supply-1', quantity: 1, confirmedAt: '2026-11-05T09:01:00Z', queued: true, eligibleFrom: '2026-11-06T09:01:00Z', releasedQuantity: 0 }],
      history: [{ seq: 1, state: 'delayed', at: '2026-11-05T09:01:00Z', details: { reason: 'Transport delayed.' } }] }] };
}
