// Embeddable order progress consumer. The injected adapter owns account, access and command authority.
import { el, screenIntro, statusScreen } from '../../vehicle-matcher/ui.js';
import { mountEmployee } from '../employee/gcsp-employee.js';
import { PORTAL_NAVIGATION } from '../employee/portal-navigation.js';
import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { mountHelp } from '../cases/gcsp-help.js';
import { orderProgressBody } from './order-progress-body.js';
import { createOrderProgressController } from './order-progress-controller.js';
import { createOrderProgressHttpAdapter } from './order-progress-http.js';
import { orderCopy } from './order-progress-copy.js';
import { runRestartedScreen } from '../kit/run-restarted.js';
import { focusKeyOf, findByFocusKey, keepScroll } from '../kit/focus-key.js';

export const ORDER_PROGRESS_DESTINATION = PORTAL_NAVIGATION.find((item) => item.key === 'order-progress');

const SECTION_OF = { completeTask: 'documents', requestAppointment: 'handover', acceptAppointment: 'handover', requestReturn: 'return', acceptReturn: 'return' };
const SECTION = '.gcsp-order-section';
// The read clock (asOf) moves on every Tick without changing what is shown, so it is not a change.
const changeKey = (state) => JSON.stringify(state.phase === 'ready' ? [state.progress.stages, state.progress.documents, state.progress.appointment, state.progress.returnPlan] : state.phase,
  (key, value) => (key === 'asOf' ? undefined : value));

