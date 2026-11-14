import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { BriefClient } from '../preferences/brief.client';
import { AccountClient } from './account.client';
import { AccountComponent } from './account.component';
import { accountSnapshot, savedDraft } from './account.test-data';
import { AccountProjection, AccountResult, ManualDraft } from './account.types';

const ready = (employeeId = 'employee-paula'): SessionState => ({ status: 'ready', context: { subject: `subject-${employeeId}`, employeeId, environmentId: 'isolated', runId: 'run', roles: ['employee'], policyVersion: 'policy', capabilities: ['account:read'] } });
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };

describe('native employee account screen', () => {
  let fixture: ComponentFixture<AccountComponent>;
  let auth: { state: ReturnType<typeof signal<SessionState>>; recovery: ReturnType<typeof signal<null>>; signIn: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn> };
  let client: { [key in 'readOffers' | 'readOrders' | 'readOrder' | 'readAccount' | 'readDraft' | 'readNotificationEmail' | 'saveNotificationEmail' | 'startJourney' | 'discardDraft']: ReturnType<typeof vi.fn> };
  let account: AccountProjection;
  beforeEach(() => {
    account = accountSnapshot();
    auth = { state: signal(ready()), recovery: signal(null), signIn: vi.fn(), retry: vi.fn() };
    client = { readOffers: vi.fn().mockResolvedValue({ status: 'ok', value: { offers: [] } }), readOrders: vi.fn().mockResolvedValue({ status: 'ok', value: { orders: [] } }), readOrder: vi.fn().mockResolvedValue({ status: 'not-found' }), readAccount: vi.fn().mockResolvedValue({ status: 'ok', value: account }), readDraft: vi.fn().mockResolvedValue({ status: 'not-found' }),
      readNotificationEmail: vi.fn().mockResolvedValue({ status: 'ok', value: { deliveryEmail: 'saved@example.test', version: 4 } }),
      saveNotificationEmail: vi.fn().mockResolvedValue({ status: 'ok', value: { deliveryEmail: 'canonical@example.test', version: 5 } }),
      startJourney: vi.fn().mockResolvedValue({ status: 'ok', value: savedDraft() }), discardDraft: vi.fn().mockResolvedValue({ status: 'ok', value: { discarded: true, draftVersion: 4 } }) };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthPort, useValue: auth }, { provide: AccountClient, useValue: client },
      { provide: BriefClient, useValue: { readEditor: vi.fn().mockResolvedValue({ status: 'unavailable' }) } }] });
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  });
  afterEach(() => { fixture?.destroy(); vi.restoreAllMocks(); });
  const mount = async () => { fixture = TestBed.createComponent(AccountComponent); document.body.append(fixture.nativeElement); fixture.detectChanges(); await settle(); return fixture.componentInstance; };
  const root = (): HTMLElement => fixture.nativeElement;
  const text = () => root().textContent ?? '';
  const button = (label: string): HTMLButtonElement => Array.from(root().querySelectorAll('button')).find((item) => item.textContent?.trim() === label)!;
  const settle = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); await fixture.whenStable(); fixture.detectChanges(); };

  it('retains populated current car, identity, drivers, supplied labels and scheme history in approved order', async () => {
    const component = await mount();
    expect(root().querySelector('h1')?.textContent).toBe('Your cars');
    expect(root().querySelector('.current-car h2')?.textContent).toBe('BMW 3 Series Touring 320i');
    expect(text()).toContain('1,100 / 1,300'); expect(text()).toContain('Contract ends in 26 days');
    expect(text()).toContain('Paula Mason'); expect(text()).toContain('Casey Ward'); expect(text()).toContain('WARD9900000CW9XX'); expect(text()).toContain('Car licence valid until 1 January 2030');
    expect(text()).toContain('E749057'); expect(text()).toContain('27 Ashdown Road, Bracknell, RG12 9ZZ'); expect(text()).toContain('BMW Choices');
    expect(text()).not.toContain('demo-bmw-fs-uk'); expect(text()).not.toContain('choices-fs-uk'); expect(text()).not.toContain('Synthetic monthly');
    expect(root().querySelector<HTMLAnchorElement>('.account-preferences a')?.getAttribute('href')).toBe('/preferences');
    const classes = Array.from(root().querySelector('.account-screen')!.children).map((node) => node.className);
    expect(classes.indexOf('current-car')).toBeLessThan(classes.indexOf('account-summary account-preferences'));
    expect(classes.indexOf('account-summary account-preferences')).toBeLessThan(classes.indexOf('account-history'));
    expect(classes.indexOf('account-history')).toBeLessThan(classes.indexOf('account-details'));
    expect(component.projection()).toEqual(account);
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
    expect(root().querySelector('.current-car:not(.delivered-car)')).toBeNull(); expect(text()).toContain('Your car has been handed over.'); expect(text()).toContain('DELIVEREDVIN'); expect(text()).not.toContain('No current car'); expect(text()).not.toContain('exact-stock'); expect(root().querySelector('a[href="/orders"]')).not.toBeNull();
  });
  it('shows the newest pending owned offer link without inventing a manual-order gate', async () => {
    client.readOffers.mockResolvedValue({ status: 'ok', value: { offers: [{ offerId: 'owned-offer', runId: 'run', state: 'pending' }] } });
    await mount(); expect(text()).toContain('You have a car offer to decide on before choosing another car.');
    expect(root().querySelector('a[href="/offers/owned-offer"]')?.textContent).toBe('View your offer'); expect(button('Choose a replacement').disabled).toBe(false);
  });
  it('shows preview loading without blocking the working account or treating pending reads as empty', async () => {
    const offers = deferred<AccountResult<import('./account.preview').AccountOffers>>(); const orders = deferred<AccountResult<import('./account.preview').AccountOrders>>();
    client.readOffers.mockReturnValueOnce(offers.promise); client.readOrders.mockReturnValueOnce(orders.promise);
    await mount(); expect(text()).toContain('Reading your offers and orders'); expect(text()).toContain('Paula Mason'); expect(button('Choose a replacement').disabled).toBe(false); expect(text()).not.toContain('No orders to track.');
    offers.resolve({ status: 'ok', value: { offers: [] } }); orders.resolve({ status: 'ok', value: { orders: [] } }); await settle();
    expect(text()).not.toContain('Reading your offers and orders'); expect(text()).toContain('No orders to track.');
  });
  it('keeps preview failures isolated, truthful and explicitly retryable while the account stays usable', async () => {
    client.readOffers.mockResolvedValueOnce({ status: 'unavailable' }); client.readOrders.mockResolvedValueOnce({ status: 'forbidden' });
    await mount(); expect(text()).toContain('Some offer or order details could not be read.'); expect(text()).not.toContain('No orders to track.');
    expect(text()).toContain('Paula Mason'); expect(button('Choose a replacement').disabled).toBe(false);
    button('Retry offers and orders').click(); await settle(); expect(text()).toContain('No orders to track.'); expect(text()).not.toContain('Some offer or order details'); expect(client.readAccount).toHaveBeenCalledTimes(1);
  });
  it('adds a placed order to the single history table and opens supplied numbers, outcome and slot in the existing drawer', async () => {
    const slot = account.slots![0].entitlementSlotId;
    client.readOrders.mockResolvedValue({ status: 'ok', value: { orders: [{ orderUuid: 'exact-stock', entitlementSlotId: slot, outcome: 'ordered', currentStage: 'awaiting-handover', source: { orderReference: { value: 'REF-123' }, orderNumber: 'CAR-456' } }] } });
    client.readOrder.mockResolvedValue({ status: 'ok', value: { selection: { stock: { orderUuid: 'exact-stock', facts: { display: { name: 'BMW i4', photo: '/exact.webp' } } } } } });
    await mount(); expect(root().querySelectorAll('table')).toHaveLength(1); expect(root().querySelectorAll('.placed-order')).toHaveLength(1);
    expect(text()).toContain('Current step: Awaiting handover.'); expect(root().querySelector('a[href="/orders"]')?.textContent).toBe('Track your order');
    root().querySelector<HTMLButtonElement>('.placed-order button')!.click(); await settle();
    const drawer = root().querySelector('dialog')!.textContent!; expect(drawer).toContain('BMW i4'); expect(drawer).toContain('REF-123'); expect(drawer).toContain('CAR-456'); expect(drawer).toContain('Ordered'); expect(drawer).not.toContain('exact-stock');
  });
  it('lets an allocated order supersede a same-slot saved journey and no-car notice while returned-car evidence stays explicit', async () => {
    const slot = account.slots![0].entitlementSlotId;
    account = { ...account, state: 'no-entitlement', actions: [], contracts: [], histories: [], currentContract: null };
    client.readAccount.mockResolvedValue({ status: 'ok', value: account }); client.readDraft.mockResolvedValue({ status: 'ok', value: savedDraft({ choices: { mode: 'new', oldContractId: null, slotId: slot, schemeId: account.account!.schemeId! } }) });
    client.readOrders.mockResolvedValue({ status: 'ok', value: { orders: [{ orderUuid: 'stock', entitlementSlotId: slot, outcome: 'ordered' }] } });
    await mount(); expect(text()).not.toContain('No ordering entitlement'); expect(text()).not.toContain('No current car'); expect(text()).not.toContain('You started a new car order'); expect(text()).not.toContain('Saved journey could not be read'); expect(text()).toContain('Your new car');
    client.readOrders.mockResolvedValue({ status: 'ok', value: { orders: [{ orderUuid: 'stock', entitlementSlotId: slot, outcome: 'declined' }] } });
    await fixture.componentInstance.reloadPreviews(); await settle(); expect(text()).toContain('Your order was declined'); expect(text()).toContain('No current car');
    account = { ...account, currentCarRelationships: [{ currentCar: null, oldCar: { status: 'returned' } }] };
    client.readAccount.mockResolvedValue({ status: 'ok', value: account }); client.readOrders.mockResolvedValue({ status: 'ok', value: { orders: [{ orderUuid: 'stock', entitlementSlotId: slot, outcome: 'ordered' }] } });
    await fixture.componentInstance.refresh(); await settle(); expect(text()).toContain('Your previous car has been returned. Your new car becomes current at handover.');
  });
  it('uses delivered media only for the exact listed order and clears late preview facts on account change', async () => {
    const order = { orderUuid: 'exact-stock', entitlementSlotId: account.slots![0].entitlementSlotId, outcome: 'handed-over' };
    account = { ...account, currentCarRelationships: [{ currentCar: { kind: 'order', orderUuid: order.orderUuid, vin: 'DELIVEREDVIN' }, newCar: { collectedAt: '2026-11-07' } }] };
    client.readAccount.mockResolvedValue({ status: 'ok', value: account }); client.readOrders.mockResolvedValue({ status: 'ok', value: { orders: [order] } });
    client.readOrder.mockResolvedValueOnce({ status: 'ok', value: { selection: { stock: { orderUuid: 'different-stock', facts: { display: { name: 'Foreign car', photo: '/foreign.webp' } } } } } });
    await mount(); expect(text()).not.toContain('Foreign car'); expect(root().querySelector('.delivered-car img')).toBeNull();
    client.readOrder.mockResolvedValue({ status: 'ok', value: { selection: { stock: { orderUuid: order.orderUuid, facts: { display: { name: 'BMW i4', photo: '/exact.webp' } } } } } });
    await fixture.componentInstance.reloadPreviews(); await settle(); expect(root().querySelector('.delivered-car h2')?.textContent).toBe('BMW i4'); expect(root().querySelector('.delivered-car img')?.getAttribute('src')).toBe('/exact.webp');
    const late = deferred<AccountResult<import('./account.preview').AccountOrders>>(); client.readOrders.mockReturnValueOnce(late.promise);
    const loading = fixture.componentInstance.reloadPreviews(); auth.state.set({ status: 'signed-out' }); await settle(); late.resolve({ status: 'ok', value: { orders: [order] } }); await loading; await settle();
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
  it('opens complete labelled history records, traps keyboard focus, restores the exact opener and prints only that selected record', async () => {
    await mount(); const opener = root().querySelector<HTMLButtonElement>('tbody tr:last-child button')!; opener.focus(); opener.click(); await settle();
    const drawer = root().querySelector<HTMLDialogElement>('dialog')!; expect(drawer.open).toBe(true); expect(drawer.getAttribute('aria-labelledby')).toBe('record-title'); expect(drawer.textContent).toContain('BMW 1 Series Sports Hatch 120'); expect(drawer.textContent).toContain('Technical specification and options'); expect(drawer.textContent).toContain('Model or handbook evidence'); expect(document.activeElement).toBe(button('Close'));
    button('Close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); expect(document.activeElement).toBe(button('Print record'));
    button('Print record').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); expect(document.activeElement).toBe(button('Close'));
    const originalAppend = document.body.append.bind(document.body); let printed: HTMLIFrameElement | null = null; const print = vi.fn();
    vi.spyOn(document.body, 'append').mockImplementation((...nodes: (Node | string)[]) => { originalAppend(...nodes); const frame = nodes.find((node) => node instanceof HTMLIFrameElement) as HTMLIFrameElement | undefined; if (frame) { printed = frame; frame.contentWindow!.print = print; } });
    button('Print record').click(); expect(print).toHaveBeenCalledTimes(1); const frame = printed as HTMLIFrameElement | null; expect(frame!.contentDocument!.body.textContent).toContain('BMW 1 Series Sports Hatch 120'); expect(frame!.contentDocument!.body.textContent).not.toContain('Casey Ward'); frame!.contentWindow!.dispatchEvent(new Event('afterprint')); expect(document.querySelector('iframe')).toBeNull();
    drawer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle(); expect(root().querySelector('dialog')).toBeNull(); expect(document.activeElement).toBe(opener);
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
});
