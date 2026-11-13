import { describe, expect, it } from 'vitest';
import { landingFor, navigationFor, permits, safeReturnTo } from './route-policy';
import { routes } from '../routes';
describe('role route policy', () => {
  it('keeps the employee rail at the agreed two destinations', () => {
    expect(navigationFor(['employee']).map((item) => item.label)).toEqual(['Your cars', 'Order progress']);
  });
  it('composes employee and Greg destinations without impersonation', () => {
    expect(navigationFor(['employee', 'greg']).map((item) => item.path)).toEqual(['account', 'orders', 'greg']);
    expect(navigationFor(['greg']).map((item) => item.label)).toEqual(['Employee car ordering']);
    expect(landingFor(['greg'])).toBe('greg');
    expect(permits(['greg'], ['employee'])).toBe(false);
  });
  it('keeps the presenter dedicated even for a context with additional roles', () => {
    expect(navigationFor(['presenter', 'employee', 'greg']).map((item) => item.path)).toEqual(['presenter']);
    expect(permits(['presenter', 'employee'], ['employee'])).toBe(false);
    expect(permits(['presenter'], ['presenter'])).toBe(true);
    expect(landingFor([])).toBeNull();
  });
  it('owns every published browser route through Angular guards', () => {
    const paths = ['account', 'preferences', 'stock', 'manual/review', 'manual/summary', 'activity', 'offers/:offerId', 'orders', 'help', 'greg', 'greg/cases', 'presenter', 'presenter/outbox'];
    for (const path of paths) expect(routes.find((route) => route.path === path)?.canActivate?.length).toBe(1);
    for (const path of ['sign-in', 'auth/callback']) expect(routes.some((route) => route.path === path)).toBe(true);
  });
  it('retains owned deep links but rejects external, callback and malformed return paths', () => {
    expect(safeReturnTo('/gcsp/offers/offer-7?source=email')).toBe('/gcsp/offers/offer-7?source=email');
    for (const path of ['https://other.invalid/gcsp/account', '//other.invalid', '/gcsp/auth/callback', '/gcsp/sign-in', '/gcsp/account\\evil', '/gcsp/../presenter', '/gcsp/account\n', '/account']) expect(safeReturnTo(path)).toBe('/gcsp/');
  });
});
