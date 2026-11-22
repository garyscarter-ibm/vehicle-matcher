import { NotificationModel, NotificationRow } from '../kit/notification-bell.types';
import { isApprovedActivityThumbnail } from './activity-image-registry';
import { formatActivityTime, respondBy } from './activity.copy';
import { ActivityOffer, ActivityOfferDisplay, ActivityProjection } from './activity.types';

export const notificationDeadline = (offer: ActivityOffer): string | null => respondBy(offer)
  ? `Respond by ${formatActivityTime(offer.expiresAt!).split(', ').pop()}` : null;
const timeOf = (value: string | null | undefined): number => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
const localAction = (href: string | undefined): href is string => typeof href === 'string' && href.startsWith('/gcsp/') && !href.startsWith('//');

function offerRow(offer: ActivityOffer, display: ActivityOfferDisplay | null, current: boolean): NotificationRow | null {
  const image = current ? display?.images.find(isApprovedActivityThumbnail) : null;
  const base = { key: `offer:${offer.offerRef.offerId}`, kind: 'offer' as const,
    ...(image ? { image: { src: image.src } } : {}), ...(display?.title ? { car: display.title } : {}) };
  if (offer.state === 'active') {
    const until = notificationDeadline(offer);
    return { ...base, waiting: true, title: 'Your buddy found a car', detail: until ? `Reserved for you. ${until}.` : 'Reserved for you.',
      action: localAction(offer.href) ? { label: 'View your offer', href: offer.href, variant: 'button' } : null };
  }
  if (offer.state === 'expired') return { ...base, title: 'Your offer expired.',
    action: localAction(offer.href) ? { label: 'View expired offer', href: offer.href, variant: 'link' } : null };
  return null;
}

export function notificationRows(activity: ActivityProjection, display: ActivityOfferDisplay | null = null): readonly NotificationRow[] {
  const rows: NotificationRow[] = [];
  const current = activity.currentOffer;
  if (current?.offerRef.offerId) { const row = offerRow(current, display, true); if (row) rows.push(row); }
  const seen = new Set([current?.offerRef.offerId]);
  const rest = activity.offers.filter((offer) => offer.offerRef.offerId && offer.state === 'expired'
    && !seen.has(offer.offerRef.offerId) && seen.add(offer.offerRef.offerId))
    .sort((a, b) => timeOf(b.expiresAt ?? b.createdAt) - timeOf(a.expiresAt ?? a.createdAt));
  for (const offer of rest) { const row = offerRow(offer, null, false); if (row) rows.push(row); }
  return rows.slice(0, 6);
}

export function notificationModel(activity: ActivityProjection, display: ActivityOfferDisplay | null = null): NotificationModel {
  return { status: 'ok', waiting: activity.currentOffer?.state === 'active' ? 1 : 0, rows: notificationRows(activity, display), note: null };
}
