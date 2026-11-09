import { mountGregComparison } from './panel.js';
import { createComparisonHttpAdapter } from './http-adapter.js';
import { comparisonFixtureAdapter, experimentFixtureAdapter } from './fixtures.js';

export class GcspGregComparisonElement extends HTMLElement {
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
    const adapter = this._adapter || (fixture ? comparisonFixtureAdapter(fixture) ?? experimentFixtureAdapter(fixture) : createComparisonHttpAdapter());
    this._teardown = mountGregComparison(this, { adapter });
  }
  refresh() { return this._teardown?.refresh(); }
}
export function defineGcspGregComparison(registry = globalThis.customElements) {
  if (!registry) return null;
  if (!registry.get('gcsp-greg-comparison')) registry.define('gcsp-greg-comparison', GcspGregComparisonElement);
  return registry.get('gcsp-greg-comparison');
}
