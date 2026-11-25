import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ordersFixture } from './greg-orders.fixtures';
import { GregOrders, parseGregOrders } from './greg-orders.model';
import { PlanningStore } from './planning.store';
import { PlanningResult, ProductionSubmissionDto, ProductionView } from './planning.types';
import { ProductionStatusComponent } from './production-status.component';

function view(): ProductionView { return { asOf: '2026-11-16T12:00:00Z', provider: [{ label: 'Mode', value: 'remote' }], submissions: [], fingerprint: 'response-1', requests: [{
  id: 'request-1', model: '3 Series', derivative: '320i', state: 'Partly confirmed', stage: 'Partly released', message: '5 of 8 confirmed. 2 released to stock.', reason: 'Remaining vehicles delayed.', code: null,
  facts: [{ label: 'Requested', value: 8 }, { label: 'Confirmed', value: 5 }, { label: 'Queued for release', value: 4 }, { label: 'Released to stock', value: 2 }, { label: 'Outstanding', value: 3 }],
  history: [{ state: 'Delayed', at: '2026-11-16T11:00:00Z', details: [{ label: 'Reason', value: 'Transport delayed.' }] }], supplies: [],
}] }; }
describe('Production request tracking screen', () => {
  const production = signal<ProductionView | null>(view()); const submission = signal<PlanningResult<ProductionSubmissionDto> | null>(null);
  const orders = signal<GregOrders | null>(null); const orderRetry = signal(false); const orderRetryKind = signal<'manual' | 'queue' | null>(null); const retainedRetry = vi.fn(async () => {}); const retryReleaseQueue = vi.fn(async () => {});
  const retryable = signal(false); const busy = signal(false); const retry = vi.fn(async () => {}); const refresh = vi.fn(async () => {});
  let fixture: ComponentFixture<ProductionStatusComponent>;
  const button = (label: string) => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === label)!;
  beforeEach(async () => {
    orders.set(null); orderRetry.set(false); orderRetryKind.set(null); retainedRetry.mockClear(); retryReleaseQueue.mockClear(); production.set(view()); submission.set(null); retryable.set(false); busy.set(false); retry.mockClear(); refresh.mockClear();
    await TestBed.configureTestingModule({ imports: [ProductionStatusComponent], providers: [{ provide: PlanningStore, useValue: {
      scope: signal('greg'), orderMessage: signal(''), orders, orderOutcome: signal(null), orderRetryKind, canRetryOrder: orderRetry, canRequestCars: signal(false),
      queueBlocked: () => false, requestCars: vi.fn(), retryReleaseQueue, retryOrder: retainedRetry, production, submission, canRetrySubmission: retryable, productionBusy: busy, submitting: signal(false), access: signal('ready'), planBusy: signal(false),
      pendingValue: signal(null), productionFailure: signal(null), needsAuthentication: signal(false), retrySubmission: retry, refresh, refreshProduction: vi.fn(async () => {}),
      signIn: vi.fn(), failureMessage: (v: { reason?: string }) => v.reason ?? 'Unavailable',
    } }] }).compileComponents();
    fixture = TestBed.createComponent(ProductionStatusComponent); fixture.detectChanges();
  });
  it('restores the intentional request form and source order tracking table', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Request cars'); expect(root.querySelectorAll('form')).toHaveLength(1);
    expect(Array.from(root.querySelectorAll('thead th')).map(h => h.textContent?.trim())).toEqual(['Car', 'Stage', 'Requested', 'Confirmed', 'Released', 'Expected / delayed']);
    expect(root.textContent).toContain('3 Series 320i');
  });
  it('keeps the source release queue button usable for an explicit retained queue retry', async () => {
    const value = ordersFixture(); orders.set(parseGregOrders({ ...value, requests: [{ ...value.requests[0], queuedQuantity: 0,
      supplies: [{ ...(value.requests[0]['supplies'] as Record<string, unknown>[])[0], queued: false }] }] }));
    orderRetry.set(true); orderRetryKind.set('queue'); fixture.detectChanges();
    expect(Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Retry release queue')).toHaveLength(1);
    button('Retry release queue').click(); await fixture.whenStable(); expect(retainedRetry).toHaveBeenCalledOnce();
  });
  it('keeps a retained release queue retry available after refreshed supply is already queued', async () => {
    orders.set(parseGregOrders(ordersFixture())); orderRetry.set(true); orderRetryKind.set('queue'); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('.gcsp-orders-queue')).toHaveLength(0);
    expect(button('Retry release queue')).toBeDefined(); button('Retry release queue').click(); await fixture.whenStable();
    expect(retainedRetry).toHaveBeenCalledOnce();
  });
  it('labels all five distinct server quantity stages and displays actual response history', () => {
    const root = fixture.nativeElement as HTMLElement; const labels = Array.from(root.querySelectorAll('dt')).map(e => e.textContent?.trim());
    expect(labels).toEqual(expect.arrayContaining(['Requested', 'Confirmed', 'Queued for release', 'Released to stock', 'Outstanding']));
    expect(root.textContent).toContain('5 of 8 confirmed. 2 released to stock.'); expect(root.textContent).toContain('Transport delayed.');
  });
  it('shows 202 pending as pending and retries only from a separate deliberate action', async () => {
    submission.set({ status: 'pending', reason: 'Production has not answered every line.', httpStatus: 202, operationId: 'operation-1', retryable: false }); retryable.set(true); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Production outcome pending'); expect((fixture.nativeElement as HTMLElement).textContent).toContain('operation-1'); expect(retry).not.toHaveBeenCalled();
    button('Retry same request').click(); await fixture.whenStable(); expect(retry).toHaveBeenCalledOnce();
  });
  it('does not call a requested acknowledgement a confirmed order', () => {
    submission.set({ status: 'ok', value: { submissionId: 'submission-1', planId: 'plan-1', requests: [], message: 'Requested. Production has not confirmed any of this yet.' } }); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Production has not confirmed any of this yet.');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Order confirmed');
  });
  it('keeps refused reasons visible and does not replace them with success copy', () => {
    production.set({ ...view(), requests: [{ ...view().requests[0], state: 'Refused', stage: 'Refused', message: 'Capacity unavailable.', reason: 'No capacity this month.' }] }); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Refused'); expect((fixture.nativeElement as HTMLElement).textContent).toContain('No capacity this month.');
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-production-result]')).toBeNull();
  });
  it('shows a truthful empty collection and requests replan only on explicit click', async () => {
    production.set({ ...view(), requests: [] }); fixture.detectChanges(); expect((fixture.nativeElement as HTMLElement).textContent).toContain('No Production requests yet.');
    const replanned = vi.fn(); fixture.componentInstance.replanned.subscribe(replanned); button('Replan after Production response').click(); await fixture.whenStable();
    expect(refresh).toHaveBeenCalledOnce(); expect(replanned).toHaveBeenCalledOnce();
  });
  it('focuses a rendered uncertain outcome after an explicit retry', async () => {
    submission.set({ status: 'uncertain', reason: 'Result unknown.' }); retryable.set(true); fixture.detectChanges();
    await fixture.componentInstance.retry(); fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe((fixture.nativeElement as HTMLElement).querySelector('[data-production-result]'));
  });
});
