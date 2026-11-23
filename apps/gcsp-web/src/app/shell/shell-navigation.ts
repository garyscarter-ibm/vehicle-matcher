import type { Role } from '../auth/auth.port';

const employeeViews: Readonly<Record<string, string>> = {
  preferences: 'Your preferences', stock: 'Choose a car', 'manual/review': 'Review your selection',
  'manual/summary': 'Order summary', activity: 'Buddy activity', help: 'Renewal help',
};
export function currentDestination(destination: string, url: string): boolean {
  const path = url.split(/[?#]/)[0].replace(/^\//, '');
  return destination === 'greg/plan' ? path === 'greg' || path.startsWith('greg/') || path === 'comparison' : path === destination;
}
export function breadcrumbsFor(url: string, roles: readonly Role[]): readonly string[] {
  const path = url.split(/[?#]/)[0].replace(/^\//, '');
  if (roles.includes('presenter')) {
    const label = path === 'presenter/outbox' ? 'Captured emails' : path === 'comparison' ? 'Route comparison' : null;
    return label ? ['Presenter controls', label] : [];
  }
  if (!roles.includes('employee')) return [];
  const label = /^offers\/[^/]+$/.test(path) ? 'Your offer' : employeeViews[path];
  return label ? ['Your cars', label] : [];
}
