// Employee entry: mountEmployee(root, ctx) and <gcsp-employee>. Account data comes only from an adapter or a named
// fixture; only the default rail routing touches location. See docs/gcsp/employee-entry-contract.md.
import { el } from '../../vehicle-matcher/ui.js';
import { portalShell, svgIcon } from '../shell/portal-shell.js';
import { fixtureAdapter } from './fixtures.js';
import { PORTAL_NAVIGATION, routePortal } from './portal-navigation.js';

export const EMPLOYEE_NAVIGATION = PORTAL_NAVIGATION;
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
 * Mount the employee shell: the rail is PORTAL_NAVIGATION; a click goes to ctx.onNavigate(key) or PORTAL_ROUTES via ctx.location.
 * viewLabel is the crumb for a view outside the rail; returns a teardown with setView(key).
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
    const rail = new Set(PORTAL_NAVIGATION.map((i) => i.key));
    const outside = ctx.viewLabel ? ctx.view : null;
    const known = (key) => rail.has(key) || key === outside;
    const labelOf = (key) => (key === outside ? ctx.viewLabel : PORTAL_NAVIGATION.find((i) => i.key === key)?.label || 'Your cars');
    const activeOf = (key) => (rail.has(key) ? key : null);
    view = known(ctx.view) ? ctx.view : DEFAULT_VIEW;
    let account = { status: 'loading' };
    const renderBody = () => {
      cleanupBody?.();
      cleanupBody = null;
      const draw = ctx.renderBody || defaultBody;
      const out = draw(shell.main, { view, account, label: labelOf(view) });
      if (typeof out === 'function') cleanupBody = out;
    };
    const showLoading = () => {
      const note = el('p', 'gcsp-note', 'Loading your account and cars.');
      note.setAttribute('role', 'status');
      shell.main.replaceChildren(note);
    };
    const load = async () => {
      shell.setAccount({ status: 'loading' });
      cleanupBody?.();
      cleanupBody = null;
      showLoading();
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
      presenterControls: ctx.presenterControls,
      arrivalFocus: true,
      navigation: PORTAL_NAVIGATION,
      active: activeOf(view),
      breadcrumbs: [labelOf(view)],
      onNavigate: (key) => {
        if (key === view || !rail.has(key)) return;
        if (ctx.onNavigate) ctx.onNavigate(key);
        else routePortal(key, ctx.location || root.ownerDocument.defaultView.location);
      },
      onRetryAccount: load,
    });
    setView = (key) => {
      if (!known(key) || key === view) return;
      view = key;
      shell.setActive(activeOf(view));
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
