import { el } from '../../vehicle-matcher/ui.js';
import { buddyTile } from '../kit/buddy-tile.js';
import { activityTimeline } from '../kit/activity-timeline.js';
import { sideDrawer } from '../kit/side-drawer.js';
import { viewStatus } from '../kit/view-status.js';
import { runRestartedScreen } from '../kit/run-restarted.js';
import { createActivityController } from '../activity/activity-controller.js';
import { activityEvents, offerStateLabel, respondBy, searchLines, exclusionLines } from '../activity/activity-copy.js';
import { activityOffer } from '../activity/activity-offer.js';
import { PORTAL_ROUTES } from '../employee/portal-navigation.js';

const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
// Only projected events get rows; offer creation never masquerades as the later decision time.
export function buddyEvents(value = {}) {
  const operations = new Map((value.stateChanges ?? []).map((event) => [event.eventId, event.operation]));
  const searchLabels = { paused: 'Search paused', resumed: 'Search resumed' };
  const events = activityEvents(value.stateChanges).map((event) => ({ ...event, label: searchLabels[operations.get(event.id)] ?? event.label }));
  const check = value.lastSuccessfulCheck;
  if (check) events.push({ id: `check:${check.checkedAt}`, occurredAt: check.checkedAt, label: 'Cars checked',
    detail: `${check.carsChecked} cars checked, ${check.suitableCars} suitable.` });
  const seen = new Set();
  for (const offer of [value.currentOffer, ...(value.offers ?? [])].filter(Boolean)) {
    const id = offer.offerRef?.offerId;
    if (!id || seen.has(id)) continue;
    seen.add(id); events.push({ id: `offer:${id}`, occurredAt: offer.createdAt, label: 'Car offered', detail: `Current offer status: ${offerStateLabel(offer.state)}.` });
  }
  return events.reverse().sort((a, b) => (validTime(b.occurredAt) ? Date.parse(b.occurredAt) : -Infinity)
    - (validTime(a.occurredAt) ? Date.parse(a.occurredAt) : -Infinity));
}

export function mountAccountBuddy(region, { adapter, signal, onChanged, onPreferences, openDrawer = sideDrawer } = {}) {
  let state; let drawer; let drawerKind; let drawerBody; let disposed = false;
  const live = viewStatus();
  const review = () => { drawer?.close(); onPreferences?.(); };
  function drawerContent() {
    const value = state?.result?.value;
    if (!value) return [el('p', 'gcsp-note', 'Activity unavailable. Close and try again.')];
    const paused = value.permission?.paused;
    if (drawerKind === 'history') return [activityTimeline({ events: buddyEvents(value), level: 3, heading: 'Activity history' }),
      ...(value.stateChangesEvidence?.status === 'incomplete' ? [el('p', 'gcsp-note', 'Some activity could not be verified.')] : []),
      el('h3', 'gcsp-h3', 'Search status'),
      ...searchLines(value, paused).map((line) => el('p', 'gcsp-note', line)),
      ...exclusionLines(value, paused).map((line) => el('p', '', line)),
      ...(paused ? [el('p', '', 'New searches and holds have stopped. Any held offer stays open until its deadline.')] : [])];
    if (drawerKind === 'offer') return [activityOffer({ offer: value.currentOffer, display: state.offerDisplay, level: 3 })
      ?? el('p', 'gcsp-note', 'There is no current offer.')];
    return [];
  }
  function open(kind, key) {
    drawer?.close(false); drawerKind = kind; drawerBody = el('div', 'gcsp-buddy-drawer-content'); drawerBody.append(...drawerContent());
    drawer = openDrawer({ host: region.closest('.gcsp') ?? region, context: 'Your buddy',
      title: kind === 'history' ? 'Buddy history' : 'Your held offer', body: [drawerBody],
      opener: () => region.querySelector(`[data-focus-key="${key}"]`), onClose: () => { drawer = null; drawerBody = null; } });
  }
  const pause = adapter?.pauseSearch ?? adapter?.pause; const resume = adapter?.resumeSearch ?? adapter?.resume;
  const tile = buddyTile({ id: 'gcsp-account-buddy-status', onPause: typeof pause === 'function' ? async () => { await controller.pauseSearch(); onChanged?.(); } : undefined,
    onResume: typeof resume === 'function' ? async () => { await controller.resumeSearch(); onChanged?.(); } : undefined, onRetry: () => controller.refresh(), onPreferences: review,
    onHistory: () => open('history', 'buddy-history'), onOffer: () => open('offer', 'buddy-offer'), orderHref: PORTAL_ROUTES['order-progress'] });
  region.append(tile.root, live.root);
  const controller = createActivityController({ adapter: { ...adapter, pauseSearch: pause, resumeSearch: resume }, onChange: (next) => {
    if (disposed) return;
    state = next;
    if (state.phase === 'restarted') { drawer?.close(false); tile.root.dataset.state = 'restarted'; tile.root.setAttribute('aria-busy', 'false'); tile.root.replaceChildren(runRestartedScreen()); return; }
    const value = state.result?.value;
    tile.update({ ...state, events: buddyEvents(value), offerTitle: state.offerDisplay?.title, deadline: respondBy(value?.currentOffer) });
    if (drawerBody) {
      const focused = drawerBody.contains(region.ownerDocument.activeElement);
      drawerBody.replaceChildren(...drawerContent());
      if (focused) drawer.panel.querySelector('h2')?.focus();
    }
    live.announce(state.message);
  } });
  const ready = controller.refresh();
  const destroy = () => { if (disposed) return; disposed = true; signal?.removeEventListener('abort', destroy); controller.destroy(); drawer?.close(false); region.replaceChildren(); };
  signal?.addEventListener('abort', destroy, { once: true });
  return Object.assign(destroy, { ready, refresh: controller.refresh, sync: controller.sync, closeDrawer: () => drawer?.close(false) });
}
