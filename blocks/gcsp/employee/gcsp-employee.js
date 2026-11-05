// Employee entry: mountEmployee(root, ctx) and <gcsp-employee>. Account data comes only from an adapter
// or a named fixture; location and history are never touched. See docs/gcsp/employee-entry-contract.md.
import { el } from '../../vehicle-matcher/ui.js';
import { portalShell, svgIcon } from '../shell/portal-shell.js';
import { fixtureAdapter } from './fixtures.js';

const NOT_BUILT = 'Not available in this demo';
const icon = (key, label, paths, available = false) => Object.freeze({
  key, label, icon: Object.freeze(paths), available,
  ...(available ? {} : { unavailableReason: NOT_BUILT }),
});

export const EMPLOYEE_NAVIGATION = Object.freeze([
  icon('cars', 'Your cars', ['M3 14l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5', 'M3 14h18v4H3z', 'M7 18v2', 'M17 18v2'], true),
  icon('order', 'New order', ['M12 5v14', 'M5 12h14']),
  icon('history', 'Order history', ['M4 12a8 8 0 1 0 3-6.2', 'M4 4v4h4', 'M12 8v4l3 2']),
  icon('drivers', 'Drivers and licences', ['M3 6h18v12H3z', 'M7 11h4', 'M7 15h6', 'M15 10h3v4h-3z']),
  icon('help', 'Scheme guidelines', ['M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z', 'M5 17a3 3 0 0 1 3-3h11']),
]);

const LABELS = Object.fromEntries(EMPLOYEE_NAVIGATION.map((i) => [i.key, i.label]));
const DEFAULT_VIEW = 'cars';

function defaultBody(main, { view, label }) {
  const panel = el('section', 'gcsp-panel');
  panel.append(
    el('h1', 'gcsp-page-title', label),
    el('p', 'gcsp-note', 'This view is a shell placeholder. The car selection body is not built yet.'),
  );
  main.replaceChildren(panel);
}

function standalone(root, title, message) {
  const wrap = el('div', 'gcsp gcsp-standalone');
  const panel = el('section', 'gcsp-panel');
  panel.setAttribute('role', 'status');
  panel.append(svgIcon(['M12 8v5', 'M12 16.5v.01', 'M4 19h16L12 5z']), el('h1', 'gcsp-page-title', title), el('p', 'gcsp-note', message));
  wrap.append(panel);
  root.replaceChildren(wrap);
  return () => { wrap.remove(); };
}

/**
 * Mount the employee shell in root. ctx: { brand, view, loadAccount({ signal }), renderBody(main, { view, account }), navigation, signal }.
 * Returns a teardown function with a setView(key) method. ctx.onNavigate(to) takes over navigation
 * when given; ctx.onUnavailable(reason) hears brand and account failures.
 */
