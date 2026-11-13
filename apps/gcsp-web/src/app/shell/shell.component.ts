import { Component, computed, ElementRef, inject, ViewEncapsulation } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthPort } from '../auth/auth.port';
import { navigationFor } from '../auth/route-policy';
import { ButtonDirective } from '../kit/button.directive';
@Component({ selector: 'gcsp-root', imports: [RouterLink, RouterOutlet, RouterLinkActive, ButtonDirective], templateUrl: './shell.component.html', encapsulation: ViewEncapsulation.None })
export class ShellComponent {
  readonly auth = inject(AuthPort); private readonly router = inject(Router); private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly context = computed(() => { const state = this.auth.state(); return state.status === 'ready' ? state.context : null; });
  readonly initials = computed(() => {
    const words = (this.context()?.displayName ?? '').replace(/\(.*?\)/g, ' ').split(/[\s-]+/).filter(Boolean);
    return words.length ? (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase() : '?';
  });
  readonly navigation = computed(() => navigationFor(this.context()?.roles ?? []));
  readonly employee = computed(() => this.context()?.roles.includes('employee') && !this.context()?.roles.includes('presenter'));
  expanded = false; menuOpen = false; signOutBusy = false; signOutFailed = false;
  constructor() {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
      this.menuOpen = false;
      requestAnimationFrame(() => document.querySelector<HTMLElement>('main h1')?.focus());
    });
  }
  skipToMain(event: Event): void { event.preventDefault(); this.host.nativeElement.querySelector<HTMLElement>('main')?.focus(); }
  closeMenu(event: Event): void {
    if (!this.menuOpen) return;
    event.preventDefault(); event.stopPropagation(); this.menuOpen = false;
    this.host.nativeElement.querySelector<HTMLButtonElement>('.gcsp-menu-toggle')?.focus();
  }
  async signOut(): Promise<void> { if (this.signOutBusy) return; this.signOutBusy = true; this.signOutFailed = false; try { await this.auth.signOut(); } catch { this.signOutFailed = true; } finally { this.signOutBusy = false; } }
  closeAccount(event: Event): void { const details = (event.target as HTMLElement).closest('details'); if (details) { details.open = false; details.querySelector('summary')?.focus(); } }
}
