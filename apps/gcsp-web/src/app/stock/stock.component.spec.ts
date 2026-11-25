import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountClient } from '../account/account.client';
import { AuthPort, SessionState } from '../auth/auth.port';
import { StockComponent } from './stock.component';
import { StockDecision, StockFact, StockPayload, StockCar } from './stock.types';
import { StockNavigationSnapshot } from './stock.store';

const ready: SessionState = { status: 'ready', context: { subject: 'user-1', employeeId: 'employee-1', environmentId: 'test', runId: 'run-1',
  roles: ['employee'], policyVersion: 'policy-1', capabilities: [] } };
const fact = (value: StockFact['value'], assurance = 'confirmed-build'): StockFact => ({ value, status: value === null ? 'unknown' : 'known', unit: null,
  provenance: { sourceRef: 'source', version: 'facts-1', observedAt: '2026-11-05T12:00:00Z', assurance } });
function decision(id: number): StockDecision {
  const orderUuid = `stock-${id}`; const candidateKey = `fixture:exact-stock:${orderUuid}`;
  return { orderUuid, orderNumber: String(id).padStart(7, '0'), candidateKey, configurationId: 'shared-config', draftVersion: 2,
    gateStatus: id === 2 ? 'ineligible' : id === 3 ? 'needs-confirmation' : 'eligible', blockers: [], unknowns: [],
    snapshot: { identityKind: 'exact-stock', candidateKey, sourceNamespace: 'fixture', sourceKeys: { stockId: orderUuid }, snapshotVersion: `snapshot-${id}`,
      display: { name: `BMW car ${id}` }, facts: { series: fact('3 Series'), body: fact(id % 2 ? 'estate' : 'saloon'), exterior: fact('Blue'),
        equipment: fact([{ code: 'S0488', name: 'Lumbar support' }]), reference: fact('Reference only', 'model-reference'), other: fact(false, 'derived') } },
    terms: { kind: 'employee-scheme', termsVersion: `terms-${id}`, points: { value: id * 100, unit: 'points' }, allowanceInputs: { allowance: { value: 1000, unit: 'points' } }, contribution: null },
    versions: { brief: 2, facts: 'facts-1', policy: 'policy-1', stock: 'source-stock-1', clock: 'clock-1', snapshot: `snapshot-${id}`, terms: `terms-${id}`, availability: `availability-${id}` },
    claimInput: id === 2 || id === 3 ? null : { orderUuid, expectedStockVersion: id + 10, expectedDraftVersion: 2,
      expectedContextVersion: 'context-1', expectedTermsDigest: `opaque-${id}` } };
}
function stock(count = 8): StockPayload {
  const decisions = Array.from({ length: count }, (_, i) => decision(i + 1)); const cars = decisions.filter(car => car.gateStatus === 'eligible');
  return { state: count ? 'available-stock' : 'empty-stock', decisions, cars, total: cars.length, ranked: false, browsingReservesStock: false,
    versions: { brief: 2, facts: 'facts-1', policy: 'policy-1', stock: 'source-stock-1', clock: 'clock-1', draft: 2, context: 'context-1' } };
}
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); });
describe('released stock screen', () => {
  const auth = signal<SessionState>(ready); const client = { readStock: vi.fn() };
  beforeEach(() => {
    auth.set(ready); client.readStock.mockReset().mockResolvedValue({ status: 'ok', value: stock() });
    Object.defineProperty(window, 'innerWidth', { value: 1440, writable: true, configurable: true });
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state: auth } }, { provide: AccountClient, useValue: client }] });
  });
  async function screen(navigation: unknown = null) {
    const fixture = TestBed.createComponent(StockComponent); fixture.componentRef.setInput('navigation', navigation);
    const root = fixture.nativeElement as HTMLElement; document.body.append(root); cleanups.push(() => { fixture.destroy(); root.remove(); });
    await fixture.whenStable(); fixture.detectChanges(); return { fixture, root, component: fixture.componentInstance };
  }
  const buttons = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
  const button = (root: HTMLElement, text: string) => buttons(root).find(b => b.textContent?.trim() === text)!;

  it('renders all released decisions as distinct exact cards and keeps counted options/allowance authoritative', async () => {
    const { root, component } = await screen();
    expect(root.querySelectorAll('gcsp-vehicle-card')).toHaveLength(6); expect(component.store.allCars()).toHaveLength(8);
    expect(root.textContent).toContain('8 released cars · 6 eligible · 8 matching · 6 eligible matching');
    expect(root.textContent).toContain('Your allowance: 1,000 points a month'); expect(root.textContent).toContain('No image for this car yet');
    expect(new Set(component.store.allCars().map(car => car.identity.configurationId)).size).toBe(1);
    expect(root.querySelector('[data-member-id="stock-2"]')?.textContent).toContain('Not eligible');
    expect(root.querySelector<HTMLButtonElement>('[data-member-id="stock-3"] .vm-card-actions button')?.disabled).toBe(true);
  });
  it('restores the held-offer action and car-taken refresh notice above the retained cards', async () => {
    client.readStock.mockResolvedValue({ status: 'ok', value: { ...stock(), heldOffer: { offerId: 'offer/1', runId: 'run-1' } } });
    const { root, fixture, component } = await screen(); const view = vi.fn(); component.viewOffer.subscribe(view);
    expect(button(root, 'View your offer').closest('div[gcspStatusScreen].vm-screen.vm-status')).not.toBeNull();
    expect(button(root, 'View your offer').classList.contains('vm-btn-primary')).toBe(true);
    button(root, 'View your offer').click(); expect(view).toHaveBeenCalledExactlyOnceWith('offer/1');
    expect(root.querySelectorAll('gcsp-vehicle-card')).toHaveLength(6);
    fixture.componentRef.setInput('reservation', { state: 'failed', blocked: false, selection: null, claim: null, failure: 'car-taken', refresh: 0 });
    fixture.detectChanges(); expect(root.textContent).toContain('This car is no longer available');
    expect(button(root, 'Refresh availability').closest('div[gcspStatusScreen].vm-screen.vm-status')).not.toBeNull();
    expect(button(root, 'Refresh availability').classList.contains('vm-btn-ghost')).toBe(true);
    expect(root.querySelectorAll('gcsp-vehicle-card')).toHaveLength(6);
    const refreshed = vi.fn(); component.availabilityRefresh.subscribe(refreshed);
    button(root, 'Refresh availability').click(); await fixture.whenStable(); expect(client.readStock).toHaveBeenCalledTimes(2); expect(refreshed).toHaveBeenCalledOnce();
  });
  it('exposes only deliberate status/retry actions and blocks back while reservation custody is unresolved', async () => {
    const { root, fixture, component } = await screen(); const check = vi.fn(); const retry = vi.fn(); const back = vi.fn();
    component.checkReservation.subscribe(check); component.retryReservation.subscribe(retry); component.back.subscribe(back);
    fixture.componentRef.setInput('reservation', { state: 'retry-available', blocked: true, selection: null, claim: null, failure: null, refresh: 0 });
    fixture.detectChanges(); button(root, 'Check status').click(); button(root, 'Retry this reservation').click();
    expect(check).toHaveBeenCalledOnce(); expect(retry).toHaveBeenCalledOnce();
    button(root, 'Back to your choices').click(); expect(back).not.toHaveBeenCalled();
    expect(root.querySelector('.gcsp-stock.vm.gcsp-gallery-body')).not.toBeNull();
  });
  it('filters through existing store from native search/sort and shows a clear-filter recovery', async () => {
    const { root, fixture, component } = await screen(); const search = root.querySelector<HTMLInputElement>('#stock-query')!;
    search.value = 'missing model'; search.dispatchEvent(new Event('input', { bubbles: true })); fixture.detectChanges();
    expect(root.textContent).toContain('No cars match these filters'); expect(root.querySelectorAll('gcsp-vehicle-card')).toHaveLength(0);
    button(root, 'Clear filters').click(); fixture.detectChanges(); expect(component.store.controls().query).toBe('');
    const sort = root.querySelector<HTMLSelectElement>('#stock-sort')!; sort.value = 'points'; sort.dispatchEvent(new Event('change')); fixture.detectChanges();
    expect(component.store.controls().sort).toBe('points'); expect(root.querySelector('[data-member-id]')?.getAttribute('data-member-id')).toBe('stock-1');
  });
  it('opens in-page exact details and source evidence then returns to the same detail action', async () => {
    const { root, fixture, component } = await screen(); const origin = root.querySelector<HTMLButtonElement>('[data-details-id="stock-2"]')!;
    origin.focus(); origin.click(); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(root.querySelectorAll('gcsp-vehicle-card')).toHaveLength(0); expect(component.store.selectedId()).toBe('stock-2');
    expect(root.querySelector('[data-detail-heading]')?.textContent).toBe('BMW car 2'); expect(document.activeElement).toBe(root.querySelector('[data-detail-heading]'));
    expect(root.textContent).toContain('Order no. 0000002'); expect(root.textContent).toContain('Reference only'); expect(root.textContent).toContain('Lumbar support');
    expect(Array.from(root.querySelectorAll('summary')).map(x => x.textContent)).toContain('Model reference facts');
    button(root, 'Back to released cars').click(); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement?.getAttribute('data-details-id')).toBe('stock-2'); expect(component.store.pageCars()).toHaveLength(6);
  });
  it('pages six or three with focus on first added card and preserves expansion on resize', async () => {
    window.innerWidth = 375; const { root, fixture, component } = await screen();
    expect(root.querySelectorAll('gcsp-vehicle-card')).toHaveLength(3);
    button(root, 'Show more cars').click(); fixture.detectChanges(); await fixture.whenStable();
    expect(root.querySelectorAll('gcsp-vehicle-card')).toHaveLength(6); expect(document.activeElement?.getAttribute('data-member-id')).toBe('stock-4');
    window.innerWidth = 1440; window.dispatchEvent(new Event('resize')); fixture.detectChanges(); expect(component.store.limit()).toBe(6);
    button(root, 'Show more cars').click(); fixture.detectChanges(); expect(root.querySelectorAll('gcsp-vehicle-card')).toHaveLength(8);
  });
  it('emits the source-issued exact review descriptor, never a same-configuration substitute', async () => {
    const { root, component, fixture } = await screen(); const events: StockCar['review'][] = []; component.review.subscribe(event => events.push(event));
    button(root.querySelector<HTMLElement>('[data-member-id="stock-1"]')!, 'Review this car').click();
    component.activate({ memberId: 'stock-2', action: 'review' }); expect(events).toHaveLength(1);
    expect(events[0]).toBe(component.store.allCars()[0].review); expect(events[0].claimInput?.expectedTermsDigest).toBe('opaque-1');
    component.activate({ memberId: 'stock-4', action: 'details' }); fixture.detectChanges(); component.reviewDetail(); expect(events[1].orderUuid).toBe('stock-4');
  });
  it('honours host review unavailability for card/detail DOM and direct methods while keeping standalone defaults', async () => {
    const { root, fixture, component } = await screen(); const emitted: StockCar['review'][] = [];
    component.review.subscribe(event => emitted.push(event));
    fixture.componentRef.setInput('reviewUnavailableReason', 'Reviewing a car is currently unavailable.'); fixture.detectChanges();
    expect(button(root.querySelector<HTMLElement>('[data-member-id="stock-1"]')!, 'Review this car').disabled).toBe(true);
    component.activate({ memberId: 'stock-1', action: 'review' }); component.activate({ memberId: 'stock-1', action: 'details' }); fixture.detectChanges();
    expect(button(root, 'Review this car').disabled).toBe(true); expect(root.textContent).toContain('Reviewing a car is currently unavailable.'); component.reviewDetail(); expect(emitted).toEqual([]);
    fixture.componentRef.setInput('reviewUnavailableReason', null); fixture.detectChanges(); expect(button(root, 'Review this car').disabled).toBe(false);
    component.reviewDetail(); expect(emitted[0]).toBe(component.store.selectedCar()!.review);
  });
  it('restores scoped filter/page/exact detail snapshots and emits only navigation facts', async () => {
    const { root, component, fixture } = await screen(); const events: { snapshot: StockNavigationSnapshot | null; replace: boolean }[] = [];
    component.navigationChange.subscribe(event => events.push(event)); component.showMore(); fixture.detectChanges();
    component.activate({ memberId: 'stock-8', action: 'details' }); fixture.detectChanges(); const snapshot = component.store.navigationSnapshot()!;
    expect(Object.keys(snapshot).sort()).toEqual(['controls', 'limit', 'scope', 'selectedId', 'version']);
    component.closeDetail(); fixture.detectChanges(); fixture.componentRef.setInput('navigation', structuredClone(snapshot)); await fixture.whenStable(); fixture.detectChanges();
    expect(root.querySelector('[data-detail-heading]')?.textContent).toBe('BMW car 8'); expect(component.store.limit()).toBe(12);
    expect(events.some(event => !event.replace && event.snapshot?.selectedId === 'stock-8')).toBe(true);
    fixture.componentRef.setInput('navigation', { ...snapshot, scope: 'another-user' }); await fixture.whenStable(); expect(component.store.selectedId()).toBe('stock-8');
  });
  it.each(['rendered', 'missing', 'filtered'] as const)('returns focus for a different restored exact detail: %s', async outcome => {
    const { root, component, fixture } = await screen();
    button(root.querySelector<HTMLElement>('[data-member-id="stock-1"]')!, 'Vehicle details').click();
    fixture.detectChanges(); await fixture.whenStable();
    button(root, 'Back to released cars').click(); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement?.getAttribute('data-details-id')).toBe('stock-1');
    const selectedId = outcome === 'missing' ? 'stock-missing' : 'stock-2';
    const snapshot = component.store.navigationSnapshot()!;
    fixture.componentRef.setInput('navigation', { ...snapshot, selectedId,
      controls: { ...snapshot.controls, query: outcome === 'filtered' ? 'BMW car 1' : '' } });
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(component.store.selectedId()).toBe(selectedId);
    expect(root.querySelector('[aria-label="Selected vehicle"]')?.textContent)
      .toContain(outcome === 'missing' ? 'This car is no longer available' : 'BMW car 2');
    button(root, 'Back to released cars').click(); fixture.detectChanges(); await fixture.whenStable();
    const target = outcome === 'rendered' ? root.querySelector('[data-details-id="stock-2"]') : root.querySelector('#stock-query');
    expect(target).not.toBeNull(); expect(document.activeElement).toBe(target);
    expect(document.activeElement?.getAttribute('data-details-id')).not.toBe('stock-1');
    expect(component.store.selectedId()).toBeNull();
  });
  it('hides stale facts during reload and keeps missing exact selection unavailable without substitution', async () => {
    const { root, component, fixture } = await screen(); component.activate({ memberId: 'stock-1', action: 'details' }); fixture.detectChanges();
    let resolve!: (value: unknown) => void; client.readStock.mockReturnValueOnce(new Promise(done => resolve = done));
    const load = component.reload(); fixture.detectChanges(); expect(root.textContent).toContain('Refreshing this car'); expect(root.textContent).not.toContain('BMW car 1');
    resolve({ status: 'ok', value: stock(0) }); await load; fixture.detectChanges();
    expect(root.textContent).toContain('This car is no longer available'); expect(component.store.selectedId()).toBe('stock-1'); expect(component.store.selectedCar()).toBeNull();
  });
  it.each([
    [{ status: 'unavailable', retryable: true }, 'Stock is unavailable', 'Refresh availability'],
    [{ status: 'forbidden' }, 'Released stock is not available to this account', null],
    [{ status: 'unauthenticated' }, 'Sign in to browse released cars', null],
    [{ status: 'authentication-required' }, 'Sign in to browse released cars', null],
    [{ status: 'invalid' }, 'Check your choices', 'Back to your choices'],
  ])('keeps selected-detail failure and recovery authoritative for %j', async (failure, title, action) => {
    const { root, component, fixture } = await screen();
    component.activate({ memberId: 'stock-1', action: 'details' }); fixture.detectChanges();
    client.readStock.mockResolvedValueOnce(failure); await component.reload(); fixture.detectChanges();
    const detail = root.querySelector<HTMLElement>('[aria-label="Selected vehicle"]')!;
    expect(detail.textContent).toContain(title);
    expect(detail.textContent).not.toContain('This car is no longer available');
    expect(detail.textContent).not.toContain('BMW car 1');
    expect(component.store.selectedId()).toBe('stock-1'); expect(component.store.selectedSource()).toBeNull();
    expect(buttons(detail).map(node => node.textContent?.trim())).toEqual(['Back to released cars', ...(action ? [action] : [])]);
    expect(client.readStock).toHaveBeenCalledTimes(2);
    // The next authoritative response restores only this exact selection, never a sibling configuration.
    await component.reload(); fixture.detectChanges();
    expect(component.store.selectedId()).toBe('stock-1'); expect(root.querySelector('[data-detail-heading]')?.textContent).toBe('BMW car 1');
  });
  it('retries a selected source failure through loading and honours a confirmed taken response', async () => {
    const { root, component, fixture } = await screen(); component.activate({ memberId: 'stock-1', action: 'details' }); fixture.detectChanges();
    client.readStock.mockResolvedValueOnce({ status: 'unavailable' }); await component.reload(); fixture.detectChanges();
    let resolve!: (value: unknown) => void; client.readStock.mockReturnValueOnce(new Promise(done => resolve = done));
    button(root, 'Refresh availability').click(); fixture.detectChanges();
    expect(root.textContent).toContain('Refreshing this car'); expect(component.store.selectedId()).toBe('stock-1');
    resolve({ status: 'conflict', view: { state: 'car-taken' } }); await fixture.whenStable(); fixture.detectChanges();
    expect(root.textContent).toContain('This car is no longer available'); expect(component.store.selectedId()).toBe('stock-1');
    expect(component.store.selectedSource()).toBeNull(); expect(button(root, 'Refresh availability')).toBeDefined();
  });
  it.each([
    [{ status: 'unavailable', retryable: true }, 'Stock is unavailable'],
    [{ status: 'stale-run' }, 'Your choices or stock have changed'],
    [{ status: 'invalid' }, 'Check your choices'],
    [{ status: 'ok', value: stock(0) }, 'No released stock'],
  ])('renders source/empty outcomes truthfully: %s', async (envelope, title) => {
    client.readStock.mockResolvedValue(envelope); const { root } = await screen(); expect(root.textContent).toContain(title); expect(root.querySelectorAll('gcsp-vehicle-card')).toHaveLength(0);
  });
  it('preserves the source primary image and keeps filters available while exact details are open', async () => {
    const source = stock(2); const first = source.decisions[0];
    const primary = '/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp';
    const changed = { ...first, snapshot: { ...first.snapshot, display: { ...first.snapshot.display, photo: primary,
      images: [{ src: '/assets/gcsp-vehicle-evidence/01af2978ba13fd99e11d6477eb706e0648f67d5602bc72e8e20217908b235748.webp', alt: 'Other' }, { src: primary, alt: 'Exact primary' }] } } };
    client.readStock.mockResolvedValue({ status: 'ok', value: { ...source, decisions: [changed, source.decisions[1]], cars: [changed] } });
    const { root, fixture, component } = await screen();
    expect(root.querySelector('.vm-card-photo')?.getAttribute('alt')).toBe('Exact primary');
    component.activate({ memberId: 'stock-1', action: 'details' }); fixture.detectChanges();
    const search = root.querySelector<HTMLInputElement>('#stock-query')!; search.value = 'No matches'; search.dispatchEvent(new Event('input')); fixture.detectChanges();
    expect(component.store.selectedId()).toBe('stock-1'); expect(root.querySelector('[data-detail-heading]')?.textContent).toBe('BMW car 1');
  });
  it('suppresses private cards and detail immediately on account/run change and aborts on teardown', async () => {
    const { root, component, fixture } = await screen(); component.activate({ memberId: 'stock-1', action: 'details' }); fixture.detectChanges();
    auth.set({ status: 'denied', message: 'No access' }); fixture.detectChanges(); expect(root.textContent).not.toContain('BMW car 1');
    expect(root.textContent).toContain('Released stock is not available to this account');
    const options = client.readStock.mock.calls[0][0]; fixture.destroy(); expect(options.signal.aborted).toBe(true);
  });
});
