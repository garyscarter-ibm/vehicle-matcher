// The one Paula rail and its routes. Dependency-free: page modules import it, never the reverse.
const item = (key, label, paths) => Object.freeze({ key, label, available: true, icon: Object.freeze(paths) });

export const PORTAL_NAVIGATION = Object.freeze([
  item('cars', 'Your cars', ['M3 14l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5', 'M3 14h18v4H3z', 'M7 18v2', 'M17 18v2']),
  item('brief', 'Your car brief', ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4']),
  item('activity', 'Buddy activity', ['M4 5h16', 'M4 12h16', 'M4 19h16', 'M8 3v4', 'M8 10v4', 'M8 17v4']),
  item('order-progress', 'Order progress', ['M4 6l2 2 3-3', 'M4 14l2 2 3-3', 'M12 7h8', 'M12 15h8']),
]);

// The live employee pages the rail and the offer can lead to, keyed like the navigation items they belong to.
export const PORTAL_ROUTES = Object.freeze({ cars: '/gcsp-account.html', brief: '/gcsp-brief-live.html', activity: '/gcsp-activity-live.html',
  'order-progress': '/gcsp-order-progress-live.html', help: '/gcsp-help.html' });

/** Go to the live page of a rail key; false (and no navigation) for anything else. */
export function routePortal(key, location) {
  if (!location || !PORTAL_NAVIGATION.some((entry) => entry.key === key)) return false;
  location.assign(PORTAL_ROUTES[key]);
  return true;
}

/** Let a host element's cancelable gcsp:navigate event route every rail key. */
export function routePortalEvents(host, location = host.ownerDocument?.defaultView?.location) {
  host.addEventListener('gcsp:navigate', (event) => { if (routePortal(event.detail?.to, location)) event.preventDefault(); });
}

/** Release a held reservation first, then route; a release that is not confirmed leaves the page where it is. */
export async function routeAfterRelease(key, { held, release, location }) {
  try { if (held() && (await release())?.status !== 'ok') return false; } catch { return false; }
  return routePortal(key, location);
}
