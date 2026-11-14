import { Location } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { StockComponent } from './stock.component';
import { StockNavigationSnapshot } from './stock.store';

const historyKey = 'gcspStock';
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

@Component({
  selector: 'gcsp-stock-route',
  imports: [StockComponent],
  template: `<gcsp-stock [navigation]="navigation()" (navigationChange)="saveNavigation($event)"
    reviewUnavailableReason="Reviewing a car is currently unavailable. You can still browse cars and view their details."
    (back)="backToChoices()" />`,
})
export class StockRouteComponent {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly routePath = this.location.path().split('?')[0];
  readonly navigation = signal<unknown>(record(this.location.getState())[historyKey] ?? null);
  private lastSnapshot: string | undefined;
  private disposed = false;

  constructor() {
    const subscription = this.location.subscribe(event => {
      if (this.onStockPath()) {
        this.lastSnapshot = undefined;
        this.navigation.set(record(event.state)[historyKey] ?? null);
      }
    });
    inject(DestroyRef).onDestroy(() => { this.disposed = true; subscription.unsubscribe(); });
  }

  saveNavigation(event: { readonly snapshot: StockNavigationSnapshot | null; readonly replace: boolean }): void {
    if (this.disposed || !this.onStockPath()) return;
    const value = event.snapshot;
    // Copy the navigation allowlist only; review facts and authority never enter history.
    const snapshot: StockNavigationSnapshot | null = value ? { version: value.version, scope: value.scope,
      controls: { query: value.controls.query, series: value.controls.series, body: value.controls.body, sort: value.controls.sort },
      limit: value.limit, selectedId: value.selectedId } : null;
    const signature = JSON.stringify(snapshot);
    if (signature === this.lastSnapshot) return;
    this.lastSnapshot = signature;
    const state = { ...record(this.location.getState()) };
    if (snapshot) state[historyKey] = snapshot;
    else delete state[historyKey];
    const path = this.location.path(true);
    if (event.replace) this.location.replaceState(path, '', state);
    else this.location.go(path, '', state);
  }

  backToChoices(): void { void this.router.navigateByUrl('/account'); }
  private onStockPath(): boolean { return this.location.path().split('?')[0] === this.routePath; }
}
