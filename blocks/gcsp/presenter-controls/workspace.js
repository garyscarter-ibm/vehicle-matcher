import { statusScreen } from '../../vehicle-matcher/ui.js';
import { portalShell } from '../shell/portal-shell.js';
import { mountManualJourney } from '../manual-setup/journey.js';
import { mountCaseQueue } from '../cases/gcsp-case-queue.js';
import { createAccountHttpAdapter } from '../account/http-adapter.js';
import { mountGregDashboard } from '../greg/gcsp-greg.js';
import { createGregHttpAdapter } from '../greg/http-adapter.js';
import { mountGregOrders } from '../greg-orders/greg-orders.js';
import { createGregOrdersHttpAdapter } from '../greg-orders/http-adapter.js';
import { createOrderProgressHttpAdapter } from '../order-progress/order-progress-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { createPresenterHttpAdapter } from './http-adapter.js';
import { subscribePresenterActions } from './controls.js';
import { isRunRestarted, runRestartedScreen } from '../kit/run-restarted.js';

// Context is read again after cookie issuance; neither query parameters nor fixtures select a person.
export function mountPresenterWorkspace(host, { adapter = createPresenterHttpAdapter(), accountAdapter = createAccountHttpAdapter(),
  gregAdapter = createGregHttpAdapter(), mountEmployee = mountManualJourney, mountGreg = mountGregDashboard,
  mountOrders = mountGregOrders, ordersAdapter = createGregOrdersHttpAdapter(), orderAdapter = createOrderProgressHttpAdapter(),
  helpAdapter = createCaseHttpAdapter(), reload } = {}) {
  const abort = new AbortController(); let disposed = false; let teardown;
  host.replaceChildren(statusScreen({ title: 'Loading workspace', message: 'Reading the acting session.' }));
  const ready = (async () => {
    let reply;
    try { reply = await adapter.readContext({ signal: abort.signal }); } catch { reply = { status: 'unavailable' }; }
    if (disposed) return;
    const context = reply.status === 'ok' ? reply.value : null;
    // Order progress and help are wired explicitly, as the account harness does (FUCQ-215).
    if (context?.roles?.includes('employee')) teardown = mountEmployee(host, { adapter: accountAdapter, orderAdapter, helpAdapter,
      subscribeClock: subscribePresenterActions(host),
      onSupport: () => globalThis.location.assign(new URL('../../../gcsp-help.html', import.meta.url).href) });
    else if (context?.roles?.includes('greg')) {
      let orders;
      const dashboard = mountGreg(host, { ...gregAdapter, signal: abort.signal, onOrderPlanSubmitted: () => orders?.refresh?.() });
      const region = dashboard.regions?.caseQueue;
      let queue;
      if (region) {
        region.removeAttribute('aria-labelledby'); region.setAttribute('aria-label', 'Renewal cases');
        region.replaceChildren(); queue = mountCaseQueue(region, { embedded: true, signal: abort.signal });
      }
      const ordersRegion = dashboard.regions?.orderTracking;
      if (ordersRegion) {
        // Full-width host, as attachGregOrders does; the dashed placeholder style is for empty regions.
        ordersRegion.classList.remove('gcsp-greg-region'); ordersRegion.classList.add('gcsp-orders-host');
        ordersRegion.replaceChildren();
        orders = mountOrders(ordersRegion, { adapter: ordersAdapter, productionControls: true, signal: abort.signal,
          onChanged: () => { dashboard.refresh?.(); dashboard.orderPlan?.refresh?.(); } });
      }
      // Presenter clock actions change supply, so both figures reload without a manual Refresh.
      const onAction = () => { dashboard.refresh?.(); orders?.refresh?.(); dashboard.orderPlan?.refresh?.(); };
      host.addEventListener('gcsp:presenter-action', onAction);
      teardown = () => { host.removeEventListener('gcsp:presenter-action', onAction); orders?.(); queue?.(); dashboard(); };
    }
    else {
      const shell = portalShell({ account: context?.name ? { status: 'ready', name: context.name } : { status: 'unavailable' },
        presenterControls: { adapter, reload } });
      shell.main.append(!context && isRunRestarted(reply) ? runRestartedScreen({ reload })
        : statusScreen({ title: context ? 'Presenter workspace' : 'Workspace unavailable',
          message: context ? 'Choose an acting principal in Presenter controls.' : 'Presenter context could not be read. Try again. If the session cannot be recovered, use trusted backend presenter-session bootstrap and reopen this workspace.' }));
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
