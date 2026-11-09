import { EMPLOYEE_NAVIGATION } from '../employee/gcsp-employee.js';
import { ACTIVITY_DESTINATION } from '../activity/gcsp-activity.js';
import { ORDER_PROGRESS_DESTINATION } from '../order-progress/gcsp-order-progress.js';

// The live employee pages the offer can lead to, keyed like the navigation items they belong to.
export const PORTAL_ROUTES = Object.freeze({ cars: '/gcsp-account.html', brief: '/gcsp-brief-live.html', activity: '/gcsp-activity-live.html',
  'order-progress': '/gcsp-order-progress-live.html', help: '/gcsp-help.html' });

// Same key, label and icon as the brief item on the live journey pages.
const BRIEF_DESTINATION = Object.freeze({ key: 'brief', label: 'Your car brief', available: true,
  icon: Object.freeze(['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4']) });
const CARS = EMPLOYEE_NAVIGATION.find((item) => item.key === 'cars');

/** Rail and onward links for a signed-in employee; an offer opened without a session gets none. */
export function signedInPortal(account, location) {
  if (account?.status !== 'ready') return {};
  return { navigation: [CARS, BRIEF_DESTINATION, ACTIVITY_DESTINATION, ORDER_PROGRESS_DESTINATION],
    onNavigate: (key) => { if (PORTAL_ROUTES[key]) location.assign(PORTAL_ROUTES[key]); },
    links: { orderProgress: PORTAL_ROUTES['order-progress'], cars: PORTAL_ROUTES.cars, help: PORTAL_ROUTES.help } };
}
