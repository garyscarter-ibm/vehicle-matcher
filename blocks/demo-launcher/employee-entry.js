// Only an employee route invokes this loader. Retail never imports the account tree.
export async function loadEmployeeEntry() {
  const [entry, transport] = await Promise.all([
    import('../gcsp/manual-setup/journey.js'),
    import('../gcsp/account/http-adapter.js'),
  ]);
  return { ...entry, ...transport };
}

export function createEmployeeCapability({ enabled = true, load = loadEmployeeEntry,
  fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  return { enabled, async mount(root, context, { signal, defaultApi = '' } = {}) {
    const { mountManualJourney, createAccountHttpAdapter } = await load();
    if (signal?.aborted) return undefined;
    const win = root.ownerDocument.defaultView;
    const page = new URL(context.location, win.location.href);
    const base = page.searchParams.get('api') || defaultApi;
    const request = (url, options) => fetchImpl(url, options);
    if (!win.customElements.get('gcsp-employee-entry')) {
      win.customElements.define('gcsp-employee-entry', class extends win.HTMLElement {
        connectedCallback() {
          this._teardown?.();
          this._teardown = mountManualJourney(this, { adapter: this.adapter, brand: this.getAttribute('brand') });
        }
        disconnectedCallback() { this._teardown?.(); this._teardown = null; }
        refresh() { this.connectedCallback(); }
      });
    }
    const element = root.ownerDocument.createElement('gcsp-employee-entry');
    element.setAttribute('brand', context.brand);
    element.adapter = createAccountHttpAdapter({ base, fetchImpl: request });
    const stylesheets = ['../gcsp/shell/gcsp-shell.css', '../gcsp/account/gcsp-account.css', '../gcsp/manual-setup/gcsp-manual-setup.css'].map((path) => {
      const link = root.ownerDocument.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(path, import.meta.url).href;
      return link;
    });
    root.append(...stylesheets, element);
    const cleanup = () => { element.remove(); stylesheets.forEach((link) => link.remove()); };
    signal?.addEventListener('abort', cleanup, { once: true });
    return () => { signal?.removeEventListener('abort', cleanup); cleanup(); };
  } };
}
