import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { AccountClient } from './account.client';
import { AccountChoicesComponent } from './account-choices.component';
import { accountSnapshot, savedDraft } from './account.test-data';
import { AccountResult, JourneyIntent, ManualChoices, ManualDraft, SaveDraftCommand } from './account.types';

const intent: JourneyIntent = { mode: 'replacement', oldContractId: 'current:employee-paula', schemeId: 'choices-fs-uk', slotId: 'slot-paula' };
const complete = (): ManualChoices => ({ ...intent, driverId: 'driver:employee-paula', contractOptionId: 'six-month-8000', requestedCollectionDate: '2026-11-12',
  collectionLocationId: 'demo-collection-centre', brand: 'bmw', contact: { phone: '01632 960000', email: 'paula.mason@gcsp-demo.com' }, expectedReturnMileage: 6000, specialRequirements: '' });
const ready: SessionState = { status: 'ready', context: { subject: 'paula', employeeId: 'employee-paula', environmentId: 'dev', runId: 'run', roles: ['employee'], capabilities: [], policyVersion: 'p' } };
describe('native account choices form', () => {
  let state = signal<SessionState>(ready);
  let current = savedDraft({ choices: complete(), draftStage: 'complete' });
  const readAccount = vi.fn(); const readDraft = vi.fn(); const saveDraft = vi.fn(); const readStock = vi.fn();
  beforeEach(() => {
    state = signal<SessionState>(ready); current = savedDraft({ choices: complete(), draftStage: 'complete' });
    readAccount.mockReset().mockImplementation(async () => ({ status: 'ok', value: accountSnapshot() }));
    readDraft.mockReset().mockImplementation(async () => ({ status: 'ok', value: current }));
    saveDraft.mockReset().mockImplementation(async (command: SaveDraftCommand) => ({ status: 'ok', value: current = savedDraft({ choices: command.choices, draftStage: 'complete', draftVersion: command.expectedDraftVersion + 1 }) }));
    readStock.mockReset().mockImplementation(async () => ({ status: 'ok', value: { total: 0, decisions: [], cars: [], versions: { draft: current.draftVersion, context: current.contextVersion } } }));
    TestBed.configureTestingModule({ providers: [{ provide: AuthPort, useValue: { state, recovery: signal(null) } }, { provide: AccountClient, useValue: { readAccount, readDraft, saveDraft, readStock } }] });
  });
  async function form(draft: ManualDraft = current) {
    const fixture = TestBed.createComponent(AccountChoicesComponent);
    fixture.componentRef.setInput('account', accountSnapshot()); fixture.componentRef.setInput('savedDraft', draft); fixture.componentRef.setInput('intent', intent);
    await fixture.whenStable(); return fixture;
  }
  it('renders native associated labels and saved selections without a command', async () => {
    const fixture = await form(); const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector<HTMLSelectElement>('#choices-driverId')?.value).toBe(complete().driverId);
    expect(root.querySelector<HTMLLabelElement>('label[for="choices-phone"]')?.textContent).toContain('Contact phone');
    expect(saveDraft).not.toHaveBeenCalled();
  });
  it('saves only explicit edits with CAS, verifies readback, then checks matching availability', async () => {
    const fixture = await form(); const component = fixture.componentInstance; const next = vi.fn(); component.continueToStock.subscribe(next);
    component.update('expectedReturnMileage', 7000); await component.save(true);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(saveDraft.mock.calls[0][0]).toMatchObject({ expectedDraftVersion: 3, expectedContextVersion: current.contextVersion, choices: { expectedReturnMileage: 7000 } });
    expect(readStock).toHaveBeenCalledTimes(1); expect(next).toHaveBeenCalledTimes(1);
  });
  it('does not proceed with stale availability or replay a save', async () => {
    readStock.mockResolvedValue({ status: 'ok', value: { total: 0, decisions: [], cars: [], versions: { draft: 99, context: current.contextVersion } } });
    const fixture = await form(); const next = vi.fn(); fixture.componentInstance.continueToStock.subscribe(next);
    await fixture.componentInstance.save(true);
    expect(next).not.toHaveBeenCalled(); expect(fixture.componentInstance.reviewRequired()).toBe(true); expect(saveDraft).not.toHaveBeenCalled();
    expect(fixture.componentInstance.eligibleCount()).toBeNull();
  });
  it('retains edits after an uncertain save and requires explicit refresh/review', async () => {
    saveDraft.mockResolvedValue({ status: 'uncertain' });
    const fixture = await form(); const component = fixture.componentInstance;
    component.update('specialRequirements', 'Call on arrival'); await component.save(true); await component.save(true);
    expect(component.choices()?.specialRequirements).toBe('Call on arrival'); expect(saveDraft).toHaveBeenCalledTimes(1);
    component.acceptRefresh(false); expect(component.reviewRequired()).toBe(true);
    await component.refresh(); component.acceptRefresh(false);
    expect(component.choices()?.specialRequirements).toBe('Call on arrival'); expect(component.reviewRequired()).toBe(false);
  });
  it('requires confirmation to replace edits with a newer saved draft', async () => {
    const fixture = await form(); const component = fixture.componentInstance;
    component.update('specialRequirements', 'My edits'); current = savedDraft({ draftVersion: 5, choices: { ...complete(), specialRequirements: 'Other tab' }, draftStage: 'complete' });
    await component.refresh(); expect(component.choices()?.specialRequirements).toBe('My edits');
    component.acceptRefresh(true); expect(component.choices()?.specialRequirements).toBe('Other tab'); expect(component.draft()?.draftVersion).toBe(5);
  });
  it('clears choices and ignores late readback after account change', async () => {
    let resolve!: (value: AccountResult<ManualDraft>) => void;
    saveDraft.mockImplementation(() => new Promise<AccountResult<ManualDraft>>((done) => { resolve = done; }));
    const fixture = await form(); const component = fixture.componentInstance; const next = vi.fn(); component.continueToStock.subscribe(next);
    component.update('specialRequirements', 'Private'); const saving = component.save(true);
    state.set({ status: 'signed-out' }); await fixture.whenStable();
    expect(component.choices()).toBeNull(); expect(component.projection()).toBeNull();
    resolve({ status: 'ok', value: savedDraft({ choices: complete(), draftStage: 'complete', draftVersion: 4 }) }); await saving;
    expect(next).not.toHaveBeenCalled(); expect(readStock).not.toHaveBeenCalled();
  });
  it('restores the closed employee disclosure and read-only selected driver/licence facts', async () => {
    const fixture = await form(); const root: HTMLElement = fixture.nativeElement;
    const disclosure = root.querySelector<HTMLDetailsElement>('details');
    expect(disclosure?.open).toBe(false);
    expect(disclosure?.querySelector('summary')?.textContent).toBe('Employee details');
    expect(disclosure?.textContent).toContain('Employee facts are read-only. Contact details below are editable.');
    expect(disclosure?.textContent).toContain('Paula Mason'); expect(disclosure?.textContent).toContain('E749057');
    expect(disclosure?.querySelector('input, select, textarea')).toBeNull();
    const facts = () => root.querySelector('.gcsp-setup-source');
    expect(facts()?.textContent).toContain('Self'); expect(facts()?.textContent).toContain('MASON900000PM9XX');
    expect(facts()?.textContent).toContain('car'); expect(facts()?.textContent).toContain('2010-01-01');
    fixture.componentInstance.update('driverId', 'nominated:employee-paula'); await fixture.whenStable();
    expect(facts()?.textContent).toContain('spouse'); expect(facts()?.textContent).toContain('WARD9900000CW9XX');
    expect(facts()?.textContent).not.toContain('MASON900000PM9XX');
    fixture.componentInstance.update('driverId', ''); await fixture.whenStable();
    expect(facts()?.textContent?.trim() ?? '').toBe('');
    expect(root.querySelector<HTMLInputElement>('#choices-phone')?.readOnly).toBe(false);
  });
  it('provides the canonical support routes without submitting choices or inventing a request', async () => {
    const fixture = await form(); const root: HTMLElement = fixture.nativeElement;
    const support = vi.fn(); root.addEventListener('gcsp:support', support);
    const account = accountSnapshot(); fixture.componentRef.setInput('account', { ...account, allowance: null }); await fixture.whenStable();
    for (const [route, label, message] of [
      ['hr-support', 'Correct employee details', 'Contact HR support to correct employee details. No request has been sent.'],
      ['driver-support', 'Get help with drivers and licences', 'Contact driver support to correct driver or licence details. No request has been sent.'],
      ['scheme-support', 'Get scheme help', 'Contact scheme support to confirm your ordering details. No request has been sent.'],
    ]) {
      const button = Array.from(root.querySelectorAll('button')).find((node) => node.textContent?.trim() === label);
      expect(button, route).toBeTruthy(); button?.click(); await fixture.whenStable();
      expect((support.mock.calls.at(-1)?.[0] as CustomEvent).detail).toEqual({ route });
      expect(root.textContent).toContain(message);
    }
    expect(saveDraft).not.toHaveBeenCalled(); expect(readStock).not.toHaveBeenCalled();
  });
  it('keeps Save choices on screen with the authoritative refreshed eligible count and invalidates it on edits', async () => {
    readStock.mockImplementation(async () => ({ status: 'ok', value: { total: 3, decisions: [], carIds: ['a', 'b', 'c'],
      versions: { draft: current.draftVersion, context: current.contextVersion } } }));
    const fixture = await form(); const root: HTMLElement = fixture.nativeElement;
    const back = vi.fn(); const next = vi.fn(); fixture.componentInstance.back.subscribe(back); fixture.componentInstance.continueToStock.subscribe(next);
    fixture.componentInstance.update('specialRequirements', 'Call on arrival'); await fixture.whenStable();
    const save = Array.from(root.querySelectorAll('button')).find((node) => node.textContent?.trim() === 'Save choices');
    expect(save).toBeTruthy(); save?.click(); await fixture.whenStable();
    expect(saveDraft).toHaveBeenCalledTimes(1); expect(readStock).toHaveBeenCalledTimes(1); expect(back).not.toHaveBeenCalled(); expect(next).not.toHaveBeenCalled();
    expect(root.textContent).toContain('Availability refreshed (3 eligible cars)');
    fixture.componentInstance.updateContact('phone', '01632 960001'); await fixture.whenStable();
    expect(root.textContent).not.toContain('Availability refreshed');
    state.set({ status: 'signed-out' }); await fixture.whenStable();
    expect(root.textContent).not.toContain('Paula Mason'); expect(root.textContent).not.toContain('WARD');
  });

});
