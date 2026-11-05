import { statusScreen } from '../../vehicle-matcher/ui.js';
import { portalShell } from '../shell/portal-shell.js';
import { mountAccount } from '../account/gcsp-account.js';
import { createAccountHttpAdapter } from '../account/http-adapter.js';
import { mountGregDashboard } from '../greg/gcsp-greg.js';
import { createGregHttpAdapter } from '../greg/http-adapter.js';
import { createPresenterHttpAdapter } from './http-adapter.js';

// Context is read again after cookie issuance; neither query parameters nor fixtures select a person.
export function mountPresenterWorkspace(host, { adapter = createPresenterHttpAdapter(), accountAdapter = createAccountHttpAdapter(),
  gregAdapter = createGregHttpAdapter(), mountEmployee = mountAccount, mountGreg = mountGregDashboard } = {}) {
  const abort = new AbortController(); let disposed = false; let teardown;
  host.replaceChildren(statusScreen({ title: 'Loading workspace', message: 'Reading the acting session.' }));
  const ready = (async () => {
    let reply;
    try { reply = await adapter.readContext({ signal: abort.signal }); } catch { reply = { status: 'unavailable' }; }
    if (disposed) return;
    const context = reply.status === 'ok' ? reply.value : null;
    if (context?.roles?.includes('employee')) teardown = mountEmployee(host, { adapter: accountAdapter });
    else if (context?.roles?.includes('greg')) teardown = mountGreg(host, { ...gregAdapter, signal: abort.signal });
    else {
      const shell = portalShell({ account: context?.name ? { status: 'ready', name: context.name } : { status: 'unavailable' },
        presenterControls: { adapter } });
      shell.main.append(statusScreen({ title: context ? 'Presenter workspace' : 'Workspace unavailable',
        message: context ? 'Choose an acting principal in Presenter controls.' : `Context ${reply.status}. Try again. If the session cannot be recovered, use trusted backend presenter-session bootstrap and reopen this workspace.` }));
      host.replaceChildren(shell.root); teardown = () => shell.destroy();
    }
  })();
  const destroy = () => { disposed = true; abort.abort(); teardown?.(); host.replaceChildren(); };
  destroy.ready = ready; return destroy;
}

export function startPresenterWorkspace(document = globalThis.document) {
  const host = document.querySelector('[data-presenter-workspace]');
  return host ? mountPresenterWorkspace(host) : null;
}
