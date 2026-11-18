import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPlanComponent } from './order-plan.component';
import { PlanningStore } from './planning.store';
import { PlanningFailure, PlanView } from './planning.types';

function view(): PlanView { return { planId: 'order-plan-1', versions: { policy: 'p1' }, preview: false, state: 'feasible', title: 'Order 2 vehicles', message: 'Nothing is ordered until Production confirms.',
  forecast: 'Expressed demand (deterministic baseline)', forecastNote: 'Built from saved demand. It is not a prediction.', facts: [{ label: 'Policy version', value: 'p1' }],
  lines: [{ id: 'd1', model: '3 Series', derivative: '320i', quantity: 2 }], models: [{ label: '3 Series', value: 2 }], metrics: [{ label: 'Acceptable coverage before renewal', value: '2 of 3' }],
  conflicts: [], binding: [], limitations: [], unmet: [], alternatives: [], editors: [{ key: 'orderPlan.budgetMinor', label: 'Order budget', kind: 'budget', unit: 'GBP minor units', value: 7000000, rows: [] }],
  unsupportedEditors: [], learned: 'Learned forecast unavailable.', replan: null, unbound: null, riskSources: [], comparison: [], canSubmit: true }; }

describe('order plan screen', () => {
  const plan = signal<PlanView | null>(view()); const access = signal('ready'); const stale = signal(false); const failure = signal<PlanningFailure | null>(null);
  const busy = signal(false); const canSubmit = signal(true); const preview = vi.fn(async () => {}); const submit = vi.fn(async () => {}); const edit = vi.fn();
  let fixture: ComponentFixture<OrderPlanComponent>;
  const buttons = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button'));
  const button = (label: string) => buttons().find(b => b.textContent?.trim() === label)!;
  beforeEach(async () => {
    plan.set(view()); access.set('ready'); stale.set(false); failure.set(null); busy.set(false); canSubmit.set(true); preview.mockClear(); submit.mockClear(); edit.mockClear();
    await TestBed.configureTestingModule({ imports: [OrderPlanComponent], providers: [{ provide: PlanningStore, useValue: {
      plan, access, stale, planFailure: failure, planBusy: busy, submitting: signal(false), canSubmit, canPreview: signal(true), hasEdits: signal(false),
      editorErrors: signal([]), value: () => '7000000', edit, preview, submit, refresh: vi.fn(async () => {}), backToCurrent: vi.fn(async () => {}),
      needsAuthentication: signal(false), failureMessage: (f: PlanningFailure) => f.reason ?? 'Unavailable', submissionBlock: () => 'Nothing is ordered until Production confirms.', signIn: vi.fn(), recover: vi.fn(),
    } }] }).compileComponents();
    fixture = TestBed.createComponent(OrderPlanComponent); fixture.detectChanges();
  });
  it('keeps plan hierarchy, server figures and source explanations visible', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Order 2 vehicles'); expect(root.textContent).toContain('2 of 3'); expect(root.textContent).toContain('not a prediction');
    const table = root.querySelector('table')!; expect(table.querySelector('caption')?.textContent).toBe('Proposed order');
    expect(table.querySelectorAll('th[scope="col"]').length).toBe(3); expect(table.querySelector('th[scope="row"]')?.textContent).toBe('3 Series');
    expect(root.querySelector('details.plan-limits')?.hasAttribute('open')).toBe(false);
  });
  it('associates native editor labels and hints, and forwards actual input without conversion', () => {
    const root = fixture.nativeElement as HTMLElement; const input = root.querySelector('input')!;
    expect(root.querySelector('label')?.htmlFor).toBe(input.id); expect(input.getAttribute('aria-describedby')).toContain(input.id + '-hint');
    input.value = '5000001'; input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(edit).toHaveBeenCalledWith('orderPlan.budgetMinor', '5000001', '', '');
  });
  it('prevents stale or preview submission while keeping preview comparison explicit', () => {
    canSubmit.set(false); stale.set(true); plan.set({ ...view(), preview: true, comparison: [{ label: 'Vehicles ordered', current: 2, preview: 1 }] }); fixture.detectChanges();
    expect(button('Request from Production').disabled).toBe(true); expect((fixture.nativeElement as HTMLElement).textContent).toContain('Preview');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Differences from the current plan'); expect(submit).not.toHaveBeenCalled();
  });
  it('shows unavailable, denied and infeasible outcomes without creating an order', () => {
    plan.set(null); failure.set({ status: 'unavailable', code: 'planning-forecast-not-configured', reason: 'Forecast is not connected.' }); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Forecast is not connected.'); expect(buttons().some(b => b.textContent === 'Request from Production')).toBe(false);
    failure.set(null); access.set('denied'); fixture.detectChanges(); expect((fixture.nativeElement as HTMLElement).textContent).toContain('Ordering lead access required');
    access.set('ready'); plan.set({ ...view(), state: 'infeasible', title: 'No plan meets these limits', lines: [], conflicts: ['Budget conflicts with minimum.'] }); canSubmit.set(false); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Budget conflicts with minimum.'); expect(button('Request from Production').disabled).toBe(true);
  });
  it('requires an intentional request click and emits the completed action for outcome focus', async () => {
    const requested = vi.fn(); fixture.componentInstance.requested.subscribe(requested); expect(submit).not.toHaveBeenCalled();
    button('Request from Production').click(); await fixture.whenStable(); expect(submit).toHaveBeenCalledOnce(); expect(requested).toHaveBeenCalledOnce();
  });
  it('focuses the newly rendered plan result after an intentional preview', async () => {
    const pending = fixture.componentInstance.preview(); await pending; fixture.detectChanges(); await fixture.whenStable();
    expect(document.activeElement).toBe((fixture.nativeElement as HTMLElement).querySelector('[data-plan-result]'));
  });
});
