// Embeddable order progress consumer. The injected adapter owns account, access and command authority.
import { el, screenIntro, statusScreen } from '../../vehicle-matcher/ui.js';
import { mountEmployee, EMPLOYEE_NAVIGATION } from '../employee/gcsp-employee.js';
import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { mountHelp } from '../cases/gcsp-help.js';
import { orderProgressBody } from './order-progress-body.js';
import { createOrderProgressController } from './order-progress-controller.js';
import { createOrderProgressHttpAdapter } from './order-progress-http.js';
import { orderCopy } from './order-progress-copy.js';

export const ORDER_PROGRESS_DESTINATION = Object.freeze({ key: 'order-progress', label: 'Order progress', available: true,
  icon: Object.freeze(['M4 6l2 2 3-3', 'M4 14l2 2 3-3', 'M12 7h8', 'M12 15h8']) });

const keyOf = (control) => ({ section: control.closest('.gcsp-order-section')?.className ?? '', label: control.textContent });
const sameKey = (control, key) => !control.disabled && control.textContent === key.label && (control.closest('.gcsp-order-section')?.className ?? '') === key.section;

// Paints the controller's state into `host`; returns its teardown. Focus stays on a surviving control, else moves to the message.
function mountBody(host, { adapter, orderUuid, car, helpAdapter, level, ready = true }) {
  let body; let controller; let stopped = false; let focusKey = null; let helps = [];
  const content = el('div'); host.replaceChildren(content);
  const stopHelps = () => { helps.splice(0).forEach((stop) => { try { stop?.(); } catch { /* help already gone */ } }); };
  const has = (name) => (ready && typeof adapter[name] === 'function' ? (...args) => controller?.[name](...args) : undefined);
  const paint = (state) => {
    if (stopped) return;
    const active = host.ownerDocument.activeElement;
    const owned = Boolean(body?.contains(active));
    if (owned && active.closest('button')) focusKey = keyOf(active.closest('button'));
    stopHelps();
    if (state.phase === 'none') {
      body = el('div', 'vm gcsp-order-progress');
      body.append(screenIntro({ title: orderCopy.title, level }), statusScreen({ title: 'No order yet' }));
    } else {
      body = orderProgressBody({ progress: state.progress, car, pending: state.pending, message: state.message || undefined, level,
        onRetry: ready ? () => controller?.refresh() : undefined, onCompleteTask: has('completeTask'), onRequestAppointment: has('requestAppointment'),
        onAcceptAppointment: has('acceptAppointment'), onRequestReturn: has('requestReturn'), onAcceptReturn: has('acceptReturn'),
        mountHelp: (node) => { helps.push(mountHelp(node, { embedded: true, adapter: helpAdapter, headingLevel: Math.min(level + 2, 4) })); } });
    }
    content.replaceChildren(body);
    if (!owned) { focusKey = null; return; }
    const control = !state.pending && focusKey ? [...body.querySelectorAll('button')].find((node) => sameKey(node, focusKey)) : null;
    const target = control || body.querySelector('.gcsp-order-message') || body.querySelector('h1,h2,h3,h4');
    if (!control && !state.pending) focusKey = null;
    if (target) { if (!control) target.tabIndex = -1; target.focus(); }
  };
  if (!ready) paint({ phase: 'unavailable', progress: { phase: 'unavailable' }, pending: false, message: null });
  else { controller = createOrderProgressController({ adapter, orderUuid, onChange: paint }); controller.refresh(); }
  const owner = controller;
  const stop = () => { stopped = true; stopHelps(); owner?.destroy(); };
  stop.refresh = () => owner?.refresh() || Promise.resolve();
  return stop;
}

export function mountOrderProgress(root, { adapter = {}, orderUuid, car, brand = 'bmw', navigation, onNavigate, helpAdapter, embedded = false, headingLevel, signal } = {}) {
  let done = false; let stopBody; let stopShell;
  const abort = new AbortController();
  const teardown = () => {
    if (done) return;
    done = true; abort.abort(); stopBody?.(); stopShell?.();
    signal?.removeEventListener('abort', teardown); root.replaceChildren();
  };
  teardown.refresh = () => stopBody?.refresh() || Promise.resolve();
  if (signal?.aborted) { teardown(); return teardown; }
  signal?.addEventListener('abort', teardown, { once: true });
  if (embedded) {
    const wrap = el('div', 'gcsp'); root.replaceChildren(wrap);
    stopBody = mountBody(wrap, { adapter, orderUuid, car, helpAdapter, level: headingLevel ?? 2 });
    return teardown;
  }
  stopShell = mountEmployee(root, { brand, view: ORDER_PROGRESS_DESTINATION.key, signal: abort.signal,
    navigation: navigation || [...EMPLOYEE_NAVIGATION.map((item) => ({ ...item, available: false, unavailableReason: 'Not available in this demo' })), ORDER_PROGRESS_DESTINATION],
    onNavigate: (to) => onNavigate?.(to),
    loadAccount: typeof adapter.loadAccount === 'function' ? (input) => adapter.loadAccount(input) : undefined,
    renderBody(main, { account }) {
      stopBody = mountBody(main, { adapter, orderUuid, car, helpAdapter, level: headingLevel ?? 1, ready: account.status === 'ready' });
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
      headingLevel: Number.isInteger(level) && level >= 1 && level <= 4 ? level : undefined, navigation: this._adapter?.navigation,
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
