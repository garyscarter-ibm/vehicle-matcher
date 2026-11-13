import { Routes } from '@angular/router';
import { sessionGuard, landingGuard } from './auth/route.guards';
import { Role } from './auth/auth.port';
import { StatePageComponent } from './pages/state-page.component';
const feature = (path: string, title: string, roles: readonly Role[]) => ({ path, component: StatePageComponent, canActivate: [sessionGuard], data: { title, roles } });
export const routes: Routes = [
  { path: '', pathMatch: 'full', component: StatePageComponent, canActivate: [landingGuard] },
  { path: 'sign-in', component: StatePageComponent, data: { kind: 'sign-in' } },
  { path: 'auth/callback', component: StatePageComponent, data: { kind: 'callback' } },
  feature('account', 'Your cars', ['employee']), feature('preferences', 'Your preferences', ['employee']),
  feature('stock', 'Choose a car', ['employee']), feature('manual/review', 'Review your selection', ['employee']), feature('manual/summary', 'Order summary', ['employee']),
  feature('activity', 'Buddy activity', ['employee']), feature('offers/:offerId', 'Your offer', ['employee']), feature('orders', 'Order progress', ['employee']), feature('help', 'Renewal help', ['employee']),
  feature('greg', 'Employee car ordering', ['greg']), feature('greg/cases', 'Employee cases', ['greg']),
  feature('presenter', 'Presenter controls', ['presenter']), feature('presenter/outbox', 'Outbox', ['presenter']),
  { path: 'components', loadComponent: () => import('./pages/gallery.component').then((m) => m.GalleryComponent) },
  { path: 'access-denied', component: StatePageComponent, data: { kind: 'denied' } },
  { path: 'unavailable', component: StatePageComponent, data: { kind: 'unavailable' } },
  { path: '**', component: StatePageComponent, data: { kind: 'not-found' } },
];
