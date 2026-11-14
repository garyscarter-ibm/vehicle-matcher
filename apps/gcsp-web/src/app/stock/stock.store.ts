import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AccountClient } from '../account/account.client';
import { AuthPort } from '../auth/auth.port';
import { projectStock } from './stock.projection';
import { StockCar, StockData, StockProjection } from './stock.types';

export const STOCK_SORTS = ['name', 'points', 'earliest-collection'] as const;
export type StockSort = typeof STOCK_SORTS[number];
export interface StockControls { readonly query: string; readonly series: string; readonly body: string; readonly sort: StockSort }
export interface StockNavigationSnapshot {
  readonly version: 1; readonly scope: string; readonly controls: StockControls;
  readonly limit: number; readonly selectedId: string | null;
}
const defaults = (): StockControls => ({ query: '', series: '', body: '', sort: 'name' });
const compare = (a: unknown, b: unknown): number => String(a).localeCompare(String(b), 'en-GB', { numeric: true, sensitivity: 'base' });
const optionalCompare = (a: string | number | null, b: string | number | null): number => a === null ? b === null ? 0 : 1
  : b === null ? -1 : typeof a === 'number' && typeof b === 'number' ? a - b : compare(a, b);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, maximum = 2048): value is string => typeof value === 'string' && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value);
const only = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function validControls(value: unknown): value is StockControls {
  return object(value) && only(value, ['query', 'series', 'body', 'sort']) && text(value['query']) && text(value['series'])
    && text(value['body']) && STOCK_SORTS.includes(value['sort'] as StockSort);
}
function equipmentText(value: StockData): string {
  return Array.isArray(value) ? value.map(equipmentText).join(' ') : object(value)
    ? Object.entries(value).map(([key, part]) => `${key} ${equipmentText(part as StockData)}`).join(' ') : String(value ?? '');
}
function searchable(car: StockCar): string {
  const parts: unknown[] = [car.name, car.identity.orderNumber, ...Object.values(car.fields).map((field) => field.value),
    car.detail.equipment?.status === 'known' ? equipmentText(car.detail.equipment.value) : null];
  return parts.flat(Infinity).map((part) => object(part) ? [part['name'], part['description'], part['code']].filter(Boolean).join(' ')
    : part ?? '').join(' ').toLocaleLowerCase('en-GB');
}
function sortValue(car: StockCar, sort: StockSort): string | number | null {
  if (sort === 'points') return car.cost.value;
  if (sort === 'earliest-collection') {
    const date = car.fields['earliestCollection'].value;
    return typeof date === 'string' && Number.isFinite(Date.parse(date)) ? Date.parse(date) : null;
  }
  return car.detail.snapshot.display.name ?? null;
}
const options = (cars: readonly StockCar[], read: (car: StockCar) => StockData): string[] => [...new Set(cars.map(read)
  .filter((value): value is string => typeof value === 'string' && !!value.trim()))].sort(compare);

