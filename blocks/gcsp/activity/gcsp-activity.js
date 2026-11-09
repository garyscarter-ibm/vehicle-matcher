// Embeddable activity consumer. The injected adapter owns account, permission and command authority.
import { el, screenIntro, statusScreen } from '../../vehicle-matcher/ui.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { PORTAL_NAVIGATION } from '../employee/portal-navigation.js';
import { mountHelp } from '../cases/gcsp-help.js';
import { activityBody } from './activity-body.js';
import { createActivityController } from './activity-controller.js';
import { runRestartedScreen } from '../kit/run-restarted.js';
import { focusKeyOf, findByFocusKey, keepScroll } from '../kit/focus-key.js';
import { viewStatus } from '../kit/view-status.js';

export const ACTIVITY_DESTINATION = PORTAL_NAVIGATION.find((item) => item.key === 'activity');

export function mountActivity(root, { adapter = {}, brand = 'bmw', onNavigate, signal, offerDisplay, helpAdapter, reload } = {}) {
  let done = false; let controller; let stopShell; let stopHelp;
  const abort = new AbortController();
  const teardown = () => {
    if (done) return;
    done = true; abort.abort(); controller?.destroy(); stopHelp?.(); stopShell?.();
    signal?.removeEventListener('abort', teardown); root.replaceChildren();
  };
  teardown.refresh = () => controller?.refresh() || Promise.resolve();
  if (signal?.aborted) { teardown(); return teardown; }
  signal?.addEventListener('abort', teardown, { once: true });
  stopShell = mountEmployee(root, { brand, view: 'activity', signal: abort.signal,
    onNavigate,
    loadAccount: typeof adapter.loadAccount === 'function' ? (input) => adapter.loadAccount(input) : undefined,
    renderBody(main, { account }) {
      let body; let stopped = false; let restoringFocus = false; let unsubscribeClock;
      const announcement = viewStatus({ className: 'gcsp-vh gcsp-activity-announcement' });
      const content = el('div');
      // Help sits outside the repainted body so a repaint never resets an open help form.
      const helpRegion = helpAdapter && account.status === 'ready' ? el('section', 'gcsp-activity-help') : null;
      if (helpRegion) helpRegion.setAttribute('aria-label', 'Renewal help');
      main.replaceChildren(...[content, helpRegion, announcement.root].filter(Boolean));
      const ownedHelp = helpRegion ? mountHelp(helpRegion, { embedded: true, adapter: helpAdapter, headingLevel: 2, announce: announcement.announce }) : null;
      stopHelp = ownedHelp;
      const FOCUSABLE = 'button, a[href]';
      const paint = (state) => {
        if (done || stopped) return;
        const active = root.ownerDocument.activeElement; announcement.clear();
        const ownedFocus = body?.contains(active) || restoringFocus && active === main;
        const held = body?.contains(active) && active.closest(FOCUSABLE) ? focusKeyOf(active.closest(FOCUSABLE)) : null;
        body?.destroy?.();
        if (state.phase === 'loading') {
          body = el('div', 'vm gcsp-activity');
          body.append(screenIntro({ title: 'Buddy activity' }), statusScreen({ title: 'Loading activity', role: null }));
        } else if (state.phase === 'restarted') {
          body = el('div', 'vm gcsp-activity');
          body.append(screenIntro({ title: 'Buddy activity' }), runRestartedScreen({ reload }));
        } else {
          body = activityBody({ announce: announcement.announce, result: state.result, pending: state.pending, offerDisplay: state.offerDisplay ?? offerDisplay,
            onRetry: account.status === 'ready' ? () => controller?.refresh() : undefined,
            onPause: typeof adapter.pause === 'function' ? () => controller?.pause() : undefined,
            onResume: typeof adapter.resume === 'function' ? () => controller?.resume() : undefined,
            onReviewBrief: typeof onNavigate === 'function' ? () => onNavigate('brief') : undefined });
        }
        keepScroll(root.ownerDocument.defaultView, () => content.replaceChildren(body)); announcement.announce(state.message);
        if (ownedFocus) {
          if (state.phase === 'loading') { main.tabIndex = -1; main.focus(); restoringFocus = active?.tagName === 'H1' || restoringFocus === 'heading' ? 'heading' : true; }
          else {
            const target = (held && findByFocusKey(body, held, FOCUSABLE)) || ((active?.tagName === 'H1' || restoringFocus === 'heading') && body.querySelector('h1')) || body.querySelector('.gcsp-action-trigger') || body.querySelector('button:not(:disabled)') || body.querySelector('h1');
            if (target) { if (target.tagName === 'H1') target.tabIndex = -1; target.focus(); }
            restoringFocus = false;
          }
        } else restoringFocus = false;
      };
      if (account.status !== 'ready') paint({ phase: 'unavailable', result: null, message: '' });
      else {
        controller = createActivityController({ adapter, onChange: paint });
        controller.refresh();
        unsubscribeClock = adapter.subscribeClock?.(() => controller?.sync());
      }
      const ownedController = controller;
      return () => { stopped = true; unsubscribeClock?.(); body?.destroy?.(); ownedHelp?.(); ownedController?.destroy(); if (controller === ownedController) controller = null; };
    },
  });
  if (done) stopShell();
  return teardown;
}

export class GcspActivityElement extends HTMLElement {
  static get observedAttributes() { return ['brand']; }
  constructor() {
    super();
    for (const key of ['adapter', 'helpAdapter']) if (Object.hasOwn(this, key)) { const value = this[key]; delete this[key]; this[`_${key}`] = value; }
    this._adapter = this._adapter || null;
    this._teardown = null;
  }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value || null; if (this.isConnected) this._mount(); }
  get helpAdapter() { return this._helpAdapter ?? undefined; }
  set helpAdapter(value) { this._helpAdapter = value || undefined; if (this.isConnected) this._mount(); }
  get brand() { return this.getAttribute('brand') || 'bmw'; }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._unmount(); }
  attributeChangedCallback(name, before, after) { if (before !== after && this.isConnected) this._mount(); }
  refresh() { return this._teardown?.refresh() || Promise.resolve(); }
  _unmount() { this._teardown?.(); this._teardown = null; }
  _mount() {
    this._unmount();
    this._teardown = mountActivity(this, { adapter: this._adapter || {}, brand: this.brand,
      offerDisplay: this._adapter?.offerDisplay, helpAdapter: this._helpAdapter,
      onNavigate: (to) => {
        const EventType = this.ownerDocument.defaultView.CustomEvent;
        this.dispatchEvent(new EventType('gcsp:navigate', { detail: { from: 'activity', to }, bubbles: true, composed: true, cancelable: true }));
      } });
  }
}

export function defineGcspActivity(registry = globalThis.customElements) {
  if (!registry) return null;
  const existing = registry.get('gcsp-activity');
  if (existing) return existing;
  registry.define('gcsp-activity', GcspActivityElement); return GcspActivityElement;
}
