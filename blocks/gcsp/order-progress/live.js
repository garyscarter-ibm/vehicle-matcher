import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { createOrderProgressHttpAdapter } from './order-progress-http.js';
import { createCaseHttpAdapter } from '../cases/http-adapter.js';
import { createAccountHttpAdapter as createOrderReadAdapter } from '../account/http-adapter.js';
import { loadLatestOrderCar } from './order-car.js';
import { subscribePresenterActions } from '../presenter-controls/controls.js';
import { ORDER_PROGRESS_DESTINATION, defineGcspOrderProgress } from './gcsp-order-progress.js';

const host = globalThis.document?.querySelector('gcsp-order-progress[data-live]');
if (host) {
  const orders = createOrderProgressHttpAdapter({ fetch: globalThis.fetch, loadAccount: createAccountHttpAdapter().loadAccount });
  const navigation = [
    { key: 'brief', label: 'Your car brief', available: true, icon: ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'] },
    { key: 'activity', label: 'Buddy activity', available: true, icon: ['M4 5h16', 'M4 12h16', 'M4 19h16', 'M8 3v4', 'M8 10v4', 'M8 17v4'] },
    ORDER_PROGRESS_DESTINATION,
  ];
  // The car is read once, bounded, before the element upgrades so the page never repaints; a failed read keeps the fallback.
  const car = await loadLatestOrderCar({ listOrders: orders.listOrders, readOrder: createOrderReadAdapter({ fetchImpl: globalThis.fetch }).readOrder,
    signal: globalThis.AbortSignal?.timeout?.(8000) });
  host.helpAdapter = createCaseHttpAdapter();
  host.car = car;
  host.adapter = { ...orders, navigation, subscribeClock: subscribePresenterActions(host) };
  defineGcspOrderProgress();
  host.addEventListener('gcsp:navigate', (event) => {
    const page = { brief: '/gcsp-brief-live.html', activity: '/gcsp-activity-live.html' }[event.detail?.to];
    if (page) { event.preventDefault(); globalThis.location.assign(page); }
  });
  globalThis.addEventListener('pageshow', (event) => { if (event.persisted) host.refresh(); });
}
