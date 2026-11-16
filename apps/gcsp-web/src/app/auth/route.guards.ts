import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthPort, Role } from './auth.port';
import { landingFor, permits, safeReturnTo } from './route-policy';
export const sessionGuard: CanActivateFn = async (route, target) => {
  const auth = inject(AuthPort); const router = inject(Router);
  const returnTo = safeReturnTo(target.url.startsWith('/gcsp/') ? target.url : `/gcsp${target.url}`);
  try { await auth.initialize(); } catch { return router.createUrlTree(['/unavailable'], { queryParams: { returnTo } }); }
  const state = auth.state();
  if (state.status === 'signed-out') return router.createUrlTree(['/sign-in'], { queryParams: { returnTo } });
  if (state.status === 'denied') return router.createUrlTree(['/access-denied']);
  if (state.status !== 'ready') return true;
  return permits(state.context.roles, route.data['roles'] as readonly Role[]) || router.createUrlTree(['/access-denied']);
};
export const landingGuard: CanActivateFn = async (_route, target) => {
  const auth = inject(AuthPort); const router = inject(Router);
  const returnTo = safeReturnTo(`/gcsp${target.url}`);
  try { await auth.initialize(); } catch { return router.createUrlTree(['/unavailable'], { queryParams: { returnTo } }); }
  const state = auth.state();
  if (state.status === 'signed-out') return router.createUrlTree(['/sign-in'], { queryParams: { returnTo } });
  if (state.status !== 'ready') return true;
  const landing = landingFor(state.context.roles);
  const entry = router.parseUrl(target.url);
  return router.createUrlTree([landing ? `/${landing}` : '/access-denied'], { queryParams: entry.queryParams, fragment: entry.fragment });
};
