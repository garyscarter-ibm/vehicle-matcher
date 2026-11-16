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
  afterEach(() => { fixture?.destroy(); TestBed.resetTestingModule(); });
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
});
