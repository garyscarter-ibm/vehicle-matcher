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
});
