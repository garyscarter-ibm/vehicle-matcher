import { el, button } from '../../vehicle-matcher/ui.js';
import { categoryPreferences, preferenceCategories } from '../kit/category-preferences.js';
import { loadingSkeleton } from '../kit/loading-skeleton.js';
import { createAccountPreferencesController, PREFERENCE_COPY } from './account-preferences-controller.js';

let sequence = 0;
const commandId = (kind) => `${kind}:${globalThis.crypto.randomUUID()}`;

/** Mounts the compact Preferences into Account's one persistent region. Owns its content, so Account redraws never touch it. */
export function mountAccountPreferences(region, { transport, signal, createCommandId = commandId, describeCar, buddyStatusId } = {}) {
  const doc = region.ownerDocument; const id = `gcsp-account-prefs-${++sequence}`;
  const controller = createAccountPreferencesController({ transport, createCommandId });
  let view = null; let described = ''; let failure = null; let skeleton = null; let finished = false; let wasInside = false; let holdAction = false; let shownAttempt = 0;
  const act = { load: () => controller.load(), reload: () => controller.reload(), retry: () => controller.retry() };

  function unavailable(state) {
    const retry = button({ label: 'Try again', variant: 'ghost', onClick: () => { wasInside = true; controller.load(); } });
    const text = el('p', 'gcsp-note', state.status.text); text.setAttribute('role', 'status');
    failure = el('div', 'gcsp-prefs-unavailable'); failure.append(text);
    if (state.status.actionLabel) failure.append(retry);
    region.replaceChildren(failure);
  }
  function render(state) {
    if (finished) return;
    const active = doc.activeElement; const inside = Boolean(active && active !== doc.body && region.contains(active));
    if (state.phase === 'loading' && !view) {
      failure = null;
      if (!skeleton) { skeleton = loadingSkeleton({ label: state.status.text, layout: 'form' }); region.replaceChildren(skeleton); }
      return;
    }
    if (state.phase === 'failed' && !view) { skeleton = null; unavailable(state); return; }
    skeleton = null; failure = null;
    const lane = state.sameAgain; const score = state.understanding; const lamp = state.buddy;
    const action = { label: lamp.state === 'engaged' ? 'Disengage Buddy' : 'Engage Buddy', disabled: lamp.state === 'unknown' || Boolean(lamp.pending) || lamp.waiting };
    const next = { categories: state.categories, open: state.open, pendingRemoval: state.pendingRemoval, disabled: state.disabled,
      ...(lane ? { sameAgain: { on: lane.on, available: lane.available, reason: lane.reason } } : {}), ...(score ? { understanding: score } : {}), action,
      status: null };
    // At rest with no readable engagement, the footer says why the action is disabled and offers a reload.
    const shown = state.status.kind === 'idle' && lamp.state === 'unknown'
      ? { kind: 'failed', text: PREFERENCE_COPY.buddyUnknown, actionLabel: 'Reload preferences', action: 'reload' } : state.status;
    next.status = { kind: shown.kind, text: shown.text, ...(shown.actionLabel ? { actionLabel: shown.actionLabel,
      onAction: () => { wasInside = true; act[shown.action]?.(); } } : {}) };
    if (!view) {
      described = describeCar?.() ?? ''; view = categoryPreferences({ id, categories: preferenceCategories(state.projection), state: next,
        minimum: state.projection.minimumCategories,
        action: { describedBy: [`${id}-status`, buddyStatusId].filter(Boolean).join(' '), onClick: () => { holdAction = true; (controller.snapshot().buddy.state === 'engaged' ? controller.disengage() : controller.engage()); } },
        ...(state.projection.understanding ? { understanding: { maximum: state.projection.understanding.maximum } } : {}),
        ...(lane ? { sameAgain: { description: describeCar?.() ?? '', onToggle: (on) => controller.toggleSameAgain(on) } } : {}),
        onOpen: (key) => controller.open(key), onClose: () => controller.close(),
        onChange: (key, change) => controller.change(key, change),
        onRemove: (key) => controller.requestRemove(key), onKeep: (key) => controller.keep(key),
        onConfirmRemove: (key) => { controller.confirmRemove(key); view.focusCategory(key); } });
      region.replaceChildren(view.root);
      if (wasInside) view.root.querySelector('h2')?.focus();
    } else {
      view.update(next);
      const car = lane && describeCar ? describeCar() : null;
      if (car !== null && car !== described) { described = car; view.setSameAgainDescription(car); }
    }
    // A disabled button drops focus in some browsers: give it back once it works again, and focus the status when the minimum is unmet.
    const attempt = state.status.focus === 'status' ? state.status.attempt : 0;
    if (attempt && attempt !== shownAttempt) { holdAction = false; view.focusStatus(); }
    shownAttempt = attempt || shownAttempt;
    const button = view.actionButton;
    if (holdAction && button && !button.disabled) { if (!doc.activeElement || doc.activeElement === doc.body) button.focus(); holdAction = false; }
    // A status button that vanished with the focus on it hands focus to the heading, never to the page.
    if ((inside || wasInside) && (!doc.activeElement || doc.activeElement === doc.body)) view.root.querySelector('h2')?.focus();
    wasInside = false;
  }
  const stop = controller.subscribe(render);
  function teardown() {
    if (finished) return;
    finished = true; stop(); controller.destroy(); view?.destroy(); view = null; region.replaceChildren();
    signal?.removeEventListener('abort', teardown);
  }
  if (signal?.aborted) { finished = true; return Object.assign(() => {}, { controller, ready: Promise.resolve() }); }
  signal?.addEventListener('abort', teardown, { once: true });
  const ready = controller.load();
  return Object.assign(teardown, { controller, ready });
}
