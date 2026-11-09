// Presenter outbox: mountOutbox(root, ctx) and <gcsp-outbox>. Messages come only from an adapter or a
// named fixture; location is never read. See docs/gcsp/presenter-outbox-contract.md.
import { el, screenIntro, button, statusScreen } from '../../vehicle-matcher/ui.js';
import { portalShell } from '../shell/portal-shell.js';
import { isRunRestarted, runRestartedScreen } from '../kit/run-restarted.js';
import { messageList } from './message-list.js';
import { fixtureAdapter } from './fixtures.js';
import { plural } from './outbox-copy.js';
import { focusKeyOf, findByFocusKey, keepScroll } from '../kit/focus-key.js';

const NOT_BUILT = 'Not available in this demo';
const item = (key, label, icon, available = false) => Object.freeze({
  key, label, icon: Object.freeze(icon), available, ...(available ? {} : { unavailableReason: NOT_BUILT }),
});

export const PRESENTER_NAVIGATION = Object.freeze([
  item('outbox', 'Captured emails', ['M3 6h18v12H3z', 'M3 7l9 6 9-6'], true),
  item('clock', 'Demo clock', ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2']),
  item('scenarios', 'Scenarios', ['M5 4h14v16H5z', 'M9 9h6', 'M9 13h6']),
]);

const ACCOUNT = Object.freeze({ status: 'ready', name: 'Presenter', initials: 'PR', context: 'Synthetic demo run' });
const FAILED_LOAD = { status: 'unavailable', message: 'The captured emails could not be loaded. Try again in a moment.' };

function note(text, role = 'status') {
  const p = el('p', 'gcsp-note', text);
  p.setAttribute('role', role);
  return p;
}

/**
 * Mount the outbox in root. ctx: { loadMessages({ signal }) -> state, subscribeClock(listener) -> stop, signal, onUnavailable(reason) }.
 * State: { status: 'ready', messages } | { status: 'empty' } | { status: 'unavailable' | 'refused', message }.
 * Returns a teardown function with refresh() and sync() (a quiet re-read).
 */
export function mountOutbox(root, ctx = {}) {
  const abort = new AbortController();
  const onExternalAbort = () => abort.abort();
  ctx.signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (ctx.signal?.aborted) abort.abort();

  let list = null;
  let keep = null;
  let done = false;
  let run = 0;
  let loading = false;
  let resync = false;
  let snapshot = null;
  const shell = portalShell({
    title: 'Group Car Schemes Portal', account: ACCOUNT, navigation: PRESENTER_NAVIGATION, active: 'outbox', breadcrumbs: ['Captured emails'],
  });
  const page = el('div', 'vm gcsp-presenter');
  const intro = screenIntro({ kicker: 'Presenter', title: 'Captured emails', level: 1, className: 'gcsp-intro',
    lede: 'Captured messages and delivery status.' });
  const bar = el('div', 'gcsp-presenter-bar');
  const status = el('p', 'gcsp-note gcsp-presenter-count');
  status.setAttribute('role', 'status');
  const refresh = button({ label: 'Refresh', variant: 'ghost', onClick: () => load() });
  bar.append(status, refresh);
  const body = el('div', 'gcsp-presenter-body');
  page.append(intro, bar, body);
  shell.main.append(page);
  shell.setAccount(ACCOUNT);
  root.replaceChildren(shell.root);

  const clearList = () => { list?.destroy(); list = null; };
  const retry = () => button({ label: 'Retry', variant: 'primary', onClick: () => load() });

  function draw(state) {
    clearList();
    snapshot = state.status === 'ready' || state.status === 'empty' ? JSON.stringify(Array.isArray(state.messages) ? state.messages : []) : null;
    if (state.status === 'ready' && Array.isArray(state.messages) && state.messages.length) {
      status.textContent = `${plural(state.messages.length, 'captured email')}, newest first.`;
      list = messageList({ messages: state.messages, selectedId: keep });
      body.replaceChildren(list.root);
    } else if (state.status === 'ready' || state.status === 'empty') {
      status.textContent = 'No captured emails in this run.';
      body.replaceChildren(statusScreen({ kicker: 'Outbox', title: 'No emails yet',
        message: 'When an offer is made, the email Paula would have received appears here. Nothing has been offered in this run.' }));
    } else if (isRunRestarted(state)) {
      status.textContent = 'Demo restarted.';
      body.replaceChildren(runRestartedScreen());
    } else if (state.status === 'refused') {
      status.textContent = 'Access refused.';
      body.replaceChildren(statusScreen({ kicker: 'Outbox', title: 'You cannot open the outbox',
        message: state.message || 'Only the presenter can open the outbox.', role: 'alert' }));
    } else {
      status.textContent = 'Emails unavailable.';
      body.replaceChildren(statusScreen({ kicker: 'Outbox', title: 'Captured emails are unavailable',
        message: state.message || FAILED_LOAD.message, actions: [retry()], role: 'alert' }));
    }
  }

  async function load() {
    const mine = ++run;
    loading = true;
    keep = list?.getSelected() ?? keep;
    clearList();
    status.textContent = 'Loading captured emails.';
    body.replaceChildren(note('Loading captured emails.'));
    let state;
    if (typeof ctx.loadMessages !== 'function') {
      state = FAILED_LOAD;
      ctx.onUnavailable?.('no-adapter');
    } else {
      try {
        state = await ctx.loadMessages({ signal: abort.signal });
      } catch {
        state = FAILED_LOAD;
      }
      if (!state?.status) state = FAILED_LOAD;
      if (!abort.signal.aborted && state.status === 'unavailable') ctx.onUnavailable?.('source-unavailable');
    }
    if (abort.signal.aborted || done || mine !== run) return;
    loading = false;
    draw(state);
    if (resync) { resync = false; sync(); }
  }

  // Re-reads with no loading note; the view repaints only when the list changed, keeping selection, focus and scroll.
  async function sync() {
    if (done || typeof ctx.loadMessages !== 'function') return;
    if (loading) { resync = true; return; }
    const mine = ++run;
    let state;
    try { state = await ctx.loadMessages({ signal: abort.signal }); } catch { return; }
    if (abort.signal.aborted || done || mine !== run || (state?.status !== 'ready' && state?.status !== 'empty')) return;
    if (JSON.stringify(Array.isArray(state.messages) ? state.messages : []) === snapshot) return;
    const doc = root.ownerDocument; const active = doc.activeElement;
    const row = body.contains(active) ? active.closest('.gcsp-mail-row')?.dataset.id : null;
    const held = body.contains(active) && !row ? active.closest('button, a[href]') : null;
    const key = held ? focusKeyOf(held) : null;
    keep = list?.getSelected() ?? keep;
    keepScroll(doc.defaultView, () => draw(state));
    if (!row && !key) return;
    const rows = [...body.querySelectorAll('.gcsp-mail-row')];
    (rows.find((node) => node.dataset.id === row) || (key && findByFocusKey(body, key, 'button, a[href]')) || refresh).focus();
  }

  load();
  const unsubscribe = ctx.subscribeClock?.(() => { void sync(); });

  function teardown() {
    if (done) return;
    done = true;
    unsubscribe?.();
    abort.abort();
    ctx.signal?.removeEventListener('abort', onExternalAbort);
    clearList();
    shell.destroy();
    root.replaceChildren();
  }
  teardown.refresh = load;
  teardown.sync = sync;
  return teardown;
}

export class GcspOutboxElement extends HTMLElement {
  static get observedAttributes() { return ['fixture']; }

  constructor() {
    super();
    this._adapter = null;
    this._teardown = null;
  }

  get adapter() { return this._adapter; }

  set adapter(value) {
    this._adapter = value || null;
    if (this.isConnected) this._mount();
  }

  connectedCallback() { this._mount(); }

  disconnectedCallback() { this._unmount(); }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue !== newValue && this.isConnected) this._mount();
  }

  _unmount() {
    this._teardown?.();
    this._teardown = null;
  }

  _emit(type, detail) {
    const Ev = this.ownerDocument.defaultView?.CustomEvent || CustomEvent;
    this.dispatchEvent(new Ev(type, { detail, bubbles: true, composed: true }));
  }

  _mount() {
    this._unmount();
    const fixtureName = this.getAttribute('fixture');
    const adapter = this._adapter || (fixtureName ? fixtureAdapter(fixtureName) : null);
    this._teardown = mountOutbox(this, {
      loadMessages: adapter?.loadMessages,
      subscribeClock: adapter?.subscribeClock,
      onUnavailable: (reason) => {
        this._emit('gcsp:unavailable', { reason: reason === 'no-adapter' && fixtureName ? 'unknown-fixture' : reason });
      },
    });
    this._emit('gcsp:ready', { view: 'outbox' });
  }

  /** Re-run loadMessages, as the Refresh button does. */
  refresh() { return this._teardown?.refresh(); }
}

/** Register <gcsp-outbox> once; safe to call again. */
export function defineGcspOutbox(registry = globalThis.customElements) {
  if (!registry) return null;
  const existing = registry.get('gcsp-outbox');
  if (existing) return existing;
  registry.define('gcsp-outbox', GcspOutboxElement);
  return GcspOutboxElement;
}
