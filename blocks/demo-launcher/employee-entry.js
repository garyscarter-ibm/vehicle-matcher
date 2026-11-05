import { ACCESS_KEY_STORAGE } from '../vehicle-matcher/engine.js';

// Only an employee route invokes this loader. Retail never imports the account tree.
export async function loadEmployeeEntry() {
  const [entry, transport] = await Promise.all([
    import('../gcsp/account/gcsp-account.js'),
    import('../gcsp/account/http-adapter.js'),
  ]);
  return { ...entry, ...transport };
}

export function createEmployeeCapability({ enabled = true, load = loadEmployeeEntry,
  fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  return { enabled, async mount(root, context, { signal, defaultApi = '' } = {}) {
    const { defineGcspAccount, createAccountHttpAdapter } = await load();
    if (signal?.aborted) return undefined;
    const win = root.ownerDocument.defaultView;
    const page = new URL(context.location, win.location.href);
    const base = page.searchParams.get('api') || defaultApi;
    const request = async (url, options) => {
      const key = win.sessionStorage.getItem(ACCESS_KEY_STORAGE);
      const response = await fetchImpl(url, { ...options,
        headers: { ...options.headers, ...(key ? { 'X-Access-Key': key } : {}) } });
      if (response.status === 401 && !signal?.aborted) {
        let envelope;
        try { envelope = await response.clone().json(); } catch { /* Preserve the adapter's invalid-response state. */ }
        if (envelope?.error === 'Unauthorized' && !signal?.aborted) {
          win.sessionStorage.removeItem(ACCESS_KEY_STORAGE);
          win.dispatchEvent(new win.CustomEvent('vm-auth-failed'));
        }
      }
      return response;
    };
    defineGcspAccount(win.customElements);
    const element = root.ownerDocument.createElement('gcsp-account');
    element.setAttribute('brand', context.brand);
    element.adapter = createAccountHttpAdapter({ base, fetchImpl: request });
    const stylesheets = ['../gcsp/shell/gcsp-shell.css', '../gcsp/account/gcsp-account.css'].map((path) => {
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
