import { ChangeDetectorRef, Component, computed, DestroyRef, effect, ElementRef, HostListener, inject, signal, untracked, viewChild, ViewEncapsulation } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthPort, Role } from '../auth/auth.port';
import { safeReturnTo, navigationFor, permits } from '../auth/route-policy';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { ButtonDirective } from '../kit/button.directive';
import { NotificationBellComponent } from '../kit/notification-bell.component';
import { NotificationModel, emptyNotifications } from '../kit/notification-bell.types';
import { NotificationSource, notificationScopeKey } from '../activity/notification.source';
@Component({ selector: 'gcsp-root', imports: [RouterLink, RouterOutlet, RouterLinkActive, ButtonDirective, StatusScreenComponent, NotificationBellComponent], templateUrl: './shell.component.html', encapsulation: ViewEncapsulation.None })
export class ShellComponent {
  readonly auth = inject(AuthPort); private readonly changeDetector = inject(ChangeDetectorRef); private readonly router = inject(Router); private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly context = computed(() => { const state = this.auth.state(); return state.status === 'ready' ? state.context : null; });
  readonly initials = computed(() => {
    const words = (this.context()?.displayName ?? '').replace(/\(.*?\)/g, ' ').split(/[\s-]+/).filter(Boolean);
    return words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() : '?';
  });
  readonly navigation = computed(() => navigationFor(this.context()?.roles ?? []));
  readonly employee = computed(() => this.context()?.roles.includes('employee') && !this.context()?.roles.includes('presenter'));
  private readonly notificationSource = inject(NotificationSource);
  private readonly notificationState = signal<{ key: string | null; model: NotificationModel }>({ key: null, model: emptyNotifications('unavailable') });
  readonly notifications = computed(() => {
    const key = notificationScopeKey(this.auth.state()); const saved = this.notificationState();
    return key && saved.key === key ? saved.model : emptyNotifications(key ? 'loading' : 'unavailable');
  });
  private readonly bell = viewChild(NotificationBellComponent);
  private readonly routeRoles = signal<readonly Role[] | null>(null);
  // A retained private route mounts only for a context its roles permit (recovery or restore may change them).
  readonly routeAllowed = computed(() => { const roles = this.routeRoles(); const context = this.context(); return roles === null || (context !== null && permits(context.roles, roles)); });
  expanded = false; menuOpen = false; signOutBusy = false; signOutFailed = false;
  constructor() {
    const disconnect = this.notificationSource.connect((model, key) => this.notificationState.set({ key, model }));
    inject(DestroyRef).onDestroy(disconnect);
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
      this.menuOpen = false;
      const roles = this.router.routerState.snapshot.root.firstChild?.data['roles'];
      this.routeRoles.set(Array.isArray(roles) ? roles : null);
      requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus());
    });
    effect(() => { if (this.context() && !this.routeAllowed()) untracked(() => void this.router.navigate(['/access-denied'], { replaceUrl: true })); });
  }
  // Flush auth's synchronous pagehide invalidation before the browser freezes its page snapshot.
  @HostListener('window:pagehide') hidePrivateSnapshot(): void { this.changeDetector.detectChanges(); }
  async retryAccount(): Promise<void> { await this.auth.retry(); }
  async signIn(): Promise<void> { await this.auth.signIn(safeReturnTo('/gcsp' + this.router.url)); }
  skipToMain(event: Event): void { event.preventDefault(); this.host.nativeElement.querySelector<HTMLElement>('main')?.focus(); }
  closeMenu(event: Event): void {
    if (!this.menuOpen) return;
    event.preventDefault(); event.stopPropagation(); this.menuOpen = false;
    this.host.nativeElement.querySelector<HTMLButtonElement>('.gcsp-menu-toggle')?.focus();
  }
  async signOut(): Promise<void> { if (this.signOutBusy) return; this.signOutBusy = true; this.signOutFailed = false; try { await this.auth.signOut(); } catch { this.signOutFailed = true; } finally { this.signOutBusy = false; } }
  closeAccount(event: Event): void { const details = (event.target as HTMLElement).closest('details'); if (details) { details.open = false; details.querySelector('summary')?.focus(); } }
  closeAccountForBell(): void { const details = this.host.nativeElement.querySelector<HTMLDetailsElement>('.gcsp-account-details'); if (details) details.open = false; }
  onAccountToggle(event: Event): void { if ((event.target as HTMLDetailsElement).open) this.bell()?.close(false); }
  navigateNotification(href: string): void { if (href.startsWith('/gcsp/')) void this.router.navigateByUrl(href.slice('/gcsp'.length)); }
}
