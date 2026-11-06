// Explicit same-origin integration harness; the server must bootstrap real sessions.
import { defineGcspGregDashboard } from '../greg/gcsp-greg.js';
import { createGregHttpAdapter } from '../greg/http-adapter.js';
import { defineGcspGregOrders } from './greg-orders.js';
import { createGregOrdersHttpAdapter } from './http-adapter.js';

defineGcspGregDashboard(); defineGcspGregOrders();
const dashboard = document.querySelector('gcsp-greg-dashboard');
if (dashboard) {
  dashboard.adapter = createGregHttpAdapter();
  const region = dashboard.regions?.orderTracking;
  if (region) {
    region.classList.remove('gcsp-greg-region'); region.classList.add('gcsp-orders-host');
    const orders = document.createElement('gcsp-greg-orders');
    orders.setAttribute('presenter-controls', ''); orders.adapter = createGregOrdersHttpAdapter();
    orders.addEventListener('gcsp:orders-changed', () => dashboard.refresh());
    region.replaceChildren(orders);
  }
}
