import type { Role } from './auth.port';
export interface Destination { readonly path: string; readonly label: string; readonly icon: readonly string[] }
const cars: Destination = { path: 'account', label: 'Your cars', icon: ['M3 14l2-5a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 5', 'M3 14h18v4H3z', 'M7 18v2', 'M17 18v2'] };
const orders: Destination = { path: 'orders', label: 'Order progress', icon: ['M4 6l2 2 3-3', 'M4 14l2 2 3-3', 'M12 7h8', 'M12 15h8'] };
const greg: Destination = { path: 'greg', label: 'Employee car ordering', icon: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M21 20H3'] };
const presenter: Destination = { path: 'presenter', label: 'Presenter controls', icon: ['M4 7h16', 'M4 17h16', 'M8 4v6', 'M16 14v6'] };
export function navigationFor(roles: readonly Role[]): readonly Destination[] {
  if (roles.includes('presenter')) return [presenter];
  return [...(roles.includes('employee') ? [cars, orders] : []), ...(roles.includes('greg') ? [greg] : [])];
}
export function landingFor(roles: readonly Role[]): string | null { return navigationFor(roles)[0]?.path ?? null; }
export function permits(roles: readonly Role[], required: readonly Role[]): boolean {
  if (roles.includes('presenter')) return required.includes('presenter');
  return required.some((role) => roles.includes(role));
}
const privateRoute = /^(?:account|preferences|stock|manual\/(?:review|summary)|activity|offers\/[^/?#]+|orders|help|greg(?:\/cases)?|presenter(?:\/outbox)?)$/;
export function safeReturnTo(value: string | null | undefined): string {
  if (!value?.startsWith('/gcsp/')) return '/gcsp/';
  const path = value.slice('/gcsp/'.length).split(/[?#]/)[0];
  if (!privateRoute.test(path) || /[\\\u0000-\u0020]/.test(value)) return '/gcsp/';
  return value;
}
