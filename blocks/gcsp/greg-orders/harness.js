// Explicit same-origin integration harness; the server must bootstrap real sessions.
import { defineGcspGregDashboard } from '../greg/gcsp-greg.js';
import { createGregHttpAdapter } from '../greg/http-adapter.js';
import { attachGregOrders } from './runtime.js';

defineGcspGregDashboard();
const dashboard = document.querySelector('gcsp-greg-dashboard');
if (dashboard) {
  dashboard.adapter = createGregHttpAdapter();
  attachGregOrders(dashboard, { productionControls: true });
}
