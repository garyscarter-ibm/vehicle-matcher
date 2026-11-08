import { mountGregOrderPlan } from './panel.js';
import { createOrderPlanHttpAdapter } from './http-adapter.js';
import { planFixtureAdapter } from './fixtures.js';

export class GcspGregOrderPlanElement extends HTMLElement {
  static get observedAttributes() { return ['fixture']; }
  constructor() { super(); this._adapter = null; this._teardown = null; }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value || null; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._teardown?.(); this._teardown = null; }
  attributeChangedCallback(name, oldValue, newValue) { if (oldValue !== newValue && this.isConnected) this._mount(); }
  _mount() {
    this._teardown?.();
    this.classList.add('gcsp');
    const fixture = this.getAttribute('fixture');
    const adapter = this._adapter || (fixture ? planFixtureAdapter(fixture) : createOrderPlanHttpAdapter());
    const Ev = this.ownerDocument.defaultView?.CustomEvent || CustomEvent;
    this._teardown = mountGregOrderPlan(this, { adapter,
      onSubmitted: (detail) => this.dispatchEvent(new Ev('gcsp:order-plan-submitted', { detail, bubbles: true, composed: true })) });
  }
  refresh() { return this._teardown?.refresh(); }
}
export function defineGcspGregOrderPlan(registry = globalThis.customElements) {
  if (!registry) return null;
  if (!registry.get('gcsp-greg-order-plan')) registry.define('gcsp-greg-order-plan', GcspGregOrderPlanElement);
  return registry.get('gcsp-greg-order-plan');
}
