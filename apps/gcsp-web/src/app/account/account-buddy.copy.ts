import { activityEvents, offerStateLabel } from '../activity/activity.copy';
import { ActivityProjection } from '../activity/activity.types';
import { TimelineEvent } from '../kit/activity-timeline.component';
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
/** Projected events only; an offer's creation is never its later decision time. */
export function buddyEvents(value?: ActivityProjection | null): readonly TimelineEvent[] {
  const operations = new Map((value?.stateChanges ?? []).map((event) => [event.eventId, event.operation]));
  const searchLabels: Readonly<Record<string, string>> = { paused: 'Search paused', resumed: 'Search resumed' };
  const events: TimelineEvent[] = activityEvents(value?.stateChanges).map((event) => ({ ...event, label: searchLabels[operations.get(event.id) ?? ''] ?? event.label }));
  const check = value?.lastSuccessfulCheck;
  if (check) events.push({ id: `check:${check.checkedAt}`, occurredAt: check.checkedAt, label: 'Cars checked', detail: `${check.carsChecked} cars checked, ${check.suitableCars} suitable.` });
  const seen = new Set<string>();
  for (const offer of [value?.currentOffer, ...(value?.offers ?? [])]) {
    const id = offer?.offerRef?.offerId; if (!offer || !id || seen.has(id)) continue;
    seen.add(id); events.push({ id: `offer:${id}`, occurredAt: offer.createdAt, label: 'Car offered', detail: `Current offer status: ${offerStateLabel(offer.state)}.` });
  }
  return events.reverse().sort((a, b) => (validTime(b.occurredAt) ? Date.parse(b.occurredAt) : -Infinity) - (validTime(a.occurredAt) ? Date.parse(a.occurredAt) : -Infinity));
}
