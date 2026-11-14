import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort, SessionState } from '../auth/auth.port';
import { PORTAL_FETCH, RuntimeConfigService, RuntimePublicConfig } from '../auth/runtime-config';
import { AccountPreferencesComponent } from '../preferences/account-preferences.component';
import { BriefEditorStore } from '../preferences/brief-editor.store';
import { briefEditorFixture } from '../preferences/brief.fixtures';
import { BriefEditor } from '../preferences/brief.types';
import { CurrentCarRatingComponent } from '../preferences/current-car-rating.component';
import { AccountClient } from './account.client';
import { AccountComponent } from './account.component';
import { accountSnapshot } from './account.test-data';
import { AccountProjection } from './account.types';

const ready = (employeeId = 'employee-paula'): SessionState => ({ status: 'ready', context: {
  subject: `subject-${employeeId}`, employeeId, environmentId: 'isolated', runId: 'run', roles: ['employee'], policyVersion: 'policy-v1', capabilities: [],
} });
const config: RuntimePublicConfig = { schemaVersion: 1, environmentId: 'isolated', apiBaseUrl: 'https://api.example/api/gcsp/v1', oidc: {
  authority: 'https://identity.example', clientId: 'public-client', scope: 'openid profile', redirectUri: 'https://portal.example/gcsp/auth/callback', postLogoutRedirectUri: 'https://portal.example/gcsp/',
} };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const editorFor = (account: AccountProjection, contractId = account.currentContract!.contractId): BriefEditor => {
  const value = briefEditorFixture();
  return { ...value, context: { ...value.context, knownFacts: { ...value.context.knownFacts, currentContract: {
    ...value.context.knownFacts['currentContract'], value: { contractId, model: account.currentContract?.model },
  } } }, initial: { ...value.initial, currentCarRating: { contractId, value: 2 }, sameAgain: { available: true, on: false, contractId } } };
};

