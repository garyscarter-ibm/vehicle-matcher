import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationContext, AuthPort, SessionState } from '../auth/auth.port';
import { ordersFixture } from '../greg-planning/greg-orders.fixtures';
import { parseGregOrders } from '../greg-planning/greg-orders.model';
import { PresenterClient } from './presenter.client';
import { PresenterCommand, PresenterProductionInput } from './presenter.types';
import { ProductionControlsComponent } from './production-controls.component';
const context: ApplicationContext = { subject: 'presenter', roles: ['presenter'], environmentId: 'isolated', runId: 'run-1', policyVersion: 'p1', capabilities: [] };
describe('Presenter Production controls', () => {
  const state = signal<SessionState>({ status: 'ready', context });
  const readProduction = vi.fn<PresenterClient['readProduction']>(); const submit = vi.fn<PresenterClient['submit']>();
  const prepareProduction = vi.fn((input: PresenterProductionInput): PresenterCommand => Object.freeze({ kind: 'production', input: Object.freeze({ ...input }) }));
  let fixture: ComponentFixture<ProductionControlsComponent>;
  const button = (label: string) => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('button')).find(b => b.textContent?.trim() === label)!;
  const save = async () => { (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await fixture.whenStable(); fixture.detectChanges(); };
  beforeEach(async () => {
    state.set({ status: 'ready', context }); prepareProduction.mockClear();
    readProduction.mockReset().mockResolvedValue({ state: 'ready', value: parseGregOrders(ordersFixture())! });
    submit.mockReset().mockResolvedValue({ state: 'ready', value: { reconciled: 1, applied: 1, queued: 1, requests: [{ requestId: 'request-1', outcome: 'applied' }], scripted: { requestId: 'request-1', action: 'confirm', seq: 1 } } });
    await TestBed.configureTestingModule({ imports: [ProductionControlsComponent], providers: [{ provide: AuthPort, useValue: { state } },
      { provide: PresenterClient, useValue: { readProduction, prepareProduction, submit } }] }).compileComponents();
    fixture = TestBed.createComponent(ProductionControlsComponent); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  it('offers confirm and delay for the actual outstanding request and pins its version on save', async () => {
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Production controls');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('3 Series Saloon 320i: 2 outstanding');
    expect(submit).not.toHaveBeenCalled(); await save();
    expect(prepareProduction).toHaveBeenCalledWith({ commandId: expect.any(String), requestId: 'request-1', expectedVersion: 6, action: 'confirm', quantity: 1 });
    expect(submit).toHaveBeenCalledOnce(); expect((fixture.nativeElement as HTMLElement).textContent).toContain('Delayed: Transport delayed. 1 of 3 confirmed.');
  });
  it('retains an uncertain response for an explicit same-command retry', async () => {
    expect(button('Save production response')).toBeDefined();
    submit.mockResolvedValueOnce({ state: 'failed', value: null, problem: 'transport-unavailable', writeOutcome: 'unknown' });
    await save(); const original = submit.mock.calls[0][0]; expect(submit).toHaveBeenCalledOnce();
    button('Retry same production response').click(); await fixture.whenStable(); fixture.detectChanges();
    expect(submit.mock.calls[1][0]).toBe(original);
  });
  it('sends a delay date and reason, with no confirmation quantity', async () => {
    expect(button('Save production response')).toBeDefined();
    const action = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>('#presenter-production-action')!;
    action.value = 'delay'; action.dispatchEvent(new Event('change')); fixture.detectChanges();
    for (const [id, value] of [['presenter-production-date', '2099-01-20'], ['presenter-production-reason', 'Transport delayed.']]) {
      const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#' + id)!;
      input.value = value; input.dispatchEvent(new Event('input'));
    }
    await save(); expect(prepareProduction).toHaveBeenCalledWith({ commandId: expect.any(String), requestId: 'request-1', expectedVersion: 6,
      action: 'delay', delayUntil: '2099-01-20T00:00:00.000Z', reason: 'Transport delayed.' });
  });  it('preserves the same uncertain input through same-account renewal but clears it on account change', async () => {
    submit.mockResolvedValueOnce({ state: 'failed', value: null, problem: 'transport-unavailable', writeOutcome: 'unknown' });
    await save(); const original = submit.mock.calls[0][0];
    state.set({ status: 'loading' }); fixture.detectChanges(); await fixture.whenStable();
    state.set({ status: 'ready', context }); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(submit).toHaveBeenCalledOnce(); button('Retry same production response').click(); await fixture.whenStable(); fixture.detectChanges();
    expect(submit.mock.calls[1][0].input).toEqual(original.input);
    submit.mockResolvedValueOnce({ state: 'failed', value: null, problem: 'transport-unavailable', writeOutcome: 'unknown' }); await save();
    expect(button('Retry same production response')).toBeDefined();
    state.set({ status: 'ready', context: { ...context, subject: 'other-presenter' } }); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(button('Retry same production response')).toBeUndefined(); expect(submit).toHaveBeenCalledTimes(3);
  });
  it('ignores an old-account command acknowledgement that arrives after account replacement', async () => {
    let settle!: (value: Awaited<ReturnType<PresenterClient['submit']>>) => void;
    submit.mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
    (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(submit).toHaveBeenCalledOnce();
    state.set({ status: 'ready', context: { ...context, subject: 'other-presenter' } }); fixture.detectChanges();
    settle({ state: 'ready', value: { reconciled: 1, applied: 1, queued: 1, requests: [{ requestId: 'request-1', outcome: 'applied' }], scripted: { requestId: 'request-1', action: 'confirm', seq: 1 } } });
    await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Production confirmed;');
    expect(button('Retry same production response')).toBeUndefined();
  });
  it('retains the same response when a scripted acknowledgement has an unresolved reconciliation', async () => {
    const acknowledged = { reconciled: 1, applied: 0, queued: 0, requests: [{ requestId: 'request-1', outcome: 'uncertain' }],
      scripted: { requestId: 'request-1', action: 'confirm', seq: 1 } };
    submit.mockResolvedValueOnce({ state: 'ready', value: acknowledged }); await save();
    expect(button('Retry same production response')).toBeDefined();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('release is queued');
    const original = submit.mock.calls[0][0]; button('Retry same production response').click(); await fixture.whenStable();
    expect(submit.mock.calls[1][0]).toBe(original);
  });
  it('uses the actual tracking message after a response instead of inferring queued supply', async () => {
    const acknowledged = { reconciled: 1, applied: 1, queued: 0, requests: [{ requestId: 'request-1', outcome: 'applied' }],
      scripted: { requestId: 'request-1', action: 'confirm', seq: 1 } };
    submit.mockResolvedValueOnce({ state: 'ready', value: acknowledged }); await save();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Delayed: Transport delayed. 1 of 3 confirmed.');
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('release is queued');
  });
  it('does not paint the old command outcome when the account changes during its tracking refresh', async () => {
    let settle!: (value: Awaited<ReturnType<PresenterClient['readProduction']>>) => void;
    readProduction.mockReturnValueOnce(new Promise(resolve => { settle = resolve; }));
    (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(readProduction).toHaveBeenCalledTimes(2));
    state.set({ status: 'ready', context: { ...context, subject: 'other-presenter' } }); fixture.detectChanges();
    await vi.waitFor(() => expect(readProduction).toHaveBeenCalledTimes(3));
    settle({ state: 'ready', value: parseGregOrders(ordersFixture())! }); await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('[data-production-control-result]')?.textContent).not.toContain('Delayed: Transport delayed.');
  });

});
