import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderPlanComponent } from './order-plan.component';
import { PlanningStore } from './planning.store';
import { LearnedModelView, PlanningFailure, PlanView } from './planning.types';

function view(): PlanView { return { planId: 'order-plan-1', versions: { policy: 'p1' }, preview: false, state: 'feasible', title: 'Order 2 vehicles', message: 'Nothing is ordered until Production confirms.',
  forecast: 'Expressed demand (deterministic baseline)', forecastNote: 'Built from saved demand. It is not a prediction.', facts: [{ label: 'Policy version', value: 'p1' }],
  lines: [{ id: 'd1', model: '3 Series', derivative: '320i', quantity: 2 }], models: [{ label: '3 Series', value: 2 }], metrics: [{ label: 'Acceptable coverage before renewal', value: '2 of 3' }],
  conflicts: [], binding: [], limitations: [], unmet: [], alternatives: [], editors: [{ key: 'orderPlan.budgetMinor', label: 'Order budget', kind: 'budget', unit: 'GBP minor units', value: 7000000, rows: [] }],
  unsupportedEditors: [], learned: 'Learned forecast unavailable.', learnedModel: null, replan: null, unbound: null, riskSources: [], comparison: [], canSubmit: true }; }

function learnedModel(): LearnedModelView { return { modelFacts: [{ label: 'Model reference', value: 'sha256:2ce1109d' }], classes: [{ label: 'Saloon, 2026-12', expected: '0.8', low: '0.1', high: '1.6' }],
  evaluation: [{ label: 'Held-out check', value: 'Learned 0.52' }], limitations: ['Synthetic-trained; not validated on BMW employee choices.'],
  differences: { comparable: true, note: null, rows: [{ label: 'Vehicles ordered', baseline: '2', learned: '3', difference: '+1' }] } }; }

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
  it('renders the learned model section as advisory tables when a model is active', () => {
    plan.set({ ...view(), learned: null, learnedModel: learnedModel() }); fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement; const section = root.querySelector('section[aria-labelledby="learned-plan"]')!;
    expect(section.querySelector('h3')?.textContent).toBe('Learned model');
    const text = section.textContent ?? '';
    for (const part of ['sha256:2ce1109d', 'Held-out check', 'Synthetic-trained; not validated on BMW employee choices.', 'Advisory only', 'Request from Production uses the baseline plan above']) expect(text).toContain(part);
    const tables = Array.from(section.querySelectorAll('table'));
    expect(tables.map(t => t.querySelector('caption')?.textContent)).toEqual(['Expected demand by vehicle class', 'Baseline compared with learned model']);
    expect(Array.from(tables[0].querySelectorAll('th[scope="col"]')).map(c => c.textContent)).toEqual(['Vehicle class and period', 'Expected', 'Low', 'High']);
    expect(Array.from(tables[1].querySelectorAll('td')).map(c => c.textContent)).toEqual(['2', '3', '+1']);
    expect(section.querySelectorAll('.plan-table[tabindex="0"][role="region"]').length).toBe(2);
  });
  it('shows only the one-line note for a fallback and nothing extra when the plans cannot be compared', () => {
    const root = fixture.nativeElement as HTMLElement; const section = root.querySelector('section[aria-labelledby="learned-plan"]')!;
    expect(section.textContent).toContain('Learned forecast unavailable.'); expect(section.querySelector('table')).toBeNull();
    const m = learnedModel(); plan.set({ ...view(), learned: null, learnedModel: { ...m, differences: { comparable: false, note: 'The learned and baseline plans cannot be compared.', rows: [] } } }); fixture.detectChanges();
    const after = root.querySelector('section[aria-labelledby="learned-plan"]')!; expect(after.textContent).toContain('cannot be compared'); expect(after.querySelectorAll('table').length).toBe(1);
  });
});
