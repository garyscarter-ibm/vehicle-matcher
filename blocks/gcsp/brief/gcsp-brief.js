import { mountEmployee } from '../employee/gcsp-employee.js';
import { statusScreen } from '../../vehicle-matcher/ui.js';
import { mountBriefBody } from './brief-view.js';
import { createBriefTransport } from './brief-transport.js';

/** Compose the brief inside the existing employee shell; hosts may mount the body directly. */
export function mountBrief(root, ctx = {}) {
  const abort = new AbortController();
  const onAbort = () => abort.abort(); ctx.signal?.addEventListener('abort', onAbort, { once: true });
  if (ctx.signal?.aborted) { ctx.signal.removeEventListener('abort', onAbort); return () => {}; }
  const transport = ctx.transport || createBriefTransport({ fetch: ctx.fetch, baseURL: ctx.baseURL, signal: abort.signal });
  const teardown = mountEmployee(root, { brand: ctx.brand, view: 'brief',
    signal: abort.signal, loadAccount: ctx.loadAccount, onNavigate: ctx.onNavigate, onUnavailable: ctx.onUnavailable,
    renderBody(main, { account, view }) {
      if (account.status !== 'ready') { main.replaceChildren(statusScreen({ title: 'Your brief is unavailable', message: 'Load your account to review its car brief.' })); return undefined; }
      if (view !== 'brief' && ctx.renderBody) return ctx.renderBody(main, { account, view });
      return mountBriefBody(main, { ...ctx, transport, loadEditor: ctx.loadEditor || transport.loadEditor, signal: abort.signal });
    },
  });
  return () => { abort.abort(); ctx.signal?.removeEventListener('abort', onAbort); teardown(); };
}

export class GcspBriefElement extends HTMLElement {
  constructor() {
    super();
    const adapter = Object.hasOwn(this, 'adapter') ? this.adapter : null;
    delete this.adapter;
    this._adapter = adapter; this._cleanup = null;
  }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value || null; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._cleanup?.(); this._cleanup = null; }
  _mount() {
    this._cleanup?.();
    const Event = this.ownerDocument.defaultView?.CustomEvent || CustomEvent;
    this._cleanup = mountBrief(this, { ...this._adapter, brand: this.getAttribute('brand') || 'bmw',
      onNavigate: (to) => this.dispatchEvent(new Event('gcsp:navigate', { detail: { from: 'brief', to }, bubbles: true, composed: true })),
      onUnavailable: (reason) => this.dispatchEvent(new Event('gcsp:unavailable', { detail: { reason }, bubbles: true, composed: true })) });
  }
}
export function defineGcspBrief(registry = globalThis.customElements) {
  if (!registry) return null;
  if (!registry.get('gcsp-brief')) registry.define('gcsp-brief', GcspBriefElement);
  return registry.get('gcsp-brief');
}
