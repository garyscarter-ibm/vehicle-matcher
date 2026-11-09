import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { createOrderProgressHttpAdapter } from './order-progress-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { createAccountHttpAdapter as createOrderReadAdapter } from '../account/http-adapter.js';
import { loadLatestOrderCar } from './order-car.js';
import { subscribePresenterActions } from '../presenter-controls/controls.js';
import { routePortalEvents } from '../employee/portal-navigation.js';
import { defineGcspOrderProgress } from './gcsp-order-progress.js';

const host = globalThis.document?.querySelector('gcsp-order-progress[data-live]');
if (host) {
  const orders = createOrderProgressHttpAdapter({ fetch: globalThis.fetch, loadAccount: createAccountHttpAdapter().loadAccount });
  // The car is read once, bounded, before the element upgrades so the page never repaints; a failed read keeps the fallback.
  const car = await loadLatestOrderCar({ listOrders: orders.listOrders, readOrder: createOrderReadAdapter({ fetchImpl: globalThis.fetch }).readOrder,
    signal: globalThis.AbortSignal?.timeout?.(8000) });
  host.helpAdapter = createCaseHttpAdapter();
  host.car = car;
  host.adapter = { ...orders, subscribeClock: subscribePresenterActions(host) };
  defineGcspOrderProgress();
  routePortalEvents(host);
  globalThis.addEventListener('pageshow', (event) => { if (event.persisted) host.refresh(); });
}
