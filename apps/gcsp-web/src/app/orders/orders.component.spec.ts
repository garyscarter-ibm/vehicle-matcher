import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { OrdersClient } from './orders.client';
import { OrdersComponent } from './orders.component';

const identity = { orderUuid: 'order', employeeId: 'employee', runId: 'run' };
const context = { subject: 'subject', environmentId: 'dev', ...identity, employeeAuthority: true };
const slot = { slotId: 'provider-slot', start: '2026-11-15T09:00:00Z' };
const ok = <T>(value: T) => ({ status: 'ok', value });
const appointment = () => ({ ...identity, contractVersion: 'lifecycle.appointments.v1', version: 2, state: 'not-requested', booked: false,
  offeredSlots: [slot], owner: 'employee', nextStep: 'Choose a handover time', eligibility: { eligible: true }, provider: { mode: 'configured' } });
const plan = () => ({ ...identity, contractVersion: 'lifecycle.return-plan.v1', version: 4, applicable: true, scheduled: false, state: 'not-planned',
  choices: [{ id: 'same-visit', label: 'At handover', available: true }], offeredSlots: { 'same-visit': [slot] }, owner: 'employee', provider: { mode: 'configured' },
  currentCar: { model: 'Old car to return' }, relationship: { ...identity, contractVersion: 'lifecycle.current-car.v1', currentCar: { kind: 'contract', contractId: 'old-contract' }, oldCar: { status: 'held' }, newCar: { status: 'on-order' } } });

