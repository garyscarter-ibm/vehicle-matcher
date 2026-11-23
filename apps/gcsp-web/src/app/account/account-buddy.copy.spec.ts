import { describe, expect, it } from 'vitest';
import { buddyEvents } from './account-buddy.copy';
import { ActivityOffer, ActivityProjection } from '../activity/activity.types';
describe('source Buddy events', () => {
  it('keeps actual projected operation/check/offer creation times, deduplicates offers and sorts newest first', () => {
    const offer: ActivityOffer = { offerRef: { offerId: 'o' }, state: 'accepted', displayState: 'accepted', version: 2, briefVersion: 4, createdAt: '2026-11-22T09:30:00Z' };
    const projection: ActivityProjection = { runId: 'r', employeeId: 'e', asOf: '2026-11-22T10:00:00Z', clockVersion: '1', briefVersion: 4, permission: null, state: 'offer-closed', sourceStatus: 'ok', searchEvidence: { status: 'recorded', checks: 1 }, stateChangesEvidence: { status: 'recorded', rejectedReceipts: 0 }, stateChanges: [{ eventId: 'p', eventType: 'brief-changed', briefVersion: 3, previousBriefVersion: 2, operation: 'paused', occurredAt: '2026-11-22T09:00:00Z' }, { eventId: 'r', eventType: 'brief-changed', briefVersion: 4, previousBriefVersion: 3, operation: 'resumed', occurredAt: '2026-11-22T10:00:00Z' }], lastSuccessfulCheck: { checkedAt: '2026-11-22T09:45:00Z', carsChecked: 4, suitableCars: 1, exclusions: [], outcome: 'offer-held' }, currentOffer: offer, offers: [offer] };
    const events = buddyEvents(projection);
    expect(events.map((event) => event.label)).toEqual(['Search resumed', 'Cars checked', 'Car offered', 'Search paused']); expect(events[2].occurredAt).toBe(offer.createdAt); expect(events[2].detail).toBe('Current offer status: Accepted.'); expect(events.filter((event) => event.id === 'offer:o')).toHaveLength(1);
    expect(buddyEvents()).toEqual([]);
  });
});