describe('Account composition with the published preference store and HTTP contract', () => {
  let fixture: ComponentFixture<AccountComponent>;
  let account: AccountProjection;
  let editor: BriefEditor;
  let state: ReturnType<typeof signal<SessionState>>;
  let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
  let readAccount: ReturnType<typeof vi.fn>;
  const root = (): HTMLElement => fixture.nativeElement;
  const settle = async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); await fixture.whenStable(); fixture.detectChanges(); };
  const mount = async () => { fixture = TestBed.createComponent(AccountComponent); document.body.append(fixture.nativeElement); fixture.detectChanges(); await settle(); };
  const posts = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  const rate = (star: number) => root().querySelectorAll<HTMLInputElement>('.star-rating input')[star - 1].click();
  const button = (label: string) => Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find((node) => node.textContent?.trim() === label)!;

  beforeEach(() => {
    account = accountSnapshot(); editor = editorFor(account); state = signal(ready());
    readAccount = vi.fn().mockImplementation(async () => ({ status: 'ok', value: account }));
    fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (init?.method !== 'POST') return json({ status: 'ok', value: editor });
      const command = JSON.parse(String(init.body));
      editor = { ...editor, initial: { ...editor.initial, draftVersion: editor.initial.draftVersion + 1,
        currentCarRating: command.currentCarRating ?? editor.initial.currentCarRating,
        sameAgain: command.sameAgain ? { available: true, ...command.sameAgain } : editor.initial.sameAgain,
      } };
      return json({ status: 'ok', value: { ...editor.initial, buddyTransition: null } });
    });
    TestBed.configureTestingModule({ providers: [provideRouter([]),
      { provide: AuthPort, useValue: { state, getAccessToken: vi.fn().mockResolvedValue('employee-token'), signIn: vi.fn(), retry: vi.fn() } },
      { provide: RuntimeConfigService, useValue: { load: vi.fn().mockResolvedValue(config) } }, { provide: PORTAL_FETCH, useValue: fetcher },
      { provide: AccountClient, useValue: { readAccount, readDraft: vi.fn().mockResolvedValue({ status: 'not-found' }),
        readOffers: vi.fn().mockResolvedValue({ status: 'ok', value: { offers: [] } }), readOrders: vi.fn().mockResolvedValue({ status: 'ok', value: { orders: [] } }),
        readNotificationEmail: vi.fn().mockResolvedValue({ status: 'ok', value: { version: 1, deliveryEmail: null } }) } },
    ] });
  });
  afterEach(() => { fixture?.destroy(); vi.restoreAllMocks(); });

  it('shares one root editor and sends the exact displayed contract and returned revisions from native controls', async () => {
    await mount();
    const store = TestBed.inject(BriefEditorStore);
    expect(fixture.debugElement.query(By.directive(AccountPreferencesComponent)).injector.get(BriefEditorStore)).toBe(store);
    expect(fixture.debugElement.query(By.directive(CurrentCarRatingComponent)).injector.get(BriefEditorStore)).toBe(store);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(root().querySelector('.star-rating legend')?.textContent).toContain('BMW 3 Series Touring 320i');
    rate(5); await settle();
    const [url, init] = posts()[0]; const command = JSON.parse(String(init?.body));
    expect(url).toBe(`${config.apiBaseUrl}/brief/preferences`);
    expect(init?.headers).toEqual({ Accept: 'application/json', Authorization: 'Bearer employee-token', 'Content-Type': 'application/json' });
    expect(command).toEqual({ commandId: expect.any(String), expectedBriefVersion: 4, expectedDraftVersion: 2, changes: {}, currentCarRating: { contractId: account.currentContract!.contractId, value: 5 } });
    expect(store.rating()?.value).toBe(5); expect(store.draftVersion()).toBe(3);
    root().querySelectorAll<HTMLInputElement>('.preference-mode input')[1].click(); await settle();
    expect(JSON.parse(String(posts()[1][1]?.body))).toMatchObject({ expectedBriefVersion: 4, expectedDraftVersion: 3, sameAgain: { contractId: account.currentContract!.contractId, on: true } });
    expect(root().textContent).toContain('More like BMW 3 Series Touring 320i');
    fixture.destroy(); fixture = TestBed.createComponent(AccountComponent); fixture.detectChanges(); await settle();
    expect(TestBed.inject(BriefEditorStore)).toBe(store);
    expect(root().querySelectorAll<HTMLInputElement>('.preference-mode input')[1].checked).toBe(true);
    expect(fetcher.mock.calls.filter(([, request]) => request?.method === 'GET')).toHaveLength(1);
  });

  it('omits rating for a mismatched current contract and never labels Same again with another projection car', async () => {
    editor = editorFor(account, 'other-current-contract');
    await mount();
    expect(root().querySelector('.star-rating')).toBeNull();
    expect(fixture.componentInstance.preferenceCarDescription()).toBe('');
    expect(posts()).toHaveLength(0);
  });

  it('does not manufacture a rating contract for a handed-over order or incomplete account', async () => {
    account = { ...account, currentCarRelationships: [{ currentCar: { kind: 'order', orderUuid: 'delivered-order' }, oldCar: { contractId: account.currentContract!.contractId, status: 'returned' } }] };
    await mount(); expect(root().querySelector('gcsp-current-car-rating')).toBeNull(); expect(posts()).toHaveLength(0);
    account = { ...account, state: 'absent-hr-account', account: null, contracts: [], currentContract: null };
    await fixture.componentInstance.refresh(); await settle();
    expect(root().querySelector('gcsp-account-preferences')).toBeNull(); expect(root().querySelector('gcsp-current-car-rating')).toBeNull();
    expect(root().textContent).toContain('Your HR account is missing');
  });

  it('rejects the known Java editor version gap without weakening validation and permits explicit retry', async () => {
    const incomplete = structuredClone(editor) as unknown as Record<string, Record<string, unknown>>;
    delete incomplete['context']['contextVersion']; delete incomplete['versions']['context']; delete incomplete['versions']['clock'];
    fetcher.mockResolvedValueOnce(json({ status: 'ok', value: incomplete }));
    await mount(); expect(root().querySelector('.star-rating')).toBeNull(); expect(root().querySelector('.preference-mode')).toBeNull();
    expect(root().textContent).toContain('Your preferences could not be loaded. Try again.');
    expect(root().querySelector('.current-car h2')?.textContent).toContain('BMW 3 Series Touring'); expect(posts()).toHaveLength(0);
    button('Try again').click(); await settle(); expect(root().querySelector('.star-rating')).not.toBeNull();
  });

  it('retains a stale rating refusal until explicit reload restores the saved server value', async () => {
    await mount(); fetcher.mockResolvedValueOnce(json({ status: 'stale-version', resource: 'brief', currentVersion: 9 }, 409));
    rate(4); await settle();
    expect(root().querySelector<HTMLFieldSetElement>('.star-rating')?.disabled).toBe(true);
    expect(TestBed.inject(BriefEditorStore).failure()?.status).toBe('stale-version'); expect(posts()).toHaveLength(1);
    button('Reload preferences').click(); await settle();
    expect(root().querySelector<HTMLFieldSetElement>('.star-rating')?.disabled).toBe(false);
    expect(root().querySelectorAll<HTMLInputElement>('.star-rating input')[1].checked).toBe(true); expect(posts()).toHaveLength(1);
  });

  it('clears private controls on signout and ignores an old employee save after another employee signs in', async () => {
    await mount(); let finish!: (response: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    rate(5); await vi.waitFor(() => expect(posts()).toHaveLength(1));
    state.set({ status: 'signed-out' }); fixture.detectChanges();
    expect(root().querySelector('gcsp-account-preferences')).toBeNull(); expect(root().textContent).not.toContain('Paula Mason');
    const old = editor;
    account = { ...account, account: { employeeId: 'employee-casey', name: 'Casey' }, contracts: [], currentContract: null, histories: [], drivers: [], actions: [] };
    editor = { ...editor, initial: { ...editor.initial, currentCarRating: null, sameAgain: { available: false, on: false, contractId: null } } };
    state.set(ready('employee-casey')); fixture.detectChanges(); await settle();
    finish(json({ status: 'ok', value: { ...old.initial, currentCarRating: { contractId: old.initial.sameAgain.contractId, value: 5 }, buddyTransition: null } }));
    await settle();
    expect(root().textContent).toContain('Casey'); expect(root().textContent).not.toContain('Paula Mason'); expect(root().querySelector('.star-rating')).toBeNull();
    expect(TestBed.inject(BriefEditorStore).rating()).toBeNull(); expect(posts()).toHaveLength(1);
  });
});
