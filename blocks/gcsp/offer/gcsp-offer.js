import { portalShell } from '../shell/portal-shell.js';
import { createOfferController } from './offer-controller.js';
import { createOfferView } from './offer-view.js';
import { el } from '../../vehicle-matcher/ui.js';

// The trusted host binds this port to 107's body mount and its ordinary employee account loader.
function followupMount(port) {
  if (typeof port?.loadAccount !== 'function' || typeof port?.mount !== 'function') return undefined;
  return (root, { decisionId }) => {
    const abort = new AbortController(); let done = false; let cleanup;
    const show = (message) => {
      const note = el('p', 'gcsp-note', message); note.setAttribute('role', 'status'); root.replaceChildren(note);
    };
    const unavailable = () => show('Follow-up unavailable. Open this offer from your account or check again.');
    show('Loading your account for the follow-up.');
    void (async () => {
      try {
        const account = await port.loadAccount({ signal: abort.signal });
        if (done) return;
        if (account?.status !== 'ready') { unavailable(); return; }
        cleanup = port.mount(root, { decisionId, signal: abort.signal });
        if (typeof cleanup !== 'function') { cleanup = undefined; abort.abort(); unavailable(); }
      } catch { if (!done) { abort.abort(); unavailable(); } }
    })();
    return () => {
      if (done) return; done = true; abort.abort();
      try { cleanup?.(); } finally { root.replaceChildren(); }
    };
  };
}

/** Standalone embeddable offer surface. A trusted host supplies real read and decision adapters. */
export function mountOffer(root, adapter = {}) {
  const shell = portalShell({ title: 'Group Car Schemes Portal', account: adapter.account || { status: 'unavailable', message: 'Account details not supplied.' },
    navigation: adapter.navigation || [], breadcrumbs: [{ label: 'Your offer' }], onNavigate: adapter.onNavigate });
  root.replaceChildren(shell.root);
  const controller = createOfferController({ read: adapter.read || (async () => ({ status: 'unavailable' })),
    decide: adapter.decide, readReasons: adapter.readReasons, createCommandId: adapter.createCommandId });
  const view = createOfferView(shell.main, { refresh: () => controller.refresh(), decide: (kind, options) => controller.decision(kind, options), tickDeclaration: controller.tickDeclaration,
    selectReason: controller.selectDeclineReason, cancelDecline: controller.cancelDecline, refreshReasons: controller.refreshDeclineReasons,
    mountFollowup: followupMount(adapter.followup) });
  const update = (model) => view.update({ ...model, fixtureNotice: adapter.notice || model.fixtureNotice });
  const unsubscribe = controller.subscribe(update);
  update(controller.snapshot());
  let destroyed = false;
  // Hosts may publish presenter-clock events. Each event performs an authoritative read.
  const unsubscribeClock = adapter.subscribeClock?.(() => { if (!destroyed) void controller.refresh(); });
  void controller.refresh();
  const teardown = () => {
    if (destroyed) return;
    destroyed = true; unsubscribeClock?.(); unsubscribe(); controller.destroy(); view.destroy(); shell.destroy(); shell.root.remove();
  };
  teardown.refresh = () => controller.refresh();
  teardown.snapshot = controller.snapshot;
  return teardown;
}

export class GcspOfferElement extends HTMLElement {
  constructor() {
    super();
    const adapter = Object.hasOwn(this, 'adapter') ? this.adapter : null;
    delete this.adapter; this._adapter = adapter; this._cleanup = null;
  }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._cleanup?.(); this._cleanup = null; }
  _mount() { this._cleanup?.(); this._cleanup = mountOffer(this, this._adapter || {}); }
}

export function defineGcspOffer(registry = globalThis.customElements) {
  if (!registry) return null;
  if (!registry.get('gcsp-offer')) registry.define('gcsp-offer', GcspOfferElement);
  return registry.get('gcsp-offer');
}