// Paints the controller's state into `host`; returns its teardown. Focus stays on a surviving control, else moves to the message.
function mountBody(host, { adapter, orderUuid, car, helpAdapter, level, ready = true, reload }) {
  let body; let controller; let stopped = false; let focusKey = null; let helps = []; let acted = null;
  const content = el('div'); const live = el('p', 'gcsp-vh'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
  host.replaceChildren(content, live);
  const stopHelps = () => { helps.splice(0).forEach((stop) => { try { stop?.(); } catch { /* help already gone */ } }); };
  const has = (name) => (ready && typeof adapter[name] === 'function' ? (...args) => { acted = SECTION_OF[name]; return controller?.[name](...args); } : undefined);
  const paint = (state) => {
    if (stopped) return;
    const active = host.ownerDocument.activeElement;
    const owned = Boolean(body?.contains(active));
    if (owned && active.closest('button')) focusKey = focusKeyOf(active.closest('button'), SECTION);
    stopHelps();
    if (!state.pending && !state.message) acted = null;
    if (state.phase === 'none') {
      body = el('div', 'vm gcsp-order-progress');
      body.append(screenIntro({ title: orderCopy.title, level }), statusScreen({ title: 'No order yet' }));
    } else if (state.phase === 'restarted') {
      body = el('div', 'vm gcsp-order-progress');
      body.append(screenIntro({ title: orderCopy.title, level }), runRestartedScreen({ reload }));
    } else {
      body = orderProgressBody({ progress: state.progress, car, pending: state.pending, message: state.message || undefined, messageSection: acted || undefined, level,
        onRetry: ready ? () => controller?.refresh() : undefined, onCompleteTask: has('completeTask'), onRequestAppointment: has('requestAppointment'),
        onAcceptAppointment: has('acceptAppointment'), onRequestReturn: has('requestReturn'), onAcceptReturn: has('acceptReturn'),
        mountHelp: (node) => { helps.push(mountHelp(node, { embedded: true, adapter: helpAdapter, headingLevel: Math.min(level + 2, 4) })); } });
    }
    keepScroll(host.ownerDocument.defaultView, () => content.replaceChildren(body));
    if (!owned) { focusKey = null; return; }
    const control = state.phase === 'restarted' ? body.querySelector('button')
      : !state.pending && focusKey ? findByFocusKey(body, focusKey, 'button', SECTION) : null;
    const target = control || body.querySelector('.gcsp-order-message') || body.querySelector('h1,h2,h3,h4');
    if (!control && !state.pending) focusKey = null;
    if (target) { if (!control) target.tabIndex = -1; target.focus(); }
  };
  if (!ready) paint({ phase: 'unavailable', progress: { phase: 'unavailable' }, pending: false, message: null });
  else { controller = createOrderProgressController({ adapter, orderUuid, onChange: paint }); controller.refresh(); }
  const owner = controller;
  // Re-reads in place and announces once, only when the order actually changed.
  const sync = async () => {
    if (!owner) return;
    const before = changeKey(owner.getState());
    const after = await owner.sync();
    if (stopped || after.phase !== 'ready' || changeKey(after) === before) return;
    live.textContent = ''; live.textContent = 'Order progress updated.';
  };
  const unsubscribeClock = ready ? adapter.subscribeClock?.(() => { void sync(); }) : undefined;
  const stop = () => { stopped = true; unsubscribeClock?.(); stopHelps(); owner?.destroy(); };
  stop.refresh = () => owner?.refresh() || Promise.resolve();
  stop.sync = sync;
  return stop;
}

export function mountOrderProgress(root, { adapter = {}, orderUuid, car, brand = 'bmw', onNavigate, helpAdapter, embedded = false, headingLevel, signal, reload } = {}) {
  let done = false; let stopBody; let stopShell;
  const abort = new AbortController();
  const teardown = () => {
    if (done) return;
    done = true; abort.abort(); stopBody?.(); stopShell?.();
    signal?.removeEventListener('abort', teardown); root.replaceChildren();
  };
  teardown.refresh = () => stopBody?.refresh() || Promise.resolve();
  teardown.sync = () => stopBody?.sync() || Promise.resolve();
  if (signal?.aborted) { teardown(); return teardown; }
  signal?.addEventListener('abort', teardown, { once: true });
  if (embedded) {
    const wrap = el('div', 'gcsp'); root.replaceChildren(wrap);
    stopBody = mountBody(wrap, { adapter, orderUuid, car, helpAdapter, level: headingLevel ?? 2, reload });
    return teardown;
  }
  stopShell = mountEmployee(root, { brand, view: ORDER_PROGRESS_DESTINATION.key, signal: abort.signal,
    onNavigate,
    loadAccount: typeof adapter.loadAccount === 'function' ? (input) => adapter.loadAccount(input) : undefined,
    renderBody(main, { account }) {
      stopBody = mountBody(main, { adapter, orderUuid, car, helpAdapter, level: headingLevel ?? 1, ready: account.status === 'ready', reload });
      const own = stopBody; return () => { own(); if (stopBody === own) stopBody = null; };
    } });
  if (done) stopShell();
  return teardown;
}

export class GcspOrderProgressElement extends HTMLElement {
  static get observedAttributes() { return ['brand', 'order-uuid', 'embedded', 'heading-level']; }
  constructor() {
    super();
    for (const key of ['adapter', 'car', 'helpAdapter']) if (Object.hasOwn(this, key)) { const value = this[key]; delete this[key]; this[`_${key}`] = value; }
    this._teardown = null;
  }
  get adapter() { return this._adapter ?? null; }
  set adapter(value) { this._adapter = value || null; if (this.isConnected) this._mount(); }
  get car() { return this._car ?? undefined; }
  set car(value) { this._car = value || undefined; if (this.isConnected) this._mount(); }
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
    const level = Number(this.getAttribute('heading-level'));
    this._teardown = mountOrderProgress(this, { adapter: this._adapter || {}, brand: this.brand, car: this._car, helpAdapter: this._helpAdapter,
      orderUuid: this.getAttribute('order-uuid') || undefined, embedded: this.hasAttribute('embedded'),
      headingLevel: Number.isInteger(level) && level >= 1 && level <= 4 ? level : undefined,
      onNavigate: (to) => {
        const EventType = this.ownerDocument.defaultView.CustomEvent;
        this.dispatchEvent(new EventType('gcsp:navigate', { detail: { from: 'order-progress', to }, bubbles: true, composed: true, cancelable: true }));
      } });
  }
}

export function defineGcspOrderProgress(registry = globalThis.customElements) {
  if (!registry) return null;
  const existing = registry.get('gcsp-order-progress');
  if (existing) return existing;
  registry.define('gcsp-order-progress', GcspOrderProgressElement); return GcspOrderProgressElement;
}

export default function decorate(block, options = {}) {
  return mountOrderProgress(block, { adapter: createOrderProgressHttpAdapter({ loadAccount: createAccountHttpAdapter().loadAccount }), ...options });
}
