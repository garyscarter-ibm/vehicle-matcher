import { CanDeactivateFn, Routes } from '@angular/router';
import type { ManualRouteComponent } from './manual/manual-route.component';
import { sessionGuard, landingGuard } from './auth/route.guards';
import { Role } from './auth/auth.port';
import { StatePageComponent } from './pages/state-page.component';
const feature = (path: string, title: string, roles: readonly Role[]) => ({ path, component: StatePageComponent, canActivate: [sessionGuard], data: { title, roles } });
const leaveManual: CanDeactivateFn<ManualRouteComponent> = (component, _current, _state, next) => component.canLeave(next.url);
export const routes: Routes = [
  { path: '', pathMatch: 'full', component: StatePageComponent, canActivate: [landingGuard] },
  { path: 'sign-in', component: StatePageComponent, data: { kind: 'sign-in' } },
  { path: 'auth/callback', component: StatePageComponent, data: { kind: 'callback' } },
  { path: 'account', loadComponent: () => import('./account/account.component').then((m) => m.AccountComponent), canActivate: [sessionGuard], data: { title: 'Your cars', roles: ['employee'] } },
  { path: 'preferences', loadComponent: () => import('./preferences/preferences.component').then((m) => m.PreferencesComponent), canActivate: [sessionGuard], data: { title: 'Your preferences', roles: ['employee'] } },
  { path: 'stock', loadComponent: () => import('./stock/stock-route.component').then((m) => m.StockRouteComponent), canActivate: [sessionGuard], data: { title: 'Choose a car', roles: ['employee'] } },
  { path: 'manual/review', loadComponent: () => import('./manual/manual-route.component').then((m) => m.ManualRouteComponent), canActivate: [sessionGuard], canDeactivate: [leaveManual], data: { title: 'Review your selection', roles: ['employee'], manualPage: 'review' } },
  { path: 'manual/summary', loadComponent: () => import('./manual/manual-route.component').then((m) => m.ManualRouteComponent), canActivate: [sessionGuard], canDeactivate: [leaveManual], data: { title: 'Order summary', roles: ['employee'], manualPage: 'summary' } },
  { path: 'activity', loadComponent: () => import('./activity/activity.component').then((m) => m.ActivityComponent), canActivate: [sessionGuard], data: { title: 'Buddy activity', roles: ['employee'] } },
  { path: 'offers/:offerId', loadComponent: () => import('./offers/offer-route.component').then((m) => m.OfferRouteComponent), canActivate: [sessionGuard], data: { title: 'Your offer', roles: ['employee'] } }, { path: 'orders', loadComponent: () => import('./orders/orders.component').then((m) => m.OrdersComponent), canActivate: [sessionGuard], data: { title: 'Order progress', roles: ['employee'] } }, { path: 'help', loadComponent: () => import('./help/help.component').then((m) => m.HelpComponent), canActivate: [sessionGuard], data: { title: 'Renewal help', roles: ['employee'] } },
  feature('greg', 'Employee car ordering', ['greg']), { path: 'greg/cases', loadComponent: () => import('./cases/case-queue.component').then((m) => m.CaseQueueComponent), canActivate: [sessionGuard], data: { title: 'Employee cases', roles: ['greg'] } },
  { path: 'comparison', loadComponent: () => import('./comparison/comparison.component').then((m) => m.ComparisonComponent), canActivate: [sessionGuard], data: { title: 'Process comparisons', roles: ['greg', 'presenter'] } },
  { path: 'presenter', loadComponent: () => import('./presenter/presenter.component').then((m) => m.PresenterComponent), canActivate: [sessionGuard], data: { title: 'Presenter controls', roles: ['presenter'] } },
  { path: 'presenter/outbox', loadComponent: () => import('./outbox/outbox.component').then((m) => m.OutboxComponent), canActivate: [sessionGuard], data: { title: 'Outbox', roles: ['presenter'] } },
  { path: 'components', loadComponent: () => import('./pages/gallery.component').then((m) => m.GalleryComponent) },
  { path: 'access-denied', component: StatePageComponent, data: { kind: 'denied' } },
  { path: 'unavailable', component: StatePageComponent, data: { kind: 'unavailable' } },
  { path: '**', component: StatePageComponent, data: { kind: 'not-found' } },
];
