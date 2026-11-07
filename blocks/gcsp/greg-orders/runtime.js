import { defineGcspGregOrders } from './greg-orders.js';
import { createGregOrdersHttpAdapter } from './http-adapter.js';

const attachments = new WeakMap();

/** Attach to the dashboard's existing reserved region; its host owns identity, demand and disclosure. */
export function attachGregOrders(dashboard, { adapter = createGregOrdersHttpAdapter(), productionControls = false,
  onChanged = () => dashboard.refresh(), signal } = {}) {
  attachments.get(dashboard)?.();
  if (signal?.aborted) return () => {};
  defineGcspGregOrders();
  let mounted = null; let stopped = false;
  function clear() {
    if (!mounted) return;
    const { region, orders, children, reserved } = mounted;
    orders.removeEventListener('gcsp:orders-changed', onChanged);
    if (orders.parentNode === region) region.replaceChildren(...children);
    region.classList.remove('gcsp-orders-host');
    if (reserved) region.classList.add('gcsp-greg-region');
    mounted = null;
  }
  function mount() {
    if (stopped) return;
    const region = dashboard.regions?.orderTracking;
    if (region === mounted?.region) return;
    clear();
    if (!region) return;
    const orders = dashboard.ownerDocument.createElement('gcsp-greg-orders');
    orders.adapter = adapter;
    if (productionControls) orders.setAttribute('presenter-controls', '');
    orders.addEventListener('gcsp:orders-changed', onChanged);
    mounted = { region, orders, children: [...region.childNodes], reserved: region.classList.contains('gcsp-greg-region') };
    region.classList.remove('gcsp-greg-region'); region.classList.add('gcsp-orders-host');
    region.replaceChildren(orders);
  }
  function ready(event) {
    if (event.target === dashboard && event.detail?.view === 'dashboard') mount();
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    dashboard.removeEventListener('gcsp:ready', ready); signal?.removeEventListener('abort', stop);
    clear();
    if (attachments.get(dashboard) === stop) attachments.delete(dashboard);
  }
  attachments.set(dashboard, stop);
  dashboard.addEventListener('gcsp:ready', ready); signal?.addEventListener('abort', stop, { once: true });
  mount();
  return stop;
}
