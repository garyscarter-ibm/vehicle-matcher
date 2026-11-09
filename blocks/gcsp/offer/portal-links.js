import { PORTAL_NAVIGATION, PORTAL_ROUTES, routePortal } from '../employee/portal-navigation.js';

export { PORTAL_ROUTES };

/** Rail and onward links for a signed-in employee; an offer opened without a session gets none. */
export function signedInPortal(account, location) {
  if (account?.status !== 'ready') return {};
  return { navigation: PORTAL_NAVIGATION,
    onNavigate: (key) => { routePortal(key, location); },
    links: { orderProgress: PORTAL_ROUTES['order-progress'], cars: PORTAL_ROUTES.cars, help: PORTAL_ROUTES.help } };
}
