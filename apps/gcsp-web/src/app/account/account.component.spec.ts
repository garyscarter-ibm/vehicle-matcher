import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { BriefEditorStore } from '../preferences/brief-editor.store';
import { BriefClient } from '../preferences/brief.client';
import { briefEditorFixture } from '../preferences/brief.fixtures';
import { ActivityClient } from '../activity/activity.client';
import { ActivityProjection, ActivityResult } from '../activity/activity.types';
import { AccountClient } from './account.client';
import { AccountComponent } from './account.component';
import { AccountBuddyComponent } from './account-buddy.component';
import { accountSnapshot, savedDraft } from './account.test-data';
import { AccountOrder, AccountOrdersCollection, AccountOrdersReadResult, AccountOrderSnapshot } from './account.preview';
import { AccountProjection, AccountResult, ManualDraft } from './account.types';

const ready = (employeeId = 'employee-paula'): SessionState => ({ status: 'ready', context: { subject: `subject-${employeeId}`, employeeId, environmentId: 'isolated', runId: 'run', roles: ['employee'], policyVersion: 'policy', capabilities: ['account:read'] } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const orderCollection = (orders: readonly AccountOrder[] = []): AccountOrdersCollection => ({ orders, failed: [], failedCount: 0, nextAfter: null, pageEvidence: [] });
const listed = (orders: readonly AccountOrder[] = []): AccountOrdersReadResult => ({ status: 'ok', value: orderCollection(orders) });
const flatSelection = (status = 'pending'): AccountOrderSnapshot => ({ status, operationId: 'private-operation', selection: { orderUuid: 'manual-selection', configurationId: 'not-an-order-id', orderNumber: null }, progress: { selectionState: status === 'refused' ? 'handoff-failed' : status === 'acknowledged' ? 'acknowledged' : 'handoff-pending' } });

describe('native employee account screen', () => {
  let fixture: ComponentFixture<AccountComponent>;
  let auth: { state: ReturnType<typeof signal<SessionState>>; recovery: ReturnType<typeof signal<null>>; signIn: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
  let client: { [key in 'readOffers' | 'readOrders' | 'readOrder' | 'readAccount' | 'readDraft' | 'readNotificationEmail' | 'saveNotificationEmail' | 'startJourney' | 'discardDraft']: ReturnType<typeof vi.fn> };
  let account: AccountProjection;
  beforeEach(() => {
    account = accountSnapshot();
    auth = { state: signal(ready()), recovery: signal(null), signIn: vi.fn(), retry: vi.fn() };
    client = { readOffers: vi.fn().mockResolvedValue({ status: 'ok', value: { offers: [] } }), readOrders: vi.fn().mockResolvedValue({ status: 'ok', value: { failed: [], failedCount: 0, nextAfter: null, pageEvidence: [], orders: [] } }), readOrder: vi.fn().mockResolvedValue({ status: 'not-found' }), readAccount: vi.fn().mockResolvedValue({ status: 'ok', value: account }), readDraft: vi.fn().mockResolvedValue({ status: 'not-found' }),
      readNotificationEmail: vi.fn().mockResolvedValue({ status: 'ok', value: { deliveryEmail: 'saved@example.test', version: 4 } }),
      saveNotificationEmail: vi.fn().mockResolvedValue({ status: 'ok', value: { deliveryEmail: 'canonical@example.test', version: 5 } }),
      startJourney: vi.fn().mockResolvedValue({ status: 'ok', value: savedDraft() }), discardDraft: vi.fn().mockResolvedValue({ status: 'ok', value: { discarded: true, draftVersion: 4 } }) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthPort, useValue: auth }, { provide: AccountClient, useValue: client }, { provide: ActivityClient, useValue: { readActivity: vi.fn().mockResolvedValue({ status: 'unavailable' }) } },
      { provide: BriefClient, useValue: { readEditor: vi.fn().mockResolvedValue({ status: 'unavailable' }) } }] });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  });
  afterEach(() => { fixture?.destroy(); vi.restoreAllMocks(); });
  const mount = async () => { fixture = TestBed.createComponent(AccountComponent); document.body.append(fixture.nativeElement); fixture.detectChanges(); await settle(); return fixture.componentInstance; };
  const root = (): HTMLElement => fixture.nativeElement;
  const text = () => root().textContent ?? '';
  const button = (label: string): HTMLButtonElement => Array.from(root().querySelectorAll('button')).find((item) => item.textContent?.trim() === label && item.closest('dialog')?.open !== false)!;
  const settle = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); await fixture.whenStable(); fixture.detectChanges(); };
  const readyBuddy = () => {
    const value: ActivityProjection = { runId: 'run', employeeId: 'employee-paula', asOf: '2026-11-22T10:00:00Z', clockVersion: '1', briefVersion: 4,
      permission: { searchConsent: true, holdConsent: true, paused: false, permissionVersion: 3, canSearch: true, canHold: true }, state: 'offer', sourceStatus: 'ok',
      lastSuccessfulCheck: { checkedAt: '2026-11-22T09:30:00Z', carsChecked: 3, suitableCars: 1, exclusions: [], outcome: 'offer-held' },
      searchEvidence: { status: 'recorded', checks: 1 }, currentOffer: { offerRef: { offerId: 'offer-one' }, state: 'active', displayState: 'active', version: 2, briefVersion: 4, expiresAt: '2026-11-23T12:00:00Z', href: '/gcsp/offers/offer-one' },
      offers: [], stateChanges: [], stateChangesEvidence: { status: 'recorded', rejectedReceipts: 0 } };
    const activity = TestBed.inject(ActivityClient);
    activity.readActivity = vi.fn().mockResolvedValue({ status: 'ok', value });
    activity.readOfferDisplay = vi.fn().mockResolvedValue({ status: 'ok', value: { offerRef: { offerId: 'offer-one' }, state: 'active', version: 2, title: 'BMW i4', images: [] } });
    const base = briefEditorFixture(); const editor = { ...base, initial: { ...base.initial, buddy: { ...base.initial.buddy, state: 'engaged' as const, reason: null, permissionVersion: 3, considered: 2, remaining: 0 }, consent: { search: true, hold: true } } };
    TestBed.inject(BriefClient).readEditor = vi.fn().mockResolvedValue({ status: 'ok', value: editor });
    return { activity, value };
  };

  it('retains populated current car, identity, drivers, supplied labels and scheme history in approved order', async () => {
    const component = await mount();
    expect(root().querySelector('h1')?.textContent).toBe('Your cars');
    expect(root().querySelector('.gcsp-feature .gcsp-vehicle-title')?.textContent).toBe('BMW 3 Series Touring 320i');
    expect(text()).toContain('1,100 / 1,300'); expect(text()).toContain('Contract ends in 26 days');
    expect(text()).toContain('Paula Mason'); expect(text()).toContain('Casey Ward'); expect(text()).toContain('WARD9900000CW9XX'); expect(text()).toContain('Car licence valid until 1 January 2030');
    expect(text()).toContain('E749057'); expect(text()).toContain('27 Ashdown Road, Bracknell, RG12 9ZZ'); expect(text()).toContain('BMW Choices');
    expect(text()).not.toContain('demo-bmw-fs-uk'); expect(text()).not.toContain('choices-fs-uk'); expect(text()).not.toContain('Synthetic monthly');
    expect(root().querySelector<HTMLAnchorElement>('.account-preferences a')?.getAttribute('href')).toBe('/preferences');
    const classes = Array.from(root().querySelector('.account-screen')!.children).map((node) => node.className);
    expect(classes.findIndex((name) => name === 'gcsp-feature')).toBeLessThan(classes.indexOf('gcsp-account-buddy-preferences'));
    expect(classes.indexOf('gcsp-account-buddy-preferences')).toBeLessThan(classes.indexOf('account-history gcsp-account-history'));
    expect(classes.indexOf('account-history gcsp-account-history')).toBeLessThan(classes.indexOf('account-details'));
    expect(component.projection()).toEqual(account);
  });
  it('ports source current-car media, two-column fact roles, title, fuel copy and countdown clock', async () => {
    const base = briefEditorFixture(); const editor = { ...base, initial: { ...base.initial, currentCarRating: { contractId: account.contracts![0].contractId, value: 4 } } };
    TestBed.inject(BriefClient).readEditor = vi.fn().mockResolvedValue({ status: 'ok', value: editor });
    await mount();
    const hero = root().querySelector('.gcsp-feature')!;
    expect(hero.querySelector('.gcsp-feature-copy.gcsp-vehicle-copy .gcsp-vehicle-heading .gcsp-vehicle-title')?.textContent).toBe('BMW 3 Series Touring 320i');
    expect(hero.querySelector('.gcsp-account-spec')?.textContent).toBe('M Sport Touring · Petrol');
    expect(hero.querySelectorAll('.vm-facts.gcsp-account-car-facts > .vm-fact')).toHaveLength(3);
    expect(hero.querySelector('.gcsp-countdown .gcsp-icon path')).not.toBeNull();
    expect(hero.querySelector('button.vm-btn.vm-btn-ghost')?.textContent).toBe('View car record');
    expect(hero.querySelector('button.vm-btn.vm-btn-primary')?.textContent).toBe('Choose a replacement');
    const pill = hero.querySelector('.gcsp-feature-media .vm-card-media.gcsp-media.gcsp-media-whole .gcsp-star-rating-pill');
    expect(pill).not.toBeNull(); expect(pill?.querySelector('input')?.getAttribute('aria-describedby')).toContain('-help');
    expect(hero.querySelector('.gcsp-feature-copy gcsp-current-car-rating')).toBeNull();
  });
  it.each([[0, 'ends today'], [1, 'ends in 1 day'], [-1, 'ended 1 day ago'], [-3, 'ended 3 days ago']] as const)('uses source countdown wording for %i remaining days', async (daysRemaining, phrase) => {
    const component = await mount(); const car = component.model()!.currentContracts[0];
    expect(component.countdown({ ...car, daysRemaining })).toBe(`Contract ${phrase} · 1 December 2026`);
    expect(component.countdown({ ...car, daysRemaining: null })).toBe('Contract end: Not supplied');
  });
  it('resolves packaged evidence photos under the actual GCSP base while preserving other accepted image URLs', async () => {
    const existing = document.querySelector('base'); const previous = existing?.getAttribute('href');
    const base = existing ?? document.createElement('base'); base.setAttribute('href', '/gcsp/'); if (!existing) document.head.append(base);
    try {
      const component = await mount(); const image = root().querySelector<HTMLImageElement>('.gcsp-feature img')!;
      expect(image.getAttribute('src')).toBe('assets/gcsp-vehicle-evidence/07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp');
      expect(new URL(image.src).pathname).toBe('/gcsp/assets/gcsp-vehicle-evidence/07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp');
      const car = component.model()!.currentContracts[0];
      for (const src of ['https://images.example.test/car.webp', '/images/car.webp', '/assets/gcsp-vehicle-evidence/other.webp']) {
        expect(component.image({ ...car, media: { src } })).toBe(src);
      }
      image.dispatchEvent(new Event('error')); await settle(); expect(root().querySelector('.gcsp-feature img')).toBeNull();
      expect(root().querySelector('.gcsp-feature .vm-card-soon')?.textContent).toBe('No image available for your car');
    } finally { if (!existing) base.remove(); else if (previous === null) base.removeAttribute('href'); else base.setAttribute('href', previous!); }
  });
  it('keeps zero/unknown terms distinct, omits unsupplied identity and recovers a broken image without inventing media', async () => {
    const car = { ...account.contracts![0], terms: { kind: 'points-monthly', value: 0, allowance: 0 }, registration: null, months: 0 };
    account = { ...account, contracts: [car], currentContract: car }; client.readAccount.mockResolvedValue({ status: 'ok', value: account });
    const component = await mount(); expect(text()).toContain('0 / 0'); expect(text()).not.toContain('Date of birth'); expect(text()).not.toContain('Registration');
    root().querySelector('img')!.dispatchEvent(new Event('error')); await settle();
    expect(root().querySelector('img')).toBeNull(); expect(text()).toContain('No image available for your car');
    expect(text()).toContain('BMW 3 Series Touring 320i');
    expect(component.terms({ ...component.model()!.currentContracts[0], terms: { kind: 'points-monthly', value: null, allowance: { status: 'unknown', value: 99 } } })).toBe('Not supplied');
    expect(component.terms({ ...component.model()!.currentContracts[0], terms: { kind: 'purchase-money', currency: 'GBP', value: 12500 } })).toBe('£12,500');
  });
  it('shows no current car/history and only the exact server new-order action', async () => {
    const action = { action: 'order' as const, enabled: true, oldContractId: null, slotId: 'empty', schemeId: 'scheme' };
    account = { ...account, contracts: [], currentContract: null, histories: [], actions: [action] }; client.readAccount.mockResolvedValue({ status: 'ok', value: account });
    client.startJourney.mockResolvedValue({ status: 'ok', value: savedDraft({ choices: { mode: 'new', oldContractId: null, slotId: 'empty', schemeId: 'scheme' } }) });
    const component = await mount(); expect(text()).toContain('No current car'); expect(text()).toContain('No order history.'); expect(button('Choose a replacement')).toBeUndefined();
    button('Start a new order').click(); await settle();
    expect(client.startJourney.mock.calls[0][0]).toMatchObject({ action, account }); expect(component.pendingIntent()).toEqual({ mode: 'new', oldContractId: null, slotId: 'empty', schemeId: 'scheme' });
    expect(text()).toContain('Review choices'); expect(root().querySelector('a[href="/stock"]')).toBeNull();
  });
  it('uses confirmed current-car relationships after handover and keeps delivered VIN separate', async () => {
    account = { ...account, currentCarRelationships: [{ currentCar: { kind: 'order', orderUuid: 'exact-stock', vin: 'DELIVEREDVIN' }, oldCar: { contractId: account.contracts![0].contractId, status: 'returned' }, newCar: { collectedAt: '2026-11-07T13:00:00.000Z' } }] };
    client.readAccount.mockResolvedValue({ status: 'ok', value: account }); await mount();
    expect(root().querySelector('.gcsp-feature')).toBeNull(); expect(text()).toContain('Your car has been handed over.'); expect(text()).toContain('DELIVEREDVIN'); expect(text()).not.toContain('No current car'); expect(text()).not.toContain('exact-stock'); expect(root().querySelector('a[href="/orders"]')).not.toBeNull();
  });
  it('lets the Buddy region own a pending offer while preserving the existing authoritative guard', async () => {
    client.readOffers.mockResolvedValue({ status: 'ok', value: { offers: [{ offerId: 'owned-offer', runId: 'run', state: 'pending' }] } });
    const component = await mount(); expect(component.pendingOffer()?.offerId).toBe('owned-offer');
    expect(root().querySelector('.offer-preview')).toBeNull(); expect(button('Choose a replacement')).toBeUndefined(); expect(component.canStart()).toBe(true);
    expect(root().querySelector('gcsp-account-buddy')).not.toBeNull(); expect(button('Try again')).toBeDefined();
  });
  it('hides Buddy during authoritative journey choices and restores the source current-car action while keeping offer identity', async () => {
    client.readOffers.mockResolvedValue({ status: 'ok', value: { offers: [{ offerId: 'owned-offer', runId: 'run', state: 'pending' }] } });
    client.readDraft.mockResolvedValue({ status: 'ok', value: savedDraft() }); const component = await mount();
    expect(root().querySelector('gcsp-account-buddy')).not.toBeNull(); expect(button('Choose a replacement')).toBeUndefined();
    button('Carry on').click(); await settle(); expect(component.pendingIntent()).toEqual(savedDraft().choices);
    expect(root().querySelector('gcsp-account-buddy')).toBeNull(); expect(button('Choose a replacement')).toBeDefined(); expect(root().querySelector('.offer-preview')).toBeNull(); expect(component.pendingOffer()?.offerId).toBe('owned-offer');
    await component.refresh(); await settle(); expect(root().querySelector('gcsp-account-buddy')).not.toBeNull(); expect(button('Choose a replacement')).toBeUndefined();
  });
  it('shows preview loading without blocking the working account or treating pending reads as empty', async () => {
    const offers = deferred<AccountResult<import('./account.preview').AccountOffers>>(); const orders = deferred<AccountOrdersReadResult>();
    client.readOffers.mockReturnValueOnce(offers.promise); client.readOrders.mockReturnValueOnce(orders.promise);
    await mount(); expect(text()).toContain('Reading your offers and orders'); expect(text()).toContain('Paula Mason'); expect(button('Choose a replacement').disabled).toBe(false); expect(text()).not.toContain('No orders to track.');
    offers.resolve({ status: 'ok', value: { offers: [] } }); orders.resolve({ status: 'ok', value: { failed: [], failedCount: 0, nextAfter: null, pageEvidence: [], orders: [] } }); await settle();
    expect(text()).not.toContain('Reading your offers and orders'); expect(text()).toContain('No orders to track.');
  });
  it.each(['not-found', 'unavailable', 'forbidden'] as const)('keeps order-list %s distinct from an absent independent manual selection and provides only truthful recovery', async (status) => {
    client.readOrders.mockResolvedValueOnce({ status }); const component = await mount();
    const previews = root().querySelector('.account-previews')!;
    expect(previews.textContent?.includes('Some offer or order details could not be read.')).toBe(status !== 'not-found');
    expect(component.previewFailed()).toBe(status !== 'not-found'); expect(text()).toContain('Paula Mason'); expect(client.startJourney).not.toHaveBeenCalled();
    if (status === 'not-found') { expect(button('Retry offers and orders')).toBeUndefined(); expect(text()).not.toContain('Your selection could not be read'); }
    else { button('Retry offers and orders').click(); await settle(); expect(component.previewFailed()).toBe(false); expect(previews.textContent).not.toContain('Some offer or order details'); expect(text()).toContain('No orders to track.'); }
  });
  it('keeps preview failures isolated, truthful and explicitly retryable while the account stays usable', async () => {
    client.readOffers.mockResolvedValueOnce({ status: 'unavailable' }); client.readOrders.mockResolvedValueOnce({ status: 'forbidden' });
    await mount(); expect(text()).toContain('Some offer or order details could not be read.'); expect(text()).not.toContain('No orders to track.');
    expect(text()).toContain('Paula Mason'); expect(button('Choose a replacement').disabled).toBe(false);
    button('Retry offers and orders').click(); await settle(); expect(text()).toContain('No orders to track.'); expect(text()).not.toContain('Some offer or order details'); expect(client.readAccount).toHaveBeenCalledTimes(1);
  });
  it.each([flatSelection(), null, undefined])('reads an independent pending manual selection with optional value %#', async (value) => {
    client.readOrder.mockResolvedValue({ status: 'pending', operationId: 'private-operation', ...(value === undefined ? {} : { value }) });
    const component = await mount();
    expect(client.readOrders).toHaveBeenCalledOnce(); expect(client.readOrder).toHaveBeenCalledOnce();
    expect(text()).toContain('Your selection is being sent on'); expect(text()).toContain('Do not choose again.');
    expect(text()).not.toContain('No orders to track.'); expect(text()).not.toContain('Some offer or order details could not be read.');
    expect(text()).not.toContain('private-operation'); expect(text()).not.toContain('manual-selection');
    expect(root().querySelector('.order-preview')).toBeNull(); expect(component.placedRecord()).toBeNull();
    expect(component.newestOrder()).toBeNull(); expect(component.model()?.primaryContract?.contractId).toBe(account.currentContract!.contractId);
    expect(button('Choose a replacement').disabled).toBe(false); expect(client.startJourney).not.toHaveBeenCalled();
    expect(root().querySelector('.account-previews')?.getAttribute('aria-live')).toBe('polite');
    expect(root().querySelector('.account-previews .gcsp-status')?.getAttribute('role')).toBeNull();
  });
  it('waits for the independent manual result before claiming an empty order list and preserves focus', async () => {
    const manual = deferred<AccountResult<AccountOrderSnapshot>>(); client.readOrder.mockReturnValueOnce(manual.promise);
    const component = await mount(); const action = button('Choose a replacement'); action.focus();
    expect(client.readOrder).toHaveBeenCalledOnce(); expect(text()).toContain('Reading your selection');
    expect(text()).not.toContain('No orders to track.'); expect(component.previewLoading()).toBe(true); expect(text()).toContain('Paula Mason');
    manual.resolve({ status: 'not-found' }); await settle();
    expect(text()).toContain('No orders to track.'); expect(text()).not.toContain('Reading your selection');
    expect(component.previewLoading()).toBe(false); expect(document.activeElement).toBe(action);
  });
  it('renders a completed manual handoff while the acknowledged list is still loading', async () => {
    const orders = deferred<AccountOrdersReadResult>(); client.readOrders.mockReturnValueOnce(orders.promise);
    client.readOrder.mockResolvedValue({ status: 'pending', value: flatSelection() });
    const component = await mount(); expect(component.previewLoading()).toBe(true); expect(text()).toContain('Your selection is being sent on');
    expect(text()).not.toContain('No orders to track.'); expect(button('Check for updates').disabled).toBe(true);
    orders.resolve(listed()); await settle(); expect(component.previewLoading()).toBe(false);
    expect(text()).toContain('Your selection is being sent on'); expect(text()).not.toContain('No orders to track.');
  });
  it('shows a settled refused snapshot as a handoff failure without inventing an order or current car', async () => {
    client.readOrder.mockResolvedValue({ status: 'ok', value: { ...flatSelection('refused'), failure: { reason: 'private-provider-detail' }, view: { state: 'handoff-failed', action: 'contact-support' } } });
    const component = await mount(); expect(text()).toContain('Your selection could not be sent');
    expect(root().querySelector('.account-previews a[href="/help"]')?.textContent).toBe('Contact support');
    expect(text()).not.toContain('No orders to track.'); expect(text()).not.toContain('private-provider-detail');
    expect(root().querySelector('.order-preview')).toBeNull(); expect(component.placedRecord()).toBeNull();
    expect(component.model()?.primaryContract?.contractId).toBe(account.currentContract!.contractId); expect(root().querySelector('.delivered-car')).toBeNull();
  });
  it.each([
    { result: { status: 'unavailable' }, title: 'Your selection could not be read' },
    { result: { status: 'forbidden' }, title: 'Your selection could not be read' },
    { result: { status: 'uncertain' }, title: 'Your selection status is not confirmed' },
    { result: { status: 'ok', value: { selection: { orderUuid: 'manual-selection' } } }, title: 'Your selection status is not confirmed' },
    { result: { status: 'ok', value: flatSelection('new-source-state') }, title: 'Your selection status is not confirmed' },
    { result: { status: 'ok', value: flatSelection('acknowledged') }, title: 'Your selection has been received' },
  ])('qualifies empty claims when manual evidence is $title', async ({ result, title }) => {
    client.readOrder.mockResolvedValue(result); const component = await mount();
    expect(text()).toContain(title); expect(text()).not.toContain('No orders to track.');
    expect(component.newestOrder()).toBeNull(); expect(root().querySelector('.placed-order')).toBeNull();
    expect(text()).toContain('Paula Mason'); expect(client.startJourney).not.toHaveBeenCalled();
  });
  it('gives a pending envelope precedence over an optional acknowledged snapshot', async () => {
    client.readOrder.mockResolvedValue({ status: 'pending', value: flatSelection('acknowledged') });
    await mount(); expect(text()).toContain('Your selection is being sent on'); expect(text()).not.toContain('Your selection has been received');
    expect(root().querySelector('.placed-order')).toBeNull();
  });
  it('retains incomplete evidence without choosing a globally newest partial order', async () => {
    const order = { orderUuid: 'partial-car', entitlementSlotId: account.slots![0].entitlementSlotId, source: { receivedAt: '2026-11-13T12:00:00Z' } };
    const partial = { ...orderCollection([order]), failed: [{ orderUuid: 'missing-car', status: 'unavailable', code: 'source-missing' }], failedCount: 12, nextAfter: 'later' };
    client.readOrders.mockResolvedValue({ status: 'unavailable', code: 'account-orders-incomplete', partial, failedAfter: 'later' });
    const component = await mount(); expect(text()).toContain('Your order list is incomplete.'); expect(text()).not.toContain('No orders to track.');
    expect(component.orders()).toMatchObject({ partial, failedAfter: 'later' }); expect(component.newestOrder()).toBeNull(); expect(component.placedRecord()).toBeNull();
    expect(root().querySelector('.order-preview')).toBeNull(); expect(text()).toContain('Paula Mason'); expect(client.readOrder).toHaveBeenCalledOnce();
  });
  it.each(['pending', 'refused'])('keeps an acknowledged list separate from %s manual media even when the identity matches', async (status) => {
    const order = { orderUuid: 'manual-selection', entitlementSlotId: account.slots![0].entitlementSlotId, outcome: 'ordered', source: { orderNumber: 'ACK-123' } };
    client.readOrders.mockResolvedValue(listed([order]));
    client.readOrder.mockResolvedValue({ status: 'ok', value: { ...flatSelection(status), selection: { orderUuid: order.orderUuid, stock: { orderUuid: order.orderUuid, facts: { display: { name: 'Unconfirmed car', photo: '/unconfirmed.webp' } } } } } });
    const component = await mount(); expect(component.newestOrder()).toEqual(order); expect(component.orderCar()).toBeNull();
    expect(root().querySelector('.order-preview')?.textContent).toContain('ACK-123'); expect(root().querySelector('.order-preview img')).toBeNull();
    expect(text()).not.toContain('Unconfirmed car'); expect(component.model()?.primaryContract?.contractId).toBe(account.currentContract!.contractId);
  });
  it('refreshes pending into an acknowledged flat selection only after an explicit read and preserves the current car', async () => {
    const order = { orderUuid: 'manual-selection', entitlementSlotId: account.slots![0].entitlementSlotId, outcome: 'ordered' };
    client.readOrders.mockResolvedValueOnce(listed()).mockResolvedValue(listed([order]));
    client.readOrder.mockResolvedValueOnce({ status: 'pending', operationId: 'private-operation' }).mockResolvedValue({ status: 'ok', value: flatSelection('acknowledged') });
    const component = await mount(); expect(client.readOrder).toHaveBeenCalledOnce();
    button('Check for updates').click(); await settle();
    expect(client.readOffers).toHaveBeenCalledTimes(2); expect(client.readOrders).toHaveBeenCalledTimes(2); expect(client.readOrder).toHaveBeenCalledTimes(2);
    expect(client.readAccount).toHaveBeenCalledOnce(); expect(client.startJourney).not.toHaveBeenCalled(); expect(client.discardDraft).not.toHaveBeenCalled();
    expect(component.newestOrder()).toEqual(order); expect(component.orderCar()).toBeNull(); expect(text()).not.toContain('Your selection is being sent on');
    expect(root().querySelector('.order-preview')?.textContent).toContain('Car details not supplied');
    expect(component.model()?.primaryContract?.contractId).toBe(account.currentContract!.contractId); expect(root().querySelector('.delivered-car')).toBeNull();
  });
  it.each([{ subject: 'other-subject' }, { employeeId: 'other-employee' }, { environmentId: 'other-environment' }, { runId: 'other-run' }])('aborts and clears independent manual/list reads on a scope change %#', async (delta) => {
    const manual = deferred<AccountResult<AccountOrderSnapshot>>(); const orders = deferred<AccountOrdersReadResult>();
    client.readOrder.mockReturnValueOnce(manual.promise); client.readOrders.mockReturnValueOnce(orders.promise);
    const component = await mount(); const manualSignal = client.readOrder.mock.calls[0][0].signal as AbortSignal;
    const listSignal = client.readOrders.mock.calls[0][0].signal as AbortSignal; const initial = ready();
    if (initial.status !== 'ready') throw new Error('Ready fixture required');
    client.readAccount.mockResolvedValueOnce({ status: 'forbidden' }); auth.state.set({ ...initial, context: { ...initial.context, ...delta } }); await settle();
    expect(manualSignal.aborted).toBe(true); expect(listSignal.aborted).toBe(true); expect(text()).not.toContain('Paula Mason');
    manual.resolve({ status: 'pending', operationId: 'old-private-operation', value: flatSelection() }); orders.resolve(listed([{ orderUuid: 'old-private-car', entitlementSlotId: 'old-slot' }])); await settle();
    expect(component.orderSnapshot()).toBeNull(); expect(component.orders()).toBeNull(); expect(component.newestOrder()).toBeNull();
    expect(text()).not.toContain('old-private-operation'); expect(text()).not.toContain('Your selection is being sent on');
  });
  it.each(['signout', 'teardown'])('discards a late independent manual response after %s', async (phase) => {
    const manual = deferred<AccountResult<AccountOrderSnapshot>>(); client.readOrder.mockReturnValueOnce(manual.promise);
    const component = await mount(); const signal = client.readOrder.mock.calls[0][0].signal as AbortSignal;
    if (phase === 'signout') { auth.state.set({ status: 'signed-out' }); await settle(); }
    else fixture.destroy();
    expect(signal.aborted).toBe(true); expect(component.orderSnapshot()).toBeNull();
    manual.resolve({ status: 'pending', value: flatSelection() }); await Promise.resolve(); await Promise.resolve();
    expect(component.orderSnapshot()).toBeNull(); expect(component.previewLoading()).toBe(false);
  });
  it('adds a placed order to the single history table and opens supplied numbers, outcome and slot in the existing drawer', async () => {
    const slot = account.slots![0].entitlementSlotId;
    client.readOrders.mockResolvedValue({ status: 'ok', value: { failed: [], failedCount: 0, nextAfter: null, pageEvidence: [], orders: [{ orderUuid: 'exact-stock', entitlementSlotId: slot, outcome: 'ordered', currentStage: 'awaiting-handover', source: { orderReference: { value: 'REF-123' }, orderNumber: 'CAR-456' } }] } });
    client.readOrder.mockResolvedValue({ status: 'ok', value: { selection: { stock: { orderUuid: 'exact-stock', facts: { display: { name: 'BMW i4', photo: '/exact.webp' } } } } } });
    await mount(); expect(root().querySelectorAll('table')).toHaveLength(1); expect(root().querySelector('.account-history tbody tr:first-child th')?.textContent).toBe('BMW i4');
    expect(text()).toContain('Current step: Awaiting handover.'); expect(root().querySelector('a[href="/orders"]')?.textContent).toBe('Track your order');
    root().querySelector<HTMLButtonElement>('.account-history tbody tr:first-child button')!.click(); await settle();
    const drawer = root().querySelector('.record-drawer')!.textContent!; expect(drawer).toContain('BMW i4'); expect(drawer).toContain('REF-123'); expect(drawer).toContain('CAR-456'); expect(drawer).toContain('Ordered'); expect(drawer).not.toContain('exact-stock');
  });
  it('lets an allocated order supersede a same-slot saved journey and no-car notice while returned-car evidence stays explicit', async () => {
    const slot = account.slots![0].entitlementSlotId;
    account = { ...account, state: 'no-entitlement', actions: [], contracts: [], histories: [], currentContract: null };
    client.readAccount.mockResolvedValue({ status: 'ok', value: account }); client.readDraft.mockResolvedValue({ status: 'ok', value: savedDraft({ choices: { mode: 'new', oldContractId: null, slotId: slot, schemeId: account.account!.schemeId! } }) });
    client.readOrders.mockResolvedValue({ status: 'ok', value: { failed: [], failedCount: 0, nextAfter: null, pageEvidence: [], orders: [{ orderUuid: 'stock', entitlementSlotId: slot, outcome: 'ordered' }] } });
    await mount(); expect(text()).not.toContain('No ordering entitlement'); expect(text()).not.toContain('No current car'); expect(text()).not.toContain('You started a new car order'); expect(text()).not.toContain('Saved journey could not be read'); expect(text()).toContain('Your new car');
    client.readOrders.mockResolvedValue({ status: 'ok', value: { failed: [], failedCount: 0, nextAfter: null, pageEvidence: [], orders: [{ orderUuid: 'stock', entitlementSlotId: slot, outcome: 'declined' }] } });
    await fixture.componentInstance.reloadPreviews(); await settle(); expect(text()).toContain('Your order was declined'); expect(text()).toContain('No current car');
    account = { ...account, currentCarRelationships: [{ currentCar: null, oldCar: { status: 'returned' } }] };
    client.readAccount.mockResolvedValue({ status: 'ok', value: account }); client.readOrders.mockResolvedValue({ status: 'ok', value: { failed: [], failedCount: 0, nextAfter: null, pageEvidence: [], orders: [{ orderUuid: 'stock', entitlementSlotId: slot, outcome: 'ordered' }] } });
    await fixture.componentInstance.refresh(); await settle(); expect(text()).toContain('Your previous car has been returned. Your new car becomes current at handover.');
  });
  it('uses delivered media only for the exact listed order and clears late preview facts on account change', async () => {
    const order = { orderUuid: 'exact-stock', entitlementSlotId: account.slots![0].entitlementSlotId, outcome: 'handed-over' };
    account = { ...account, currentCarRelationships: [{ currentCar: { kind: 'order', orderUuid: order.orderUuid, vin: 'DELIVEREDVIN' }, newCar: { collectedAt: '2026-11-07' } }] };
    client.readAccount.mockResolvedValue({ status: 'ok', value: account }); client.readOrders.mockResolvedValue({ status: 'ok', value: { failed: [], failedCount: 0, nextAfter: null, pageEvidence: [], orders: [order] } });
    client.readOrder.mockResolvedValueOnce({ status: 'ok', value: { selection: { stock: { orderUuid: 'different-stock', facts: { display: { name: 'Foreign car', photo: '/foreign.webp' } } } } } });
    await mount(); expect(text()).not.toContain('Foreign car'); expect(root().querySelector('.delivered-car img')).toBeNull();
    client.readOrder.mockResolvedValue({ status: 'ok', value: { selection: { stock: { orderUuid: order.orderUuid, facts: { display: { name: 'BMW i4', photo: '/exact.webp' } } } } } });
    await fixture.componentInstance.reloadPreviews(); await settle(); expect(root().querySelector('.delivered-car h2')?.textContent).toBe('BMW i4'); expect(root().querySelector('.delivered-car img')?.getAttribute('src')).toBe('/exact.webp');
    const late = deferred<AccountOrdersReadResult>(); client.readOrders.mockReturnValueOnce(late.promise);
    const loading = fixture.componentInstance.reloadPreviews(); auth.state.set({ status: 'signed-out' }); await settle(); late.resolve({ status: 'ok', value: { failed: [], failedCount: 0, nextAfter: null, pageEvidence: [], orders: [order] } }); await loading; await settle();
    expect(text()).not.toContain('BMW i4'); expect(root().querySelector('img')).toBeNull(); expect(fixture.componentInstance.newestOrder()).toBeNull();
  });
  it('announces loading, keeps failed reads truthful and retries explicitly', async () => {
    const pending = deferred<AccountResult<AccountProjection>>(); client.readAccount.mockReturnValueOnce(pending.promise);
    fixture = TestBed.createComponent(AccountComponent); fixture.detectChanges();
    expect(text()).toContain('Loading your account'); expect(root().querySelector('[aria-busy="true"]')).not.toBeNull();
    pending.resolve({ status: 'unavailable' }); await settle(); expect(text()).toContain('Your account is unavailable'); expect(text()).not.toContain('Paula Mason'); expect(client.readAccount).toHaveBeenCalledTimes(1);
    button('Refresh').click(); await settle(); expect(text()).toContain('Paula Mason'); expect(client.readAccount).toHaveBeenCalledTimes(2);
  });
  it.each(['forbidden', 'authentication-required', 'stale-run'] as const)('renders %s without account facts or successful journey controls', async (status) => {
    client.readAccount.mockResolvedValue({ status }); await mount(); expect(text()).not.toContain('Paula Mason'); expect(button('Choose a replacement')).toBeUndefined();
    expect(text()).toContain(status === 'forbidden' ? 'This account cannot be opened' : status === 'stale-run' ? 'This session has changed' : 'Sign in to open your account');
  });
  it('keeps unsupported history readable while denying client-invented replacement permission', async () => {
    client.readAccount.mockResolvedValue({ status: 'ok', value: { ...account, state: 'unsupported-scheme' } }); await mount();
    expect(text()).toContain('Ordering is not supported for this scheme'); expect(root().querySelectorAll('tbody tr')).toHaveLength(2); expect(button('Choose a replacement')).toBeUndefined();
  });
  it('suppresses duplicate starts, reconciles through AccountClient and retains the returned draft for review', async () => {
    const result = deferred<AccountResult<ManualDraft>>(); client.startJourney.mockReturnValue(result.promise);
    const component = await mount(); button('Choose a replacement').click(); button('Choose a replacement').click(); await settle();
    expect(client.startJourney).toHaveBeenCalledTimes(1); expect(component.pendingIntent()).toBeNull(); expect(button('Choose a replacement').disabled).toBe(true);
    result.resolve({ status: 'ok', value: savedDraft({ draftVersion: 7 }) }); await settle();
    expect(component.saved()?.draftVersion).toBe(7); expect(component.pendingIntent()).toEqual(savedDraft().choices); expect(text()).toContain('Review choices');
    expect(document.activeElement?.textContent).toBe('Review choices');
  });
  it('resumes a permitted saved journey through the same reconciliation boundary and preserves saved state on refresh', async () => {
    client.readDraft.mockResolvedValue({ status: 'ok', value: savedDraft() }); const component = await mount();
    button('Carry on').click(); await settle(); expect(client.startJourney).toHaveBeenCalledTimes(1); expect(component.pendingIntent()).toEqual(savedDraft().choices);
    await component.refresh(); await settle(); expect(component.saved()?.draftVersion).toBe(3); expect(component.pendingIntent()).toBeNull(); expect(text()).toContain('You started choosing a replacement');
  });
  it('requires refresh after stale/pending commands and never presents an unconfirmed save as success', async () => {
    client.startJourney.mockResolvedValue({ status: 'pending', operationId: 'durable-operation' }); const component = await mount();
    button('Choose a replacement').click(); await settle(); expect(component.pendingIntent()).toBeNull(); expect(text()).toContain('Your journey update is not confirmed'); expect(button('Choose a replacement').disabled).toBe(true);
    client.readDraft.mockResolvedValue({ status: 'ok', value: savedDraft({ requiresRefresh: true, contextVersion: 'old' }) });
    await component.refresh(); await settle(); expect(button('Carry on')).toBeUndefined(); expect(button('Discard')).toBeUndefined();
    client.startJourney.mockResolvedValue({ status: 'stale-version' }); button('Choose a replacement').click(); await settle();
    expect(client.startJourney.mock.calls.at(-1)![0].reviewedContextVersion).toBe(account.contextVersion); expect(text()).toContain('Your context has changed'); expect(component.pendingIntent()).toBeNull();
  });
  it('does not enable starts when a saved journey cannot be read', async () => {
    client.readDraft.mockResolvedValue({ status: 'unavailable' }); await mount(); expect(text()).toContain('Saved journey could not be read'); expect(button('Choose a replacement').disabled).toBe(true);
  });
  it('confirms discard with focus, Escape/Keep it restore the opener and a confirmed CAS discard reloads server state', async () => {
    client.readDraft.mockResolvedValueOnce({ status: 'ok', value: savedDraft() }); const component = await mount();
    button('Discard').click(); await settle(); expect(document.activeElement?.className).toBe('discard-confirm');
    root().querySelector('.discard-confirm')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle(); expect(document.activeElement).toBe(button('Discard'));
    button('Discard').click(); await settle(); button('Keep it').click(); await settle(); expect(client.discardDraft).not.toHaveBeenCalled();
    button('Discard').click(); await settle(); button('Discard journey').click(); button('Discard journey').click(); await settle();
    expect(client.discardDraft).toHaveBeenCalledTimes(1); expect(client.discardDraft.mock.calls[0][0]).toMatchObject({ expectedDraftVersion: 3 }); expect(component.saved()).toBeNull(); expect(text()).not.toContain('You started choosing'); expect(document.activeElement?.tagName).toBe('H1');
  });
  it('retains a conflicting discard and reads the latest draft before another deliberate attempt', async () => {
    client.readDraft.mockResolvedValueOnce({ status: 'ok', value: savedDraft() }).mockResolvedValue({ status: 'ok', value: savedDraft({ draftVersion: 8 }) });
    client.discardDraft.mockResolvedValue({ status: 'stale-version' }); const component = await mount();
    button('Discard').click(); await settle(); button('Discard journey').click(); await settle();
    expect(component.saved()?.draftVersion).toBe(8); expect(text()).toContain('Your context has changed'); expect(button('Discard').disabled).toBe(true);
  });
  it('loads the separate notification setting, saves with CAS and displays the authoritative canonical readback', async () => {
    const component = await mount(); const input = root().querySelector<HTMLInputElement>('#notification-email')!;
    expect(input.value).toBe('saved@example.test'); input.value = 'new@example.test'; input.dispatchEvent(new Event('input')); await settle();
    root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); await settle();
    expect(client.saveNotificationEmail.mock.calls[0][0]).toMatchObject({ expectedVersion: 4, deliveryEmail: 'new@example.test' }); expect(component.email()).toEqual({ version: 5, deliveryEmail: 'canonical@example.test' }); expect(input.value).toBe('canonical@example.test'); expect(text()).toContain('Saved.');
    input.value = ''; input.dispatchEvent(new Event('input')); await settle(); client.saveNotificationEmail.mockResolvedValue({ status: 'ok', value: { version: 6, deliveryEmail: null } });
    root().querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true })); await settle(); expect(client.saveNotificationEmail.mock.calls.at(-1)![0]).toMatchObject({ expectedVersion: 5, deliveryEmail: null }); expect(text()).toContain('Email notifications off.');
  });
  it('retains notification edits and errors, forbids a stale CAS retry until explicit reload and preserves command identity on safe retry', async () => {
    const component = await mount(); const input = root().querySelector<HTMLInputElement>('#notification-email')!; input.value = 'edit@example.test'; input.dispatchEvent(new Event('input')); await settle();
    client.saveNotificationEmail.mockResolvedValue({ status: 'unavailable' }); await component.saveEmail(new Event('submit')); await settle(); const first = client.saveNotificationEmail.mock.calls[0][0];
    expect(input.value).toBe('edit@example.test'); expect(text()).toContain('Could not save'); await component.saveEmail(new Event('submit')); expect(client.saveNotificationEmail.mock.calls[1][0]).toEqual(first);
    client.saveNotificationEmail.mockResolvedValue({ status: 'conflict' }); await component.saveEmail(new Event('submit')); await settle(); expect(input.disabled).toBe(true); expect(input.value).toBe('edit@example.test'); expect(text()).toContain('This email has changed');
    client.readNotificationEmail.mockResolvedValue({ status: 'ok', value: { version: 9, deliveryEmail: 'latest@example.test' } }); button('Reload email').click(); await settle(); expect(input.value).toBe('latest@example.test'); expect(input.disabled).toBe(false);
  });
  it('associates email correction with the field and summary without submitting invalid input', async () => {
    const component = await mount(); const input = root().querySelector<HTMLInputElement>('#notification-email')!; input.value = 'invalid'; input.dispatchEvent(new Event('input')); await settle();
    await component.saveEmail(new Event('submit')); await settle(); expect(client.saveNotificationEmail).not.toHaveBeenCalled(); expect(input.getAttribute('aria-invalid')).toBe('true'); expect(root().querySelector('.gcsp-error-summary a')?.getAttribute('href')).toBe('#notification-email');
  });
  it('uses one canonical stacked history table, source Current car emphasis and named actions bound to exact records across schemes', async () => {
    account = { ...account, histories: account.histories!.map((history, index) => ({ ...history, entries: history.entries.map(car => ({ ...car, model: 'Shared car name', ...(index === 0 ? { contractEndDate: '2026-12-01' } : { returnedDate: '2025-12-01' }) })) })) };
    client.readAccount.mockResolvedValue({ status: 'ok', value: account }); const component = await mount();
    const history = root().querySelector('.account-history')!; expect(history.querySelectorAll('gcsp-data-table')).toHaveLength(1); expect(history.querySelectorAll('table')).toHaveLength(1); expect(history.querySelector('.gcsp-table-wrap.is-stack')).not.toBeNull();
    const rows = history.querySelectorAll('tbody tr'); expect(rows).toHaveLength(2); expect(rows[0].querySelector('strong.is-success')?.textContent).toBe('Current car');
    expect(rows[0].textContent).toContain('Ends 1 Dec 2026'); expect(rows[1].textContent).toContain('Returned 1 Dec 2025');
    const record = rows[1].querySelector<HTMLButtonElement>('button')!; expect(record.getAttribute('aria-label')).toBe('View record for Shared car name, PCS UK FS BMW, Returned 1 Dec 2025');
    record.focus(); record.click(); await settle(); expect(component.selectedRecord()?.contractId).toBe(account.histories![1].entries[0].contractId); expect(root().querySelector('.record-drawer')?.textContent).toContain('PCS UK FS BMW');
    root().querySelector<HTMLButtonElement>('.record-drawer header button')!.click(); await settle(); expect(document.activeElement).toBe(record);
  });
  it('keeps unlabeled history schemes distinct and combines only populated history-only schemes into one source note', async () => {
    account = { ...account, histories: account.histories!.map((history, index) => ({ ...history, label: undefined, orderingSupported: index === 1 ? undefined : false })) };
    client.readAccount.mockResolvedValue({ status: 'ok', value: account }); const component = await mount();
    const history = root().querySelector('.account-history')!; expect(history.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(history.textContent).toContain('Scheme 1'); expect(history.textContent).toContain('Scheme 2'); expect(history.textContent).not.toContain('Scheme 3');
    expect(history.querySelectorAll('.gcsp-synthetic')).toHaveLength(1); expect(history.querySelector('.gcsp-synthetic')?.textContent).toBe("Scheme 1 and Scheme 2 show history only; you can't order through them here.");
    account = { ...account, state: 'unsupported-scheme' }; client.readAccount.mockResolvedValue({ status: 'ok', value: account }); await component.refresh(); await settle();
    expect(root().querySelectorAll('.account-history tbody tr')).toHaveLength(2); expect(root().querySelector('.account-history .gcsp-synthetic')).toBeNull();
  });
  it('opens complete labelled history records, traps keyboard focus, restores the exact opener and prints only that selected record', async () => {
    await mount(); const opener = root().querySelector<HTMLButtonElement>('tbody tr:last-child button')!; opener.focus(); opener.click(); await settle();
    const drawer = root().querySelector<HTMLDialogElement>('.record-drawer')!; const close = drawer.querySelector<HTMLButtonElement>('header button')!; const printButton = drawer.querySelector<HTMLButtonElement>('footer button')!; expect(drawer.open).toBe(true); expect(drawer.getAttribute('aria-labelledby')).toBe('record-title'); expect(drawer.textContent).toContain('BMW 1 Series Sports Hatch 120'); expect(drawer.textContent).toContain('Technical specification and options'); expect(drawer.textContent).toContain('Model or handbook evidence'); expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); expect(document.activeElement).toBe(printButton);
    printButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); expect(document.activeElement).toBe(close);
    const originalAppend = document.body.append.bind(document.body); let printed: HTMLIFrameElement | null = null; const print = vi.fn();
    vi.spyOn(document.body, 'append').mockImplementation((...nodes: (Node | string)[]) => { originalAppend(...nodes); const frame = nodes.find((node) => node instanceof HTMLIFrameElement) as HTMLIFrameElement | undefined; if (frame) { printed = frame; frame.contentWindow!.print = print; } });
    printButton.click(); expect(print).toHaveBeenCalledTimes(1); const frame = printed as HTMLIFrameElement | null; expect(frame!.contentDocument!.body.textContent).toContain('BMW 1 Series Sports Hatch 120'); expect(frame!.contentDocument!.body.textContent).not.toContain('Casey Ward'); frame!.contentWindow!.dispatchEvent(new Event('afterprint')); expect(document.querySelector('iframe')).toBeNull();
    drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(); expect(root().querySelector('.record-drawer')).toBeNull(); expect(document.activeElement).toBe(opener);
  });
  it('immediately hides private facts on account change, aborts pending commands and ignores late old-account responses', async () => {
    const pending = deferred<AccountResult<ManualDraft>>(); client.startJourney.mockReturnValue(pending.promise); const component = await mount(); button('Choose a replacement').click(); await settle();
    const requestSignal = client.startJourney.mock.calls[0][1].signal as AbortSignal; const next = deferred<AccountResult<AccountProjection>>(); client.readAccount.mockReturnValueOnce(next.promise);
    auth.state.set(ready('another-employee')); fixture.detectChanges(); expect(text()).not.toContain('Paula Mason'); expect(text()).not.toContain('saved@example.test'); expect(requestSignal.aborted).toBe(true);
    pending.resolve({ status: 'ok', value: savedDraft() }); await settle(); expect(component.pendingIntent()).toBeNull(); expect(text()).not.toContain('Paula Mason');
    next.resolve({ status: 'forbidden' }); await settle(); expect(text()).toContain('This account cannot be opened');
    auth.state.set({ status: 'signed-out' }); await settle(); expect(component.projection()).toBeNull(); expect(component.emailInput()).toBe(''); expect(text()).not.toContain('Casey Ward');
  });
  it('aborts private reads and removes drawers and print resources on teardown', async () => {
    const wait = deferred<AccountResult<AccountProjection>>(); client.readAccount.mockReturnValue(wait.promise); await mount(); const requestSignal = client.readAccount.mock.calls[0][0].signal as AbortSignal;
    fixture.destroy(); expect(requestSignal.aborted).toBe(true); wait.resolve({ status: 'ok', value: account }); await Promise.resolve(); expect(fixture.componentInstance.projection()).toBeNull();
  });
  it('rereads the idle account on a native visibility trigger without submitting a command', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await mount(); document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(client.readAccount).toHaveBeenCalledTimes(2); expect(client.readDraft).toHaveBeenCalledTimes(2);
    expect(client.startJourney).not.toHaveBeenCalled(); expect(client.saveNotificationEmail).not.toHaveBeenCalled();
  });

  it.each([{ label: 'Buddy history', content: '3 cars checked, 1 suitable.' }, { label: 'View held offer', content: 'BMW i4' }])('preserves the real $label drawer and focus until it closes before refreshing the account', async ({ label, content }) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); readyBuddy();
    await mount(); const child = fixture.debugElement.query(By.directive(AccountBuddyComponent)).componentInstance;
    const host = root().querySelector('gcsp-account-buddy'); button(label).click(); await settle();
    const overlay = host!.querySelector<HTMLElement>('.gcsp-side-drawer')!; const dialog = overlay.querySelector<HTMLElement>('aside[role="dialog"]')!; const focus = dialog.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
    expect(document.activeElement).toBe(dialog.querySelector('.gcsp-side-drawer-title')); focus.focus(); expect(overlay.hidden).toBe(false); expect(dialog.textContent).toContain(content);
    document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(client.readAccount).toHaveBeenCalledOnce(); expect(root().querySelector('gcsp-account-buddy')).toBe(host);
    expect(fixture.debugElement.query(By.directive(AccountBuddyComponent)).componentInstance).toBe(child);
    expect(overlay.hidden).toBe(false); expect(dialog.textContent).toContain(content); expect(document.activeElement).toBe(focus);
    focus.click(); await settle(); expect(overlay.hidden).toBe(true); expect(document.activeElement).toBe(button(label));
    document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(client.readAccount).toHaveBeenCalledTimes(2);
  });

  it('lets a real Buddy activity read finish before a later visibility trigger refreshes the account', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); const { activity, value } = readyBuddy();
    await mount(); const host = root().querySelector('gcsp-account-buddy');
    const child = fixture.debugElement.query(By.directive(AccountBuddyComponent)).componentInstance as AccountBuddyComponent;
    const pending = deferred<ActivityResult<ActivityProjection>>(); vi.mocked(activity.readActivity).mockReturnValueOnce(pending.promise);
    const read = child.activity.refresh(); await settle(); const signal = vi.mocked(activity.readActivity).mock.calls[1][0]!.signal as AbortSignal;
    document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(client.readAccount).toHaveBeenCalledOnce(); expect(root().querySelector('gcsp-account-buddy')).toBe(host); expect(signal.aborted).toBe(false);
    pending.resolve({ status: 'ok', value }); await read; await settle(); expect(text()).toContain('A car is held for you');
    document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(client.readAccount).toHaveBeenCalledTimes(2);
  });

  it('retains Buddy command readback until the actual command and activity reconciliation finish', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); const { activity, value } = readyBuddy();
    await mount(); const host = root().querySelector('gcsp-account-buddy');
    const pause = deferred<import('../preferences/brief.types').BriefResult<import('../preferences/brief.types').BriefEngagementValue>>();
    const readback = deferred<ActivityResult<ActivityProjection>>(); const briefClient = TestBed.inject(BriefClient);
    briefClient.pauseSearch = vi.fn().mockReturnValueOnce(pause.promise); vi.mocked(activity.readActivity).mockReturnValueOnce(readback.promise);
    button('Pause search').click(); await settle();
    document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(client.readAccount).toHaveBeenCalledOnce();
    const base = briefEditorFixture().initial.buddy;
    pause.resolve({ status: 'ok', value: { briefVersion: 5, draftVersion: 2, buddy: { ...base, state: 'disengaged', reason: 'paused', permissionVersion: 4, considered: 2, remaining: 0 } } }); await settle();
    expect(activity.readActivity).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(client.readAccount).toHaveBeenCalledOnce(); expect(root().querySelector('gcsp-account-buddy')).toBe(host); expect(text()).toContain('A car is held for you');
    readback.resolve({ status: 'ok', value: { ...value, briefVersion: 5, permission: { ...value.permission!, paused: true, canSearch: false, canHold: false } } }); await settle();
    expect(button('Resume search').disabled).toBe(false); expect(briefClient.pauseSearch).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(client.readAccount).toHaveBeenCalledTimes(2);
  });

  it('keeps exact unsaved email input through a skipped trigger and resumes after the edit is resolved', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const component = await mount(); component.emailInput.set('  unsaved@example.test  ');
    document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(client.readAccount).toHaveBeenCalledOnce(); expect(component.emailInput()).toBe('  unsaved@example.test  ');
    component.emailInput.set('saved@example.test'); document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(client.readAccount).toHaveBeenCalledTimes(2); expect(client.saveNotificationEmail).not.toHaveBeenCalled();
  });
  it('preserves busy reads, journey review and open or pending preference edits until an eligible trigger', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const component = await mount(); const brief = TestBed.inject(BriefEditorStore);
    const guards = [component.loading, component.busy, component.emailBusy, component.previewLoading, component.confirmingDiscard,
      component.journeyLocked, brief.loading, brief.saving, brief.queueNeedsReview, brief.fullDirty, brief.fullBusy, brief.previewLoading, brief.buddyRefreshing];
    for (const guard of guards) {
      guard.set(true); document.dispatchEvent(new Event('visibilitychange')); await settle();
      expect(client.readAccount).toHaveBeenCalledOnce(); expect(guard()).toBe(true); guard.set(false);
    }
    brief.openCategory.set('body'); brief.pendingRemoval.set('body');
    document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(brief.openCategory()).toBe('body'); expect(brief.pendingRemoval()).toBe('body'); expect(client.readAccount).toHaveBeenCalledOnce();
    brief.openCategory.set(null); brief.pendingRemoval.set(null);
    const intent = savedDraft().choices; component.pendingIntent.set(intent);
    document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(component.pendingIntent()).toBe(intent); expect(client.readAccount).toHaveBeenCalledOnce();
    component.pendingIntent.set(null); document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(client.readAccount).toHaveBeenCalledTimes(2); expect(client.startJourney).not.toHaveBeenCalled(); expect(client.discardDraft).not.toHaveBeenCalled();
  });
  it('keeps an uncertain email command and its exact input until explicit reconciliation, with no replay', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const component = await mount(); component.emailInput.set('new@example.test');
    const pending = deferred<AccountResult<import('./account.types').NotificationEmail>>(); client.saveNotificationEmail.mockReturnValueOnce(pending.promise);
    const save = component.saveEmail(new Event('submit', { cancelable: true }));
    document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(client.readAccount).toHaveBeenCalledOnce();
    pending.resolve({ status: 'uncertain' }); await save;
    document.dispatchEvent(new Event('visibilitychange')); await settle();
    expect(component.emailInput()).toBe('new@example.test'); expect(component.emailMessage()).toContain('not confirmed');
    expect(client.readAccount).toHaveBeenCalledOnce(); expect(client.saveNotificationEmail).toHaveBeenCalledOnce();
    await component.reloadEmail(); document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(client.readAccount).toHaveBeenCalledTimes(2);
  });
  it('does not read the old account after sign-out or component destruction', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await mount(); auth.state.set({ status: 'signed-out' }); fixture.detectChanges();
    document.dispatchEvent(new Event('visibilitychange')); await settle(); expect(client.readAccount).toHaveBeenCalledOnce();
    fixture.destroy(); document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); expect(client.readAccount).toHaveBeenCalledOnce();
  });

  it('does not grant stale-draft review authority during an automatic read, while explicit Refresh still can', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const component = await mount(); client.startJourney.mockResolvedValue({ status: 'stale-version' });
    document.dispatchEvent(new Event('visibilitychange')); await settle();
    await component.start(account.actions![0]); expect(client.startJourney.mock.calls[0][0].reviewedContextVersion).toBeNull();
    await component.refresh(); await settle(); await component.start(account.actions![0]);
    expect(client.startJourney.mock.calls[1][0].reviewedContextVersion).toBe(account.contextVersion);
  });

  it.each([false, true])('preserves an explicit review only for the same account context (changed=%s)', async (changed) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const component = await mount(); await component.refresh(); await settle();
    client.readAccount.mockResolvedValueOnce({ status: 'ok', value: { ...account, contextVersion: changed ? 'new-context-version' : account.contextVersion } });
    document.dispatchEvent(new Event('visibilitychange')); await settle(); await component.start(account.actions![0]);
    expect(client.startJourney.mock.calls[0][0].reviewedContextVersion).toBe(changed ? null : account.contextVersion);
  });

});
