// Embeddable activity consumer. The injected adapter owns account, permission and command authority.
import { el, screenIntro, statusScreen } from '../../vehicle-matcher/ui.js';
import { mountEmployee, EMPLOYEE_NAVIGATION } from '../employee/gcsp-employee.js';
import { mountHelp } from '../cases/gcsp-help.js';
import { activityBody } from './activity-body.js';
import { createActivityController } from './activity-controller.js';

export const ACTIVITY_DESTINATION = Object.freeze({ key: 'activity', label: 'Buddy activity', available: true,
  icon: Object.freeze(['M4 5h16', 'M4 12h16', 'M4 19h16', 'M8 3v4', 'M8 10v4', 'M8 17v4']) });

export function mountActivity(root, { adapter = {}, brand = 'bmw', navigation, onNavigate, signal, offerDisplay, helpAdapter } = {}) {
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
    navigation: navigation || [...EMPLOYEE_NAVIGATION.map((item) => ({ ...item, available: false, unavailableReason: 'Not available in this demo' })), ACTIVITY_DESTINATION],
    onNavigate: (to) => onNavigate?.(to),
    loadAccount: typeof adapter.loadAccount === 'function' ? (input) => adapter.loadAccount(input) : undefined,
    renderBody(main, { account }) {
      let body; let stopped = false; let restoringFocus = false;
      const announcement = el('p', 'gcsp-vh gcsp-activity-announcement'); announcement.setAttribute('aria-live', 'polite'); announcement.setAttribute('aria-atomic', 'true');
      const content = el('div');
      // Help sits outside the repainted body so a repaint never resets an open help form.
      const helpRegion = helpAdapter && account.status === 'ready' ? el('section', 'gcsp-activity-help') : null;
      if (helpRegion) helpRegion.setAttribute('aria-label', 'Renewal help');
      main.replaceChildren(...[content, helpRegion, announcement].filter(Boolean));
      const ownedHelp = helpRegion ? mountHelp(helpRegion, { embedded: true, adapter: helpAdapter, headingLevel: 2 }) : null;
      stopHelp = ownedHelp;
      const paint = (state) => {
        if (done || stopped) return;
        const active = root.ownerDocument.activeElement;
        const ownedFocus = body?.contains(active) || restoringFocus && active === main;
        body?.destroy?.();
        if (state.phase === 'loading') {
          body = el('div', 'vm gcsp-activity');
          body.append(screenIntro({ title: 'Buddy activity' }), statusScreen({ title: 'Loading activity' }));
        } else {
          body = activityBody({ result: state.result, pending: state.pending, offerDisplay,
            onRetry: account.status === 'ready' ? () => controller?.refresh() : undefined,
            onPause: typeof adapter.pause === 'function' ? () => controller?.pause() : undefined,
            onResume: typeof adapter.resume === 'function' ? () => controller?.resume() : undefined });
        }
        content.replaceChildren(body); announcement.textContent = state.message;
        if (ownedFocus) {
          if (state.phase === 'loading') { main.tabIndex = -1; main.focus(); restoringFocus = true; }
          else {
            const target = body.querySelector('.gcsp-action-trigger') || body.querySelector('button:not(:disabled)') || body.querySelector('h1');
            if (target) { if (target.tagName === 'H1') target.tabIndex = -1; target.focus(); }
            restoringFocus = false;
          }
        } else restoringFocus = false;
      };
      if (account.status !== 'ready') paint({ phase: 'unavailable', result: null, message: '' });
      else {
        controller = createActivityController({ adapter, onChange: paint });
        controller.refresh();
      }
      const ownedController = controller;
      return () => { stopped = true; body?.destroy?.(); ownedHelp?.(); ownedController?.destroy(); if (controller === ownedController) controller = null; };
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
      navigation: this._adapter?.navigation, offerDisplay: this._adapter?.offerDisplay, helpAdapter: this._helpAdapter,
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