describe('native employee order progress screen', () => {
  let fixture: ComponentFixture<OrdersComponent>; let state: ReturnType<typeof signal<SessionState>>;
  let client: { context: ReturnType<typeof vi.fn>; readOrders: ReturnType<typeof vi.fn>; readOrder: ReturnType<typeof vi.fn>;
    readStages: ReturnType<typeof vi.fn>; readDocuments: ReturnType<typeof vi.fn>; readAppointment: ReturnType<typeof vi.fn>; readReturnPlan: ReturnType<typeof vi.fn>; execute: ReturnType<typeof vi.fn> };
  let signIn: ReturnType<typeof vi.fn>; let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  beforeEach(async () => {
    state = signal<SessionState>({ status: 'ready', context: { ...context, roles: ['employee'], policyVersion: 'policy', capabilities: [] } }); signIn = vi.fn();
    params = new BehaviorSubject(convertToParamMap({}));
    client = {
      context: vi.fn(() => state().status === 'ready' ? context : null),
      readOrders: vi.fn(async () => ok({ orders: [{ ...identity, entitlementSlotId: 'entitlement', source: { orderNumber: 'BMW-123' } }], failed: [], failedCount: 0, nextAfter: null, pageEvidence: [] })),
      readOrder: vi.fn(async () => ok({ selection: { stock: { orderUuid: 'order', facts: { display: { name: 'BMW i4 eDrive40', photo: '/actual-car.webp' } } } } })),
      readStages: vi.fn(async () => ok({ ...identity, contractVersion: 'lifecycle.stages.v1', schemaVersion: 1, stageList: ['HR'], stages: [{ stage: 'HR', state: 'pending' }],
        currentStage: 'HR', outcome: 'in-progress', owner: 'HR', nextStep: 'Waiting for HR' })),
      readDocuments: vi.fn(async () => ok({ contractVersion: 'lifecycle.documents.v1', orders: [{ ...identity, contractVersion: 'lifecycle.documents.v1', documentsRevision: 3, acknowledgementSupported: true,
        items: [{ itemId: 'agreement', label: 'Your agreement', action: 'Acknowledge', kind: 'document', owner: 'employee', status: 'waiting-for-employee' }, { itemId: 'preparation', label: 'Vehicle preparation', kind: 'check', owner: 'retailer', status: 'in-progress' }],
        tasks: [{ itemId: 'agreement', label: 'Your agreement', actionable: true, status: 'waiting-for-employee' }], readiness: { ready: false, state: 'waiting', documentsComplete: false, vehicleReady: false, blocking: ['agreement'], failed: [] } }] })),
      readAppointment: vi.fn(async () => ok(appointment())), readReturnPlan: vi.fn(async () => ok(plan())), execute: vi.fn(async () => ({ status: 'pending', operationId: 'op-123', retryable: false })),
    };
    await TestBed.configureTestingModule({ imports: [OrdersComponent], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: params.value }, queryParamMap: params } },
      { provide: OrdersClient, useValue: client }, { provide: AuthPort, useValue: { state, signIn } }] }).compileComponents();
  });
  afterEach(() => { fixture?.destroy(); TestBed.resetTestingModule(); vi.restoreAllMocks(); });
  async function settled() { await vi.waitFor(() => expect(fixture.componentInstance.state()?.phase).toBe('settled')); await fixture.whenStable(); fixture.detectChanges(); }
  async function commandSettled() { await vi.waitFor(() => { expect(fixture.componentInstance.action().result).not.toBeNull(); expect(fixture.componentInstance.action().busy).toBe(false); }); await settled(); }
  async function render() { fixture = TestBed.createComponent(OrdersComponent); fixture.detectChanges(); await settled(); }
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const button = (label: string) => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((b) => b.textContent?.trim() === label)!;
  it('composes exact vehicle, owner, checks and current relationship using supplied facts', async () => {
    await render(); expect(text()).toContain('BMW i4 eDrive40'); expect(text()).toContain('BMW-123'); expect(text()).toContain('Waiting for HR');
    expect(text()).toContain('Not ready for handover'); expect(text()).toContain('Retailer'); expect(text()).toContain('old-contract');
    expect((fixture.nativeElement as HTMLElement).querySelector('img')?.getAttribute('src')).toBe('/actual-car.webp');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('h1')).toHaveLength(1);
  });
  it('uses a meaningful fallback after a real image fails', async () => {
    await render(); (fixture.nativeElement as HTMLElement).querySelector('img')?.dispatchEvent(new Event('error')); fixture.detectChanges();
    expect(text()).toContain('No image available for this car'); expect((fixture.nativeElement as HTMLElement).querySelector('img')).toBeNull();
  });
  it('requires explicit task review and confirmation, then retains pending reference without a second write', async () => {
    await render(); button('Acknowledge').click(); fixture.detectChanges(); await fixture.whenStable();
    expect(text()).toContain('Acknowledgement, not a signature'); expect(client.execute).not.toHaveBeenCalled(); expect(document.activeElement?.classList.contains('order-review')).toBe(true);
    button('Confirm').click(); await commandSettled();
    expect(client.execute).toHaveBeenCalledOnce(); expect(client.execute.mock.calls[0][0]).toMatchObject({ kind: 'acknowledge', itemId: 'agreement', expectedDocumentsRevision: 3 });
    expect(text()).toContain('op-123'); expect(button('Acknowledge').disabled).toBe(true);
  });
  it('lets the employee review a new offered time after a missed handover without claiming it is booked', async () => {
    client.readAppointment.mockResolvedValue(ok({ ...appointment(), state: 'no-show', version: 7,
      slot: { slotId: 'missed-slot', start: '2026-11-14T09:00:00Z' } }));
    await render();
    const panel = (fixture.nativeElement as HTMLElement).querySelector('[aria-labelledby="handover-title"]')!;
    expect(panel.textContent).toContain('Handover missed'); expect(panel.textContent).not.toContain('Handover booked');
    const request = panel.querySelector<HTMLButtonElement>('[aria-label^="Request handover"]')!;
    expect(request).not.toBeNull(); expect(client.execute).not.toHaveBeenCalled();
    request.click(); fixture.detectChanges(); await fixture.whenStable();
    expect(text()).toContain('Request this handover time?'); expect(client.execute).not.toHaveBeenCalled();
    button('Confirm').click(); await commandSettled();
    expect(client.execute).toHaveBeenCalledOnce();
    expect(client.execute.mock.calls[0][0]).toMatchObject({ kind: 'request-appointment', orderUuid: 'order', slotId: 'provider-slot', expectedVersion: 7 });
    expect(text()).toContain('op-123'); expect(panel.textContent).not.toContain('Handover booked');
  });
  it('cancels review with Escape and makes no command call', async () => {
    await render(); const opener = button('Acknowledge'); opener.focus(); opener.click(); fixture.detectChanges(); const review = (fixture.nativeElement as HTMLElement).querySelector('.order-review')!;
    review.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); fixture.detectChanges();
    await fixture.whenStable(); expect(document.activeElement).toBe(opener);
    expect((fixture.nativeElement as HTMLElement).querySelector('.order-review')).toBeNull(); expect(client.execute).not.toHaveBeenCalled();
  });
  it('shows independent provider failures beside usable checks and never calls unsupported commands', async () => {
    client.readAppointment.mockResolvedValueOnce({ status: 'unsupported', code: 'provider-none', reason: 'Appointments are not configured.' });
    client.readReturnPlan.mockResolvedValueOnce({ status: 'forbidden' }); await render();
    expect(text()).toContain('Appointments are not configured.'); expect(text()).toContain('Your agreement'); expect(text()).toContain('These details are not available to you.');
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).some((b) => b.textContent?.trim() === 'Request')).toBe(false);
  });
  it('keeps a pending handover unbooked and exposes no employee action', async () => {
    client.readAppointment.mockResolvedValueOnce({ status: 'pending', operationId: 'pending-read', value: { ...appointment(), state: 'requested', requestedSlot: slot, pending: { reason: 'Provider checking' } } });
    await render(); expect(text()).toContain('Not booked yet.'); expect(text()).toContain('Waiting for confirmation');
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-labelledby="handover-title"] .order-state')?.textContent).toBe('Requested');
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.stage-list .is-complete')).some((li) => li.textContent?.includes('Handover booked'))).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-label^="Request handover"]')).toBeNull();
  });
  it('never presents a return plan old car as current when relationship evidence is absent', async () => {
    client.readReturnPlan.mockResolvedValueOnce(ok({ ...plan(), relationship: null, state: 'return-scheduled', scheduled: true })); await render();
    const current = (fixture.nativeElement as HTMLElement).querySelector('[aria-labelledby="relationship-title"]')!;
    expect(current.textContent).toContain('Not supplied'); expect(current.textContent).not.toContain('Old car to return');
  });
  it('reconstructs actual physical current-car changes through a deliberate reload', async () => {
    await render(); client.readReturnPlan.mockResolvedValueOnce(ok({ ...plan(), state: 'returned', relationship: { ...plan().relationship, currentCar: { kind: 'order', orderUuid: 'order', vin: 'SUPPLIEDVIN' }, oldCar: { status: 'returned' }, newCar: { status: 'collected' } } }));
    button('Refresh status').click(); await settled();
    const current = (fixture.nativeElement as HTMLElement).querySelector('[aria-labelledby="relationship-title"]')!;
    expect(current.textContent).toContain('SUPPLIEDVIN'); expect(current.textContent).toContain('Returned'); expect(client.execute).not.toHaveBeenCalled();
  });
  // FUCQ-522: Java keeps proposedSlot as history after acceptance, so a returned plan must not show it as current.
  const returnPanel = () => (fixture.nativeElement as HTMLElement).querySelector('[aria-labelledby="return-title"]')!;
  const proposed = { slotId: 'proposed-slot', start: '2026-11-30T09:00:00Z' };
  it('shows a completed return with its outcome and no retained proposal as current', async () => {
    client.readReturnPlan.mockResolvedValueOnce(ok({ ...plan(), state: 'returned', scheduled: false, proposedSlot: proposed, proposalId: 'old-proposal',
      appointment: { state: 'scheduled', owner: 'none' }, outcome: { state: 'returned', at: '2026-11-30T09:30:00Z', providerReference: 'RET-REF-1' } }));
    await render(); const panel = returnPanel().textContent ?? '';
    expect(returnPanel().querySelector('.order-state')?.textContent).toBe('Returned'); expect(panel).toContain('Return reference: RET-REF-1');
    expect(panel).not.toContain('New time proposed'); expect(panel).not.toContain('Not booked yet'); expect(button('Accept new return time')).toBeUndefined();
  });
  it('still shows an active return proposal as an unbooked proposed time', async () => {
    client.readReturnPlan.mockResolvedValueOnce(ok({ ...plan(), state: 'return-requested', scheduled: false, proposedSlot: proposed, proposalId: 'live-proposal',
      appointment: { state: 'change-proposed', owner: 'employee' } }));
    await render(); const panel = returnPanel().textContent ?? '';
    expect(panel).toContain('New time proposed:'); expect(panel).toContain('Not booked yet.'); expect(button('Accept new return time')).toBeDefined();
  });
  it('distinguishes complete empty and exact missing order from unavailable/incomplete reads', async () => {
    client.readOrders.mockResolvedValueOnce(ok({ orders: [], nextAfter: null, failed: [], failedCount: 0, pageEvidence: [] })); await render();
    expect(text()).toContain('No orders to track'); fixture.destroy(); params.next(convertToParamMap({ orderUuid: 'absent' })); await render();
    expect(text()).toContain('Order not found'); fixture.destroy(); client.readOrders.mockResolvedValueOnce({ status: 'unavailable', partial: { orders: [] } }); await render();
    expect(text()).toContain('Order progress unavailable'); expect(text()).not.toContain('No orders to track');
  });
  it('clears private facts on sign-out and starts no command after sign-in recovery', async () => {
    await render(); button('Acknowledge').click(); fixture.detectChanges(); state.set({ status: 'signed-out' }); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(text()).not.toContain('BMW-123'); expect(text()).not.toContain('Your agreement'); expect(text()).toContain('Sign in to track your order');
    button('Sign in').click(); expect(signIn).toHaveBeenCalledExactlyOnceWith('/gcsp/'); expect(client.execute).not.toHaveBeenCalled();
  });
  it('retains unavailable read status and does not present a command response as a confirmed booking', async () => {
    await render(); (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[aria-label^="Request handover"]')!.click(); fixture.detectChanges();
    button('Confirm').click(); await commandSettled();
    expect((fixture.nativeElement as HTMLElement).querySelector('[aria-labelledby="handover-title"] .order-state')?.textContent).toBe('Not requested');
    expect(text()).toContain('Waiting for confirmation of your update'); expect(client.execute).toHaveBeenCalledOnce();
  });
  it('rereads native visibility changes without an order command or focus change', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await render(); const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    document.dispatchEvent(new Event('visibilitychange')); await settled();
    expect(client.readOrders).toHaveBeenCalledTimes(2); expect(client.execute).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled();
  });

  it.each(['stages', 'documents', 'appointment', 'returnPlan'] as const)('announces the exact message in the existing region only after changed ready %s settles', async (resource) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await render(); expect(text()).not.toContain('Order progress updated.');
    const read = ({ stages: client.readStages, documents: client.readDocuments, appointment: client.readAppointment, returnPlan: client.readReturnPlan })[resource];
    const before = await read.mock.results[0].value;
    const value = resource === 'documents' ? { ...before.value, orders: before.value.orders.map((order: Record<string, unknown>) => ({ ...order, documentsRevision: 4 })) }
      : { ...before.value, ...(resource === 'stages' ? { currentStage: 'Ordering', nextStep: 'Ordering your car' } : { version: 10 }) };
    read.mockResolvedValueOnce(ok(value));
    document.dispatchEvent(new Event('visibilitychange')); await settled();
    expect(fixture.componentInstance.refreshMessage()).toBe('Order progress updated.');
    expect((fixture.nativeElement as HTMLElement).querySelector('.order-feedback')?.textContent).toContain('Order progress updated.');
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('[aria-live="polite"]')).toHaveLength(1); expect(client.execute).not.toHaveBeenCalled();
  });
  it('keeps unchanged and nested asOf-only rereads silent', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await render(); const result = await client.readStages.mock.results[0].value; let asOf = '2026-11-22T12:00:00Z';
    client.readStages.mockImplementation(async () => ok({ ...result.value, asOf,
      stages: result.value.stages.map((stage: Record<string, unknown>) => ({ ...stage, asOf })) }));
    document.dispatchEvent(new Event('visibilitychange')); await settled(); expect(fixture.componentInstance.refreshMessage()).toBe('');
    asOf = '2026-11-22T12:01:00Z'; document.dispatchEvent(new Event('visibilitychange')); await settled();
    expect(client.readStages).toHaveBeenCalledTimes(3); expect(fixture.componentInstance.refreshMessage()).toBe(''); expect(text()).not.toContain('Order progress updated.');
  });
  it.each(['unavailable', 'identity-mismatch'] as const)('keeps a failed or stale %s refresh silent', async (failure) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); await render();
    const original = await client.readStages.mock.results[0].value;
    client.readStages.mockResolvedValueOnce(failure === 'unavailable' ? { status: 'unavailable', code: 'provider-read-failed' }
      : ok({ ...original.value, employeeId: 'someone-else', currentStage: 'Ordering' }));
    document.dispatchEvent(new Event('visibilitychange')); await settled(); expect(fixture.componentInstance.refreshMessage()).toBe('');
    expect(text()).not.toContain('Order progress updated.');
  });
  it('keeps an open command review intact, then reads on the next trigger after cancellation', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); await render();
    fixture.componentInstance.prepare({ kind: 'acknowledge', itemId: 'agreement' }); const review = fixture.componentInstance.action().review;
    document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve();
    expect(client.readOrders).toHaveBeenCalledOnce(); expect(fixture.componentInstance.action().review).toBe(review);
    fixture.componentInstance.cancel(); document.dispatchEvent(new Event('visibilitychange')); await settled();
    expect(client.readOrders).toHaveBeenCalledTimes(2); expect(client.execute).not.toHaveBeenCalled();
  });
  it('skips a busy command and preserves its pending response during subsequent automatic reads without replay', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); await render();
    let complete!: (result: unknown) => void; client.execute.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    fixture.componentInstance.prepare({ kind: 'acknowledge', itemId: 'agreement' }); const command = fixture.componentInstance.confirm();
    document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); expect(client.readOrders).toHaveBeenCalledOnce();
    complete({ status: 'pending', operationId: 'owned-update', retryable: false }); await command; await settled();
    const response = fixture.componentInstance.action().result; expect(response).toMatchObject({ status: 'pending', operationId: 'owned-update' });
    document.dispatchEvent(new Event('visibilitychange')); await settled();
    expect(client.readOrders).toHaveBeenCalledTimes(3); expect(fixture.componentInstance.action().result).toBe(response);
    expect(text()).toContain('Waiting for confirmation of your update.'); expect(text()).toContain('owned-update'); expect(client.execute).toHaveBeenCalledOnce();
  });
  it('does not cancel an active automatic read and resumes on a later trigger once it settles', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); await render();
    const original = await client.readStages.mock.results[0].value;
    let complete!: (result: unknown) => void; client.readStages.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    document.dispatchEvent(new Event('visibilitychange')); await vi.waitFor(() => expect(client.readStages).toHaveBeenCalledTimes(2));
    document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); expect(client.readOrders).toHaveBeenCalledTimes(2);
    complete(original); await settled(); document.dispatchEvent(new Event('visibilitychange')); await settled(); expect(client.readOrders).toHaveBeenCalledTimes(3);
  });
  it.each(['identity', 'destroy'] as const)('does not announce a late read after %s changes', async (change) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); await render();
    const component = fixture.componentInstance; const original = await client.readStages.mock.results[0].value;
    let complete!: (result: unknown) => void; client.readStages.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    document.dispatchEvent(new Event('visibilitychange')); await vi.waitFor(() => expect(client.readStages).toHaveBeenCalledTimes(2));
    if (change === 'identity') { state.set({ status: 'signed-out' }); fixture.detectChanges(); } else fixture.destroy();
    complete(ok({ ...original.value, currentStage: 'Ordering' })); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(component.refreshMessage()).toBe(''); document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); expect(client.readOrders).toHaveBeenCalledTimes(2);
  });

  it.each(['authentication-required', 'unauthenticated', 'stale-run', 'account-changed'] as const)('keeps a non-stage %s boundary silent', async (status) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); await render();
    client.readAppointment.mockResolvedValueOnce({ status, code: 'lifecycle-authority-changed', retryable: false });
    document.dispatchEvent(new Event('visibilitychange')); await settled();
    expect(fixture.componentInstance.refreshMessage()).toBe('');
    expect(text()).not.toContain('Order progress updated.');
  });

  it('announces a changed partial producer envelope when order stages remain ready, as the source does', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); await render();
    client.readAppointment.mockResolvedValueOnce({ status: 'unavailable', code: 'appointment-unavailable', retryable: true });
    document.dispatchEvent(new Event('visibilitychange')); await settled();
    expect(fixture.componentInstance.model()?.stages.state).toBe('ok'); expect(fixture.componentInstance.model()?.appointment.state).toBe('unavailable');
    expect(fixture.componentInstance.refreshMessage()).toBe('Order progress updated.');
  });

});