@Injectable({ providedIn: 'root' })
export class StockStore {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(AccountClient);
  readonly scope = computed(() => {
    const auth = this.auth.state();
    return auth.status === 'ready' && auth.context.roles.includes('employee') && auth.context.employeeId
      ? JSON.stringify([auth.context.subject, auth.context.environmentId, auth.context.runId, auth.context.employeeId]) : null;
  });
  private readonly destroyed = signal(false);
  private readonly owner = signal<string | null>(null);
  private readonly resource = signal<StockProjection | null>(null);
  private readonly busy = signal(false);
  private readonly controlValue = signal<StockControls>(defaults());
  private readonly selection = signal<string | null>(null);
  private readonly limitValue = signal(6);
  private readonly narrow = signal(false);
  private readonly owned = computed(() => !this.destroyed() && !!this.scope() && this.owner() === this.scope());
  readonly projection = computed(() => this.owned() ? this.resource() : null);
  readonly loading = computed(() => this.owned() && this.busy());
  readonly controls = computed(() => this.owned() ? this.controlValue() : defaults());
  readonly allCars = computed(() => this.projection()?.allCars ?? []);
  readonly cars = computed(() => {
    const controls = this.controls(); const query = controls.query.trim().toLocaleLowerCase('en-GB');
    return this.allCars().filter((car) => (!query || searchable(car).includes(query))
      && (!controls.series || car.series.value === controls.series) && (!controls.body || car.fields['body'].value === controls.body))
      .sort((a, b) => optionalCompare(sortValue(a, controls.sort), sortValue(b, controls.sort))
        || compare(a.identity.orderNumber, b.identity.orderNumber) || compare(a.id, b.id));
  });
  readonly counts = computed(() => ({ records: this.allCars().length, eligible: this.projection()?.counts.eligible ?? 0,
    visible: this.cars().length, visibleEligible: this.cars().filter((car) => car.gateStatus === 'eligible').length }));
  readonly series = computed(() => options(this.allCars(), (car) => car.series.value));
  readonly bodies = computed(() => options(this.allCars(), (car) => car.fields['body'].value));
  readonly releaseHistory = computed(() => this.projection()?.releaseHistory ?? null);
  readonly failure = computed(() => this.projection()?.failure ?? null);
  readonly pageSize = computed(() => this.narrow() ? 3 : 6);
  readonly limit = computed(() => this.owned() ? this.limitValue() : this.pageSize());
  readonly pageCars = computed(() => this.cars().slice(0, this.limit()));
  readonly hasMore = computed(() => this.cars().length > this.pageCars().length);
  readonly selectedId = computed(() => this.owned() ? this.selection() : null);
  readonly selectedCar = computed(() => this.allCars().find((car) => car.id === this.selectedId()) ?? null);
  readonly detail = computed(() => this.selectedCar()?.detail ?? null);
  readonly selectedSource = computed(() => this.selectedCar()?.review ?? null);
  readonly state = computed(() => {
    if (this.destroyed()) return 'idle';
    const auth = this.auth.state();
    if (auth.status === 'denied' || auth.status === 'ready' && !this.scope()) return 'denied';
    if (auth.status === 'signed-out') return 'authentication-required';
    if (auth.status === 'unavailable') return 'authentication-unavailable';
    if (auth.status === 'loading' || this.loading() || !this.owned()) return 'loading';
    const projection = this.projection(); const status = projection?.failure?.['status'];
    if (status === 'forbidden') return 'denied';
    if (status === 'unauthenticated' || status === 'authentication-required') return 'authentication-required';
    if (!projection) return 'idle';
    return this.allCars().length && !this.cars().length ? 'empty-search' : projection.state;
  });
  readonly detailState = computed(() => !this.selectedId() ? 'closed' : this.loading() ? 'loading' : this.selectedCar() ? 'available'
    : this.state() === 'context-refresh' ? 'stale' : 'unavailable');
  private controller = new AbortController();
  private epoch = 0;
  private loadPromise: Promise<void> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => { this.destroyed.set(true); this.reset(); });
    effect(() => { const scope = this.scope(); untracked(() => { this.reset(); if (scope && !this.destroyed()) void this.load(); }); });
  }
  private reset(): void {
    this.epoch++; this.controller.abort(); this.controller = new AbortController(); this.loadPromise = null;
    this.owner.set(null); this.resource.set(null); this.busy.set(false); this.controlValue.set(defaults());
    this.selection.set(null); this.limitValue.set(this.pageSize());
  }
  load(): Promise<void> {
    const scope = this.scope(); if (!scope || this.destroyed()) return Promise.resolve();
    if (this.owner() !== scope) { this.reset(); this.owner.set(scope); }
    if (this.loadPromise) return this.loadPromise;
    if (this.resource()) return Promise.resolve();
    const epoch = this.epoch; this.busy.set(true);
    const operation = (async () => {
      let result: unknown;
      try { result = await this.client.readStock({ signal: this.controller.signal }); }
      catch { result = { status: 'unavailable', code: 'stock-read-failed', retryable: true }; }
      if (this.destroyed() || epoch !== this.epoch || scope !== this.scope()) return;
      this.resource.set(projectStock(result)); this.busy.set(false);
    })();
    this.loadPromise = operation;
    void operation.finally(() => { if (epoch === this.epoch) this.loadPromise = null; });
    return operation;
  }
  reload(): Promise<void> {
    if (!this.owned()) return this.load();
    this.epoch++; this.controller.abort(); this.controller = new AbortController(); this.loadPromise = null;
    this.resource.set(null); this.limitValue.set(this.pageSize()); return this.load();
  }
  setControls(patch: Partial<StockControls>): void {
    if (!this.owned() || !object(patch) || Object.keys(patch).some((key) => !['query', 'series', 'body', 'sort'].includes(key))) return;
    const next = { ...this.controlValue(), ...patch };
    if (!validControls(next) || JSON.stringify(next) === JSON.stringify(this.controlValue())) return;
    this.controlValue.set(next); this.limitValue.set(this.pageSize());
  }
  setViewportWidth(width: number): void {
    if (this.destroyed() || !Number.isFinite(width) || width <= 0) return;
    this.narrow.set(width <= 600); this.limitValue.update((limit) => Math.max(limit, this.pageSize()));
  }
  showMore(): void { if (this.owned() && this.hasMore()) this.limitValue.update((limit) => Math.min(Number.MAX_SAFE_INTEGER, limit + this.pageSize())); }
  openDetail(orderUuid: string): void { if (this.owned() && text(orderUuid) && orderUuid.trim()) this.selection.set(orderUuid); }
  closeDetail(): void { if (this.owned()) this.selection.set(null); }
  navigationSnapshot(): StockNavigationSnapshot | null {
    return this.owned() ? { version: 1, scope: this.scope()!, controls: { ...this.controls() }, limit: this.limit(), selectedId: this.selectedId() } : null;
  }
  restoreNavigation(value: unknown): boolean {
    if (!this.owned() || !object(value) || !only(value, ['version', 'scope', 'controls', 'limit', 'selectedId'])
      || value['version'] !== 1 || value['scope'] !== this.scope() || !validControls(value['controls'])
      || !Number.isSafeInteger(value['limit']) || (value['limit'] as number) < 1
      || !(value['selectedId'] === null || text(value['selectedId']) && !!value['selectedId'].trim())) return false;
    this.controlValue.set({ ...value['controls'] }); this.limitValue.set(Math.max(this.pageSize(), value['limit'] as number));
    this.selection.set(value['selectedId'] as string | null); return true;
  }
}
