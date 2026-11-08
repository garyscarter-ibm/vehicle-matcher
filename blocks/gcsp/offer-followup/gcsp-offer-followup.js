import { mountEmployee, EMPLOYEE_NAVIGATION } from '../employee/gcsp-employee.js';
import { statusScreen } from '../../vehicle-matcher/ui.js';
import { createFollowupController } from './followup-controller.js';
import { createFollowupHttpAdapter } from './http-adapter.js';
import { createFollowupView } from './followup-view.js';

const navigation = [EMPLOYEE_NAVIGATION[0], { key: 'offer-followup', label: 'Your next offer', available: true,
  icon: ['M4 12h16', 'M14 6l6 6-6 6'] }];

export function mountFollowupBody(root, ctx = {}) {
  const abort = new AbortController(); const onAbort = () => cleanup(); let done = false; let controller; let view; let unsubscribe;
  const cleanup = () => {
    if (done) return; done = true; abort.abort(); ctx.signal?.removeEventListener('abort', onAbort);
    unsubscribe?.(); controller?.destroy(); if (view) view.destroy(); else root.replaceChildren();
  };
  if (ctx.signal?.aborted) return cleanup;
  ctx.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    controller = createFollowupController({ decisionId: ctx.decisionId, createCommandId: ctx.createCommandId,
      transport: ctx.transport || createFollowupHttpAdapter({ fetchImpl: ctx.fetchImpl, base: ctx.base, signal: abort.signal }) });
    view = createFollowupView(root, { choose: controller.choose, confirm: controller.confirm, refresh: controller.refresh,
      projectOffer: ctx.projectOffer, openOffer: ctx.openOffer, hostRefresh: ctx.hostRefresh === true });
    unsubscribe = controller.subscribe(view.update); view.update(controller.snapshot()); controller.refresh();
  } catch {
    root.replaceChildren(statusScreen({ title: 'Follow-up unavailable', message: 'Open the offer from your account to continue.' }));
  }
  return cleanup;
}

/** Host supplies trusted account loading and FUCQ-105's projector; no fixture or URL identity fallback. */
export function mountOfferFollowup(root, ctx = {}) {
  return mountEmployee(root, { ...ctx, view: 'offer-followup', navigation: ctx.navigation || navigation,
    renderBody(main, { account, view }) {
      if (view !== 'offer-followup') {
        if (ctx.renderBody) return ctx.renderBody(main, { account, view });
        main.replaceChildren(statusScreen({ title: 'Your cars', message: 'Open your account to view your cars.' })); return undefined;
      }
      if (account.status !== 'ready') {
        main.replaceChildren(statusScreen({ title: 'Follow-up unavailable', message: 'Load your account to continue.' })); return undefined;
      }
      return mountFollowupBody(main, ctx);
    } });
}

export class GcspOfferFollowupElement extends HTMLElement {
  static get observedAttributes() { return ['brand']; }
  constructor() {
    super(); const adapter = Object.hasOwn(this, 'adapter') ? this.adapter : null; delete this.adapter;
    this._adapter = adapter; this._cleanup = null;
  }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value || null; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._cleanup?.(); this._cleanup = null; }
  attributeChangedCallback(name, oldValue, value) { if (oldValue !== value && this.isConnected) this._mount(); }
  _mount() {
    this._cleanup?.();
    const Event = this.ownerDocument.defaultView?.CustomEvent || CustomEvent;
    this._cleanup = mountOfferFollowup(this, { ...this._adapter, brand: this.getAttribute('brand') || 'bmw',
      onNavigate: (to) => this.dispatchEvent(new Event('gcsp:navigate', { detail: { from: 'offer-followup', to }, bubbles: true, composed: true })) });
  }
}

export function defineGcspOfferFollowup(registry = globalThis.customElements) {
  if (!registry) return null;
  const existing = registry.get('gcsp-offer-followup'); if (existing) return existing;
  registry.define('gcsp-offer-followup', GcspOfferFollowupElement); return GcspOfferFollowupElement;
}
