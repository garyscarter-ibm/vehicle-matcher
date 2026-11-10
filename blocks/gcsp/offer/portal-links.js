import { ACCOUNT_MENU, PORTAL_NAVIGATION, PORTAL_ROUTES, routeAccountMenu } from '../employee/portal-navigation.js';

export { PORTAL_ROUTES };

/** Rail and onward links for a signed-in employee; an offer opened without a session gets none. */
export function signedInPortal(account, location) {
  if (account?.status !== 'ready') return {};
  return { navigation: PORTAL_NAVIGATION, accountMenu: ACCOUNT_MENU,
    onNavigate: (key) => { routeAccountMenu(key, location); },
    links: { orderProgress: PORTAL_ROUTES['order-progress'], cars: PORTAL_ROUTES.cars, help: PORTAL_ROUTES.help } };
}
