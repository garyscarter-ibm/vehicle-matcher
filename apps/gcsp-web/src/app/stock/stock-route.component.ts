import { Location } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ManualStore } from '../manual/manual.store';
import { StockComponent } from './stock.component';
import { StockNavigationSnapshot } from './stock.store';
import type { StockCar } from './stock.types';

const historyKey = 'gcspStock';
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};

@Component({
  selector: 'gcsp-stock-route',
  imports: [StockComponent],
  template: `<gcsp-stock [navigation]="navigation()" (navigationChange)="saveNavigation($event)"
    [reviewUnavailableReason]="openingReview() ? 'Checking your selection before review.' : null"
    (review)="reviewSelection($event)" (back)="backToChoices()" />`,
})
export class StockRouteComponent {
  private readonly location = inject(Location);
  private readonly router = inject(Router);
  private readonly manual = inject(ManualStore);
  readonly openingReview = signal(false);
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

  async reviewSelection(selection: StockCar['review']): Promise<void> {
    if (this.disposed || this.openingReview()) return;
    this.openingReview.set(true);
    try {
      await this.manual.enter(selection);
      if (!this.disposed) await this.router.navigateByUrl('/manual/review');
    } finally { this.openingReview.set(false); }
  }
  backToChoices(): void { void this.router.navigateByUrl('/account'); }
  private onStockPath(): boolean { return this.location.path().split('?')[0] === this.routePath; }
}
