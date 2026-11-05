import { mountGregPublish } from './panel.js';
import { createGregPublishHttpAdapter } from './http-adapter.js';

export class GcspGregPublishElement extends HTMLElement {
  constructor() { super(); this._adapter = null; this._teardown = null; }
  get adapter() { return this._adapter; }
  set adapter(value) { this._adapter = value; if (this.isConnected) this._mount(); }
  connectedCallback() { this._mount(); }
  disconnectedCallback() { this._teardown?.(); this._teardown = null; }
  _mount() {
    this._teardown?.();
    this.classList.add('gcsp');
    this._teardown = mountGregPublish(this, { adapter: this._adapter || createGregPublishHttpAdapter() });
  }
  refresh() { return this._teardown?.refresh(); }
}
export function defineGcspGregPublish(registry = globalThis.customElements) {
  if (!registry) return null;
  if (!registry.get('gcsp-greg-publish')) registry.define('gcsp-greg-publish', GcspGregPublishElement);
  return registry.get('gcsp-greg-publish');
}
