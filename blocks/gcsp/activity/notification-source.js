// Bell data: rows from the existing activity read, and a live source that re-reads on triggers. No new routes or stores.
import { demoTime } from '../kit/activity-timeline.js';
import { isDisplayImage } from '../kit/vehicle-image-assets.js';
import { approvedImages } from './activity-offer.js';
import { respondBy } from './activity-copy.js';

const MAX_ROWS = 6;
const hhmm = (instant) => demoTime(instant).split(', ').pop();
const by = (offer) => (respondBy(offer) ? `Respond by ${hhmm(offer.expiresAt)}` : null);
const ok = (value) => value && Array.isArray(value.offers) && Array.isArray(value.stateChanges);
const timeOf = (instant) => (Number.isFinite(Date.parse(instant)) ? Date.parse(instant) : -Infinity);

function thumb(display) {
  const image = (Array.isArray(display?.images) ? display.images : []).find((item) => typeof item?.src === 'string'
    && (approvedImages.get(item.src) === (item.kind ?? item.fidelity) || isDisplayImage(item.src, item.kind ?? item.fidelity)));
  return image ? { src: image.src } : null;
}

function offerRow(offer, { display, current }) {
  const car = display?.title || null; const image = current ? thumb(display) : null; const key = `offer:${offer.offerRef.offerId}`;
  const base = { key, kind: 'offer', ...(image ? { image } : {}) };
  if (offer.state === 'active') {
    const until = by(offer);
    return { ...base, ...(car ? { car } : {}), waiting: true, title: 'Your buddy found a car',
      detail: until ? `Reserved for you. ${until}.` : 'Reserved for you.',
      action: typeof offer.href === 'string' && offer.href.startsWith('/') ? { label: 'View your offer', href: offer.href, variant: 'button' } : null };
  }
  if (offer.state === 'expired') return { ...base, ...(car ? { car } : {}), title: 'Your offer expired.',
    action: typeof offer.href === 'string' && offer.href.startsWith('/') ? { label: 'View expired offer', href: offer.href, variant: 'link' } : null };
  return null;
}

/**
 * Current/new and expired offers only. Other Buddy events remain in its history.
 * `display` is the car title and images of the newest offer only (readOfferDisplay), or null.
 */
export function notificationRows(activity, display = null) {
  if (!ok(activity)) return [];
  const currentId = activity.currentOffer?.offerRef?.offerId;
  const rows = [];
  if (activity.currentOffer?.offerRef?.offerId) { const row = offerRow(activity.currentOffer, { display, current: true }); if (row) rows.push(row); }
  const seen = new Set([currentId]);
  const rest = activity.offers.filter((offer) => offer?.offerRef?.offerId && offer.state === 'expired'
    && !seen.has(offer.offerRef.offerId) && seen.add(offer.offerRef.offerId))
    .sort((a, b) => timeOf(b.expiresAt ?? b.createdAt) - timeOf(a.expiresAt ?? a.createdAt));
  rows.push(...rest.map((offer) => offerRow(offer, { display: null, current: false })));
  return rows.slice(0, MAX_ROWS);
}

/** The bell model for one successful read. `note` is set by the source, never here. */
export function notificationModel(activity, display) {
  const waiting = activity.currentOffer?.state === 'active' ? 1 : 0;
  return { status: 'ok', waiting, rows: notificationRows(activity, display), note: null };
}

/**
 * Live bell source over an activity adapter { readActivity, readOfferDisplay }. `subscribe(listener)` is the presenter-action
 * subscription. connect(update) starts reading and returns a disconnect; refresh() asks for a read; one read runs at a time.
 */
export function createNotificationSource({ adapter = {}, subscribe, document: doc = globalThis.document, pollMs = 30000,
  setTimer = globalThis.setInterval, clearTimer = globalThis.clearInterval } = {}) {
  let model = { status: 'loading', waiting: 0, rows: [], note: null };
  let update = null; let stops = []; let timer = null; let abort = null; let busy = false; let again = false;
  let hasRead = false; let activeId = null; let display = null; let connection = 0;
  const win = () => doc?.defaultView;
  const visible = () => doc?.visibilityState !== 'hidden';
  // The note is a one-off: the kept model never carries it, so a remounted shell does not repeat it.
  const push = (next) => { model = { ...next, note: null }; update?.(next); };

  async function readOnce(signal) {
    let out;
    try { out = await adapter.readActivity?.({ signal }); } catch { out = null; }
    if (signal.aborted) return;
    if (out?.status !== 'ok' || !ok(out.value)) {
      // A later failure keeps the last state; before any read the panel says it is unavailable.
      if (!hasRead) push({ ...model, status: 'unavailable', waiting: 0, rows: [], note: null });
      return;
    }
    const value = out.value; const offer = value.currentOffer; const offerId = offer?.offerRef?.offerId;
    if (offerId && display?.offerRef?.offerId !== offerId) display = null;
    if (offerId && !display && typeof adapter.readOfferDisplay === 'function') {
      try { display = await adapter.readOfferDisplay({ offerId, runId: value.runId, signal }) ?? null; } catch { display = null; }
      if (signal.aborted) return;
    }
    const next = notificationModel(value, offerId ? display : null);
    const nowActive = offer?.state === 'active' ? offerId : null;
    if (hasRead && nowActive && nowActive !== activeId) {
      const text = [display?.title, by(offer)].filter(Boolean).join('. ');
      next.note = { id: nowActive, title: 'Your buddy found a car', text: text ? `${text}.` : 'Reserved for you.' };
    }
    hasRead = true; activeId = nowActive; push(next);
  }

  async function read() {
    if (!update) return;
    if (busy) { again = true; return; }
    busy = true; const mine = connection; abort = new AbortController();
    try { await readOnce(abort.signal); } finally { if (mine === connection) busy = false; }
    if (again && mine === connection && update) { again = false; read(); } else again = false;
  }
  const poll = () => { if (visible() && !busy) read(); };
  function arm() {
    if (timer != null || !Number.isFinite(pollMs) || pollMs <= 0 || !visible()) return;
    timer = setTimer(poll, pollMs);
  }
  function disarm() { if (timer != null) clearTimer(timer); timer = null; }
  // A restored (cached) page is stale; a first load already read on connect.
  const onPageshow = (event) => { if (event?.persisted) read(); };
  function onVisibility() { if (visible()) { arm(); read(); } else disarm(); }
  function disconnect(token) {
    if (token !== connection) return;
    connection += 1; update = null; again = false; abort?.abort(); abort = null; busy = false; disarm();
    for (const stop of stops.splice(0)) stop();
  }

  return {
    getModel: () => model,
    refresh: () => read(),
    connect(next) {
      disconnect(connection);
      const token = ++connection; update = next; update(model);
      const stopAction = subscribe?.(() => read());
      doc?.addEventListener('visibilitychange', onVisibility); win()?.addEventListener('pageshow', onPageshow);
      stops = [stopAction, () => { doc?.removeEventListener('visibilitychange', onVisibility); win()?.removeEventListener('pageshow', onPageshow); }].filter(Boolean);
      arm(); read();
      return () => disconnect(token);
    },
    destroy() { disconnect(connection); },
  };
}
