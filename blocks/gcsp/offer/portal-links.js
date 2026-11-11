import { ACCOUNT_MENU, PORTAL_NAVIGATION, PORTAL_ROUTES, routeAccountMenu } from '../employee/portal-navigation.js';

export { PORTAL_ROUTES };

/** Keep the shared escape routes even when account details cannot be read. */
export function signedInPortal(account, location) {
  return { navigation: PORTAL_NAVIGATION,
    onNavigate: (key) => { routeAccountMenu(key, location); },
    ...(account?.status === 'ready' ? { accountMenu: ACCOUNT_MENU,
      links: { orderProgress: PORTAL_ROUTES['order-progress'], cars: PORTAL_ROUTES.cars, activity: PORTAL_ROUTES.activity, help: PORTAL_ROUTES.help } } : {}) };
}
