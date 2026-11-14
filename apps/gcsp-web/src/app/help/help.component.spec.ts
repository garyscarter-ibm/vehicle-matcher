import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import type { ApplicationContext, SessionState } from '../auth/auth.port';
import { CaseClient } from '../cases/case.client';
import type { CaseClientResult } from '../cases/case.client';
import type { CaseDetailValue, CaseHelp, CaseRecord } from '../cases/case.types';
import { HelpComponent } from './help.component';

const at = '2026-07-14T10:00:00.000Z';
const context: ApplicationContext = { subject: 'paula-subject', environmentId: 'isolated', runId: 'run-1',
  employeeId: 'paula', roles: ['employee'], policyVersion: 'policy-1', capabilities: [] };
const guidance: CaseHelp = { opensCase: false, ownerRole: 'scheme-team', extensionPermitted: false, automaticRecoveryPriority: false,
  nextAction: 'Ask for help to open an owned renewal case.', policyVersion: 'policy-1', assumptions: [] };
const ok = <T>(value: T): CaseClientResult<T> => ({ state: 'ready', value, replayed: false });
function row(patch: Partial<CaseRecord> = {}): CaseRecord {
  return { caseId: 'renewal-12345678-current', runId: 'run-1', employeeId: 'paula', renewalId: 'renewal-1',
    owner: { role: 'scheme-team', name: 'Scheme team' }, status: 'in-progress', reason: 'Review my renewal.',
    trigger: { type: 'employee-request' }, nextAction: 'Review the recorded remedy.', dueAt: at, openedAt: at, lastUpdatedAt: at,
    renewalDeadline: null, renewalDeadlineState: 'needs-confirmation', policyVersion: 'policy-1', version: 2, fictional: true,
    remedy: { type: 'manual-decision', decision: 'The scheme team will review a later handover.' },
    history: [{ at, actorId: 'paula', actorRole: 'employee', status: 'open', reason: 'Please check the handover date.',
      nextAction: 'Review renewal', dueAt: null, remedy: null }], ...patch };
}
const list = (cases: readonly CaseRecord[] = []) => ({ cases, asOf: at, policyVersion: 'policy-1' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const fakeClient = () => ({
  readHelp: vi.fn<CaseClient['readHelp']>().mockResolvedValue(ok(guidance)),
  readOwnCases: vi.fn<CaseClient['readOwnCases']>().mockResolvedValue(ok(list())),
  readOwnCase: vi.fn<CaseClient['readOwnCase']>().mockResolvedValue(ok({ case: row(), asOf: at, policyVersion: 'policy-1' })),
  prepareHelp: vi.fn<CaseClient['prepareHelp']>().mockImplementation(input => Object.freeze({ kind: 'request-help', input: Object.freeze({ ...input }) })),
  requestHelp: vi.fn<CaseClient['requestHelp']>().mockResolvedValue(ok({ case: row() })),
});
@Component({ imports: [HelpComponent], template: '<gcsp-help /><gcsp-help />' })
class TwoHelpBodies {}

describe('native Help body, review and current case presentation', () => {
  let state = signal<SessionState>({ status: 'ready', context });
  let client = fakeClient();
  const fixtures: ComponentFixture<unknown>[] = [];
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal('crypto', { randomUUID: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}` });
    state = signal<SessionState>({ status: 'ready', context }); client = fakeClient();
    TestBed.configureTestingModule({ imports: [HelpComponent, TwoHelpBodies], providers: [
      { provide: AuthPort, useValue: { state, signIn: vi.fn(async () => {}), retry: vi.fn(async () => {}) } },
      { provide: CaseClient, useValue: client },
    ] });
  });
  afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.destroy(); TestBed.resetTestingModule(); vi.unstubAllGlobals(); });
  const root = (f: ComponentFixture<HelpComponent>): HTMLElement => f.nativeElement as HTMLElement;
  const content = (f: ComponentFixture<HelpComponent>): string => root(f).textContent!.replace(/\s+/g, ' ').trim();
  function button(f: ComponentFixture<HelpComponent>, label: string): HTMLButtonElement {
    const found = Array.from(root(f).querySelectorAll('button')).find(b => b.textContent!.trim() === label);
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  }
  function enter(f: ComponentFixture<HelpComponent>, value: string): HTMLTextAreaElement {
    const field = root(f).querySelector('textarea')!;
    field.value = value; field.dispatchEvent(new Event('input', { bubbles: true })); f.detectChanges(); return field;
  }
  function review(f: ComponentFixture<HelpComponent>): void {
    root(f).querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); f.detectChanges();
  }
  async function mount(inputs: Partial<{ quiet: boolean; headingLevel: 1 | 2; announce: (message: string) => void }> = {}) {
    const f = TestBed.createComponent(HelpComponent); fixtures.push(f);
    for (const [name, value] of Object.entries(inputs)) f.componentRef.setInput(name, value);
    f.detectChanges(); TestBed.flushEffects();
    await vi.waitFor(() => { f.detectChanges(); expect(['empty', 'ready']).toContain(f.componentInstance.view().phase); });
    return f;
  }
  function askAndReview(f: ComponentFixture<HelpComponent>, reason = 'Please review my renewal.'): void {
    button(f, 'Ask for help').click(); enter(f, reason); review(f);
  }

  it('has one page h1, useful no-case guidance and native actions without opening a case', async () => {
    const f = await mount();
    expect(root(f).querySelectorAll('h1')).toHaveLength(1);
    expect(root(f).querySelector('h1')!.textContent).toBe('Renewal help');
    expect(content(f)).toContain('No renewal case. Help is available');
    expect(button(f, 'Ask for help').type).toBe('button');
    expect(root(f).querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1);
    expect(client.requestHelp).not.toHaveBeenCalled(); expect(client.prepareHelp).not.toHaveBeenCalled();
  });
  it('associates the native reason field, its hint and validation error, then focuses it', async () => {
    const f = await mount(); button(f, 'Ask for help').click(); f.detectChanges();
    const field = root(f).querySelector('textarea')!;
    expect(field.ownerDocument.activeElement).toBe(field);
    expect(root(f).querySelector('label')!.htmlFor).toBe(field.id);
    expect(field.maxLength).toBe(2000);
    enter(f, '  '); review(f);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    for (const id of field.getAttribute('aria-describedby')!.split(' ')) expect(field.ownerDocument.getElementById(id)).not.toBeNull();
    expect(content(f)).toContain('Describe your renewal problem in 1 to 2,000 characters.');
    expect(field.ownerDocument.activeElement).toBe(field);
    expect(client.prepareHelp).not.toHaveBeenCalled(); expect(client.requestHelp).not.toHaveBeenCalled();
  });
  it('moves focus to separate confirmation, keeps the reason literal, and cancels without POST', async () => {
    const f = await mount(); askAndReview(f, '  <strong>Not markup</strong>  ');
    const confirm = button(f, 'Confirm help request');
    expect(confirm.ownerDocument.activeElement).toBe(confirm);
    expect(content(f)).toContain('This opens a scheme-team case or adds to your existing case');
    expect(root(f).querySelector('.help-reason')!.textContent).toBe('<strong>Not markup</strong>');
    expect(root(f).querySelector('.help-reason strong')).toBeNull();
    button(f, 'Cancel').click(); f.detectChanges();
    expect(confirm.ownerDocument.activeElement).toBe(button(f, 'Ask for help'));
    expect(client.requestHelp).not.toHaveBeenCalled();
  });
  it('disables confirm/cancel while pending and focuses authoritative readback afterwards', async () => {
    const f = await mount(); askAndReview(f);
    const pending = deferred<CaseClientResult<CaseDetailValue>>(); client.requestHelp.mockReturnValueOnce(pending.promise);
    button(f, 'Confirm help request').click(); f.detectChanges();
    expect(button(f, 'Confirm help request').disabled).toBe(true); expect(button(f, 'Cancel').disabled).toBe(true);
    expect(content(f)).toContain('Saving your confirmed request.');
    expect(root(f).ownerDocument.activeElement).toBe(root(f).querySelector('[data-help-status]'));
    pending.resolve(ok({ case: row() }));
    await vi.waitFor(() => { f.detectChanges(); expect(content(f)).toContain('was recorded. Showing current cases.'); });
    expect(content(f)).toContain('In progress'); expect(client.requestHelp).toHaveBeenCalledOnce();
    expect(root(f).ownerDocument.activeElement).toBe(root(f).querySelector('[data-help-status]'));
  });
  it('renders actual owner, UK instants, calendar deadline, remedy and dated private history', async () => {
    client.readOwnCases.mockResolvedValue(ok(list([row()])));
    const f = await mount();
    const detail = root(f).querySelector(`article[data-case-id="${row().caseId}"]`)!;
    const caseFacts = detail.querySelector(':scope > gcsp-fact-list')!;
    function expectFact(list: Element, label: string, value: string): void {
      const matches = Array.from(list.querySelectorAll(':scope > dl > div'))
        .filter(fact => fact.querySelector(':scope > dt')?.textContent === label);
      expect(matches).toHaveLength(1);
      expect(Array.from(matches[0].children).map(cell => [cell.tagName, cell.textContent]))
        .toEqual([['DT', label], ['DD', value]]);
    }
    expect(content(f)).toContain('Scheme team'); expect(content(f)).not.toContain('Greg');
    expect(content(f)).toContain('14 Jul 2026, 11:00'); expect(content(f)).not.toContain('(UTC)');
    expectFact(caseFacts, 'Renewal deadline (calendar date)', 'Needs confirmation');
    expectFact(caseFacts, 'Latest update', 'Please check the handover date.');
    expect(content(f)).toContain('Proposed remedy'); expect(content(f)).toContain('The scheme team will review a later handover.');
    expect(root(f).querySelector('summary')!.textContent).toBe('Dated case history');
    const historyFacts = detail.querySelector('.help-history .help-event > gcsp-fact-list')!;
    expectFact(historyFacts, 'Actor', 'You'); expect(content(f)).not.toContain('paula-subject');
    expect(root(f).querySelectorAll('h1')).toHaveLength(1); expect(root(f).querySelector('.help-remedy h3')).not.toBeNull();
    expect(root(f).querySelector('[data-case-id]')!.getAttribute('data-case-id')).toBe(row().caseId);
    expect(content(f)).not.toMatch(/synthetic|fictional|demo/i);
  });
  it.each(['resolved', 'closed'] as const)('shows a %s case with recorded remedy and no preference confirmation control', async status => {
    client.readOwnCases.mockResolvedValue(ok(list([row({ status })])));
    const f = await mount();
    expect(content(f)).toContain('Recorded remedy');
    expect(content(f)).not.toContain('Confirm preference change');
    expect(button(f, 'Ask for help').disabled).toBe(false);
  });
  it('supports quiet Activity embedding and forwards messages with all body live regions suppressed', async () => {
    const announce = vi.fn(); const f = await mount({ quiet: true, headingLevel: 2, announce });
    expect(root(f).querySelectorAll('h1')).toHaveLength(0);
    expect(button(f, 'Get help with your renewal').classList.contains('gcsp-button-ghost')).toBe(true);
    expect(root(f).querySelectorAll('[role="status"], [role="alert"], [aria-live]')).toHaveLength(0);
    button(f, 'Get help with your renewal').click(); enter(f, 'Review my renewal.'); review(f);
    expect(root(f).querySelector('.help-confirmation h2')!.textContent).toBe('Confirm your help request');
    TestBed.flushEffects(); expect(announce).toHaveBeenCalledWith('Review your reason before confirming.');
    expect(client.requestHelp).not.toHaveBeenCalled();
  });
  it('keeps a nonquiet level-two body outline without an extra page h1', async () => {
    client.readOwnCases.mockResolvedValue(ok(list([row()])));
    const f = await mount({ headingLevel: 2 });
    expect(root(f).querySelector('h1')).toBeNull(); expect(root(f).querySelector('h2')!.textContent).toBe('Renewal help');
    expect(root(f).querySelector('.help-detail h3')!.textContent).toBe('In progress');
    expect(root(f).querySelector('.help-remedy h4')!.textContent).toBe('Proposed remedy');
  });
  it('shows honest unknown outcome, readback before retry and the identical prepared command', async () => {
    const f = await mount(); askAndReview(f);
    client.requestHelp.mockResolvedValueOnce({ state: 'failed', value: null, problem: 'timeout', writeOutcome: 'unknown' });
    button(f, 'Confirm help request').click();
    await vi.waitFor(() => { f.detectChanges(); expect(content(f)).toContain('unknown outcome'); });
    expect(content(f)).not.toContain('was recorded'); expect(content(f)).not.toContain('Retry the same help request');
    button(f, 'Check current cases').click();
    await vi.waitFor(() => { f.detectChanges(); expect(content(f)).toContain('Retry the same help request'); });
    expect(client.requestHelp).toHaveBeenCalledOnce();
    button(f, 'Retry the same help request').click();
    await vi.waitFor(() => expect(client.requestHelp).toHaveBeenCalledTimes(2));
    expect(client.requestHelp.mock.calls[1][0]).toBe(client.requestHelp.mock.calls[0][0]);
  });
  it('distinguishes acknowledged success and unavailable current case information', async () => {
    const f = await mount(); askAndReview(f);
    client.readOwnCase.mockResolvedValue({ state: 'refused', value: null, refusal: {
      status: 'unavailable', code: 'case-unavailable', reason: 'Try again later.', retryable: true } });
    button(f, 'Confirm help request').click();
    await vi.waitFor(() => { f.detectChanges(); expect(content(f)).toContain('was recorded. Current case information is unavailable'); });
    expect(root(f).querySelector('[data-case-id]')).toBeNull(); expect(client.requestHelp).toHaveBeenCalledOnce();
  });
  it('clears the reason, review and cases on denied readback without painting attached private data', async () => {
    const f = await mount(); askAndReview(f, 'Private reason.');
    client.readOwnCases.mockResolvedValueOnce({ state: 'refused', value: null, refusal: {
      status: 'forbidden', code: 'not-resource-owner', reason: 'This case is not available.', retryable: false } });
    await f.componentInstance.refresh(); f.detectChanges();
    expect(content(f)).toContain('You cannot open these cases'); expect(content(f)).not.toContain('Private reason.');
    expect(root(f).querySelector('textarea')).toBeNull(); expect(root(f).querySelector('[data-case-id]')).toBeNull();
    expect(client.requestHelp).not.toHaveBeenCalled();
  });
  it('gates all private DOM before session replacement loads another account', async () => {
    const f = await mount(); askAndReview(f, 'Private reason.');
    state.set({ status: 'ready', context: { ...context, employeeId: 'other', subject: 'other-subject' } });
    f.detectChanges();
    expect(content(f)).not.toContain('Private reason.'); expect(root(f).querySelector('textarea')).toBeNull();
    expect(client.requestHelp).not.toHaveBeenCalled();
  });
  it('keeps drafts, native control IDs and teardown separate for two Help instances', async () => {
    const f = TestBed.createComponent(TwoHelpBodies); fixtures.push(f); f.detectChanges(); TestBed.flushEffects();
    await vi.waitFor(() => { f.detectChanges(); expect((f.nativeElement as HTMLElement).querySelectorAll('[data-help-ask]')).toHaveLength(2); });
    const asks = (f.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('[data-help-ask]');
    asks[0].click(); asks[1].click(); f.detectChanges();
    const fields = (f.nativeElement as HTMLElement).querySelectorAll<HTMLTextAreaElement>('textarea');
    expect(fields).toHaveLength(2); expect(fields[0].id).not.toBe(fields[1].id);
    fields[0].value = 'First private draft'; fields[0].dispatchEvent(new Event('input', { bubbles: true })); f.detectChanges();
    expect(fields[1].value).toBe(''); expect(client.requestHelp).not.toHaveBeenCalled();
  });
});
