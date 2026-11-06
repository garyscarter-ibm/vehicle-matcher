import { portalShell } from '../shell/portal-shell.js';
import { createOfferController } from './offer-controller.js';
import { createOfferView } from './offer-view.js';

/** Standalone embeddable offer surface. A trusted host supplies real read and decision adapters. */
export function mountOffer(root, adapter = {}) {
  const shell = portalShell({ title: 'Group Car Schemes Portal', account: adapter.account || { status: 'unavailable', message: 'Account details not supplied.' },
    navigation: adapter.navigation || [], breadcrumbs: [{ label: 'Your offer' }], onNavigate: adapter.onNavigate });
  root.replaceChildren(shell.root);
  const controller = createOfferController({ read: adapter.read || (async () => ({ status: 'unavailable' })),
    decide: adapter.decide, readReasons: adapter.readReasons, createCommandId: adapter.createCommandId });
  const view = createOfferView(shell.main, { refresh: () => controller.refresh(), decide: (kind, options) => controller.decision(kind, options),
    selectReason: controller.selectDeclineReason, cancelDecline: controller.cancelDecline, refreshReasons: controller.refreshDeclineReasons });
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