export function mountEmployee(root, ctx = {}) {
  const brand = String(ctx.brand || 'bmw').toLowerCase();
  const abort = new AbortController();
  const onExternalAbort = () => abort.abort();
  ctx.signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (ctx.signal?.aborted) abort.abort();

  let cleanupBody = null;
  let shell = null;
  let cleanupStandalone = null;
  let done = false;
  let view = DEFAULT_VIEW;
  let setView = () => {};

  if (brand !== 'bmw') {
    cleanupStandalone = standalone(root, 'Not available for this brand', 'Employee cars are available for BMW only at present.');
    ctx.onUnavailable?.('brand-not-supported');
  } else {
    const navigation = ctx.navigation || EMPLOYEE_NAVIGATION;
    const available = new Set(navigation.filter((i) => i.available).map((i) => i.key));
    const labelOf = (key) => navigation.find((i) => i.key === key)?.label || LABELS[key] || 'Your cars';
    view = available.has(ctx.view) ? ctx.view : DEFAULT_VIEW;
    let account = { status: 'loading' };
    const renderBody = () => {
      cleanupBody?.();
      cleanupBody = null;
      const draw = ctx.renderBody || defaultBody;
      const out = draw(shell.main, { view, account, label: labelOf(view) });
      if (typeof out === 'function') cleanupBody = out;
    };
    const load = async () => {
      shell.setAccount({ status: 'loading' });
      if (typeof ctx.loadAccount !== 'function') {
        account = { status: 'unavailable', message: 'Your account could not be loaded.' };
        ctx.onUnavailable?.('no-adapter');
      } else {
        try {
          const result = await ctx.loadAccount({ signal: abort.signal });
          account = result?.status ? result : { status: 'unavailable' };
        } catch {
          account = { status: 'unavailable', message: 'Your account could not be loaded.' };
        }
        if (!abort.signal.aborted && account.status !== 'ready' && account.status !== 'loading') ctx.onUnavailable?.('account-unavailable');
      }
      if (abort.signal.aborted) return;
      shell.setAccount(account);
      renderBody();
    };
    shell = portalShell({
      title: 'Group Car Schemes Portal',
      navigation,
      active: view,
      breadcrumbs: [labelOf(view)],
      onNavigate: (key) => {
        if (key === view || !available.has(key)) return;
        if (ctx.onNavigate) ctx.onNavigate(key);
        else setView(key);
      },
      onRetryAccount: load,
    });
    setView = (key) => {
      if (!available.has(key) || key === view) return;
      view = key;
      shell.setActive(view);
      shell.setBreadcrumbs([labelOf(view)]);
      if (account.status !== 'loading') renderBody();
    };
    root.replaceChildren(shell.root);
    load();
  }

  function teardown() {
    if (done) return;
    done = true;
    abort.abort();
    ctx.signal?.removeEventListener('abort', onExternalAbort);
    cleanupBody?.();
    shell?.destroy();
    cleanupStandalone?.();
    root.replaceChildren();
  }
  teardown.setView = (key) => { setView(key); return view; };
  teardown.getView = () => view;
  return teardown;
}

export class GcspEmployeeElement extends HTMLElement {
  static get observedAttributes() { return ['brand', 'view', 'fixture']; }

  constructor() {
    super();
    this._adapter = null;
    this._teardown = null;
    this._current = DEFAULT_VIEW;
  }

  get adapter() { return this._adapter; }

  set adapter(value) {
    this._adapter = value || null;
    if (this.isConnected) this._mount();
  }

  get brand() { return this.getAttribute('brand') || 'bmw'; }

  get view() { return this.getAttribute('view') || DEFAULT_VIEW; }

  connectedCallback() { this._mount(); }

  disconnectedCallback() { this._unmount(); }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue || !this.isConnected) return;
    if (name === 'view' && this._teardown) {
      this._current = this._teardown.setView(newValue);
    } else {
      this._mount();
    }
  }

  _unmount() {
    this._teardown?.();
    this._teardown = null;
  }

  _emit(type, detail, cancelable = false) {
    const Ev = this.ownerDocument.defaultView?.CustomEvent || CustomEvent;
    const event = new Ev(type, { detail, bubbles: true, composed: true, cancelable });
    this.dispatchEvent(event);
    return event;
  }

  _mount() {
    this._unmount();
    const brand = this.brand.toLowerCase();
    const fixtureName = this.getAttribute('fixture');
    const adapter = this._adapter || (fixtureName ? fixtureAdapter(fixtureName) : null);
    this._teardown = mountEmployee(this, {
      brand,
      view: this.view,
      loadAccount: adapter?.loadAccount,
      navigation: adapter?.navigation,
      renderBody: adapter?.renderBody,
      onNavigate: (to) => {
        const event = this._emit('gcsp:navigate', { from: this._current, to }, true);
        if (!event.defaultPrevented) this.setAttribute('view', to);
      },
      onUnavailable: (reason) => {
        this._emit('gcsp:unavailable', { reason: reason === 'no-adapter' && fixtureName ? 'unknown-fixture' : reason });
      },
    });
    this._current = this._teardown.getView();
    if (brand === 'bmw') this._emit('gcsp:ready', { view: this._current, brand });
  }
}

/** Register <gcsp-employee> once; safe to call again. */
export function defineGcspEmployee(registry = globalThis.customElements) {
  if (!registry) return null;
  const existing = registry.get('gcsp-employee');
  if (existing) return existing;
  registry.define('gcsp-employee', GcspEmployeeElement);
  return GcspEmployeeElement;
}
