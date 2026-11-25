import { describe, expect, it } from 'vitest';
import { notificationDeadline, notificationModel, notificationRows } from './notification.model';
import { ActivityOffer, ActivityOfferDisplay, ActivityProjection } from './activity.types';

export const offer = (id: string, state = 'active', expiresAt = '2026-07-01T12:30:00Z'): ActivityOffer => ({
  offerRef: { offerId: id }, state, displayState: 'active', version: 1, briefVersion: 1, expiresAt, href: `/gcsp/offers/${id}`,
});
export const activity = (currentOffer: ActivityOffer | null = null, offers: readonly ActivityOffer[] = []): ActivityProjection => ({
  runId: 'run', employeeId: 'paula', asOf: '2026-07-01T12:00:00Z', clockVersion: '1', briefVersion: null,
  permission: null, state: 'never-searched', lastSuccessfulCheck: null, searchEvidence: { status: 'not-recorded', reason: 'no-search-check-yet' },
  sourceStatus: 'not-checked', currentOffer, offers, stateChanges: [], stateChangesEvidence: { status: 'not-recorded', rejectedReceipts: 0 },
});
export const display: ActivityOfferDisplay = { offerRef: { offerId: 'new' }, state: 'active', version: 1, title: 'BMW X2',
  images: [{ src: '/assets/brand-hero/bmw.jpg', kind: 'representative' }] };

describe('notification projection', () => {
  it('keeps the frozen active DOM model, approved thumbnail and London HH:MM deadline', () => {
    const model = notificationModel(activity(offer('new')), display);
    expect(model.waiting).toBe(1); expect(model.note).toBeNull();
    expect(model.rows[0]).toEqual({ key: 'offer:new', kind: 'offer', waiting: true, title: 'Your buddy found a car', car: 'BMW X2',
      detail: 'Reserved for you. Respond by 13:30.', image: { src: '/assets/brand-hero/bmw.jpg' },
      action: { label: 'View your offer', href: '/gcsp/offers/new', variant: 'button' } });
  });
  it('keeps a time-only deadline when the full Activity formatter uses WebKit punctuation', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format')!;
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', { ...descriptor, get(this: Intl.DateTimeFormat) {
      const original = descriptor.get!.call(this);
      return this.resolvedOptions().year ? () => '23 Nov 2026 at 13:30' : original;
    } });
    try {
      const model = notificationModel(activity(offer('new', 'active', '2026-11-23T13:30:00Z')), display);
      expect(model.rows[0].detail).toBe('Reserved for you. Respond by 13:30.');
    } finally {
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', descriptor);
    }
  });
  it.each([
    ['2026-11-23T13:30:00Z', '13:30'],
    ['2026-07-01T12:30:00Z', '13:30'],
    ['2026-11-23T00:05:00Z', '00:05'],
    ['2026-07-01T23:05:00Z', '00:05'],
  ])('keeps London HH:MM for the seasonal expiry %s', (expiresAt, deadline) => {
    expect(notificationDeadline(offer('new', 'active', expiresAt))).toBe(`Respond by ${deadline}`);
  });
  it('omits deadlines for inactive offers and missing or invalid expiry values', () => {
    for (const state of ['accepted', 'expired', 'decision-pending']) expect(notificationDeadline(offer('new', state))).toBeNull();
    for (const expiresAt of [null, undefined, '', 'not-a-date']) expect(notificationDeadline({ ...offer('new'), expiresAt })).toBeNull();
  });
  it('deduplicates and caps six current/expired offers, newest expired first; ignores other history', () => {
    const rows = notificationRows(activity(offer('new'), [offer('new', 'expired'), offer('accepted', 'accepted'),
      ...Array.from({ length: 9 }, (_, n) => offer(`old-${n}`, 'expired', `2026-06-${String(n + 1).padStart(2, '0')}T12:00:00Z`)), offer('old-8', 'expired')]));
    expect(rows.map((row) => row.key)).toEqual(['offer:new', 'offer:old-8', 'offer:old-7', 'offer:old-6', 'offer:old-5', 'offer:old-4']);
    expect(rows[1].action?.label).toBe('View expired offer'); expect(rows[1].image).toBeUndefined();
    expect(notificationModel(activity(offer('new', 'accepted')), display).waiting).toBe(0);
  });
  it('refuses unapproved thumbnails and nonlocal actions and keeps missing deadline honest', () => {
    const rows = notificationRows(activity({ ...offer('new'), href: '//outside.invalid', expiresAt: null }),
      { ...display, images: [{ src: 'https://outside.invalid/car.jpg', kind: 'representative', alt: 'BMW' }] });
    expect(rows[0].image).toBeUndefined(); expect(rows[0].action).toBeNull(); expect(rows[0].detail).toBe('Reserved for you.');
  });
});
