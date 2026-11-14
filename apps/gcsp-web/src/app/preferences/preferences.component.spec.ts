import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPort } from '../auth/auth.port';
import { routes } from '../routes';
import { reasonText } from './brief.copy';
import { BriefClient } from './brief.client';
import { AccountPreferencesComponent } from './account-preferences.component';
import { CurrentCarRatingComponent } from './current-car-rating.component';
import { PreferencesComponent } from './preferences.component';
import { briefEditorFixture, currentBriefFixture, preferenceSaveFixture, representativePreviewFixture } from './brief.fixtures';
import { PreferenceCategoryComponent } from '../kit/preference-category.component';
import { StarRatingComponent } from '../kit/star-rating.component';
describe('native preference controls', () => {
  const client = { readEditor: vi.fn(), savePreferences: vi.fn(), saveDraft: vi.fn(), confirm: vi.fn() };
  beforeEach(() => {
    client.saveDraft.mockReset(); client.confirm.mockReset();
    client.readEditor.mockReset().mockResolvedValue({ status: 'ok', value: briefEditorFixture() });
    client.savePreferences.mockReset().mockResolvedValue({ status: 'ok', value: preferenceSaveFixture() });
    TestBed.configureTestingModule({ providers: [{ provide: BriefClient, useValue: client }, { provide: AuthPort, useValue: { state: signal({ status: 'ready', context: { subject: 's', environmentId: 'dev', runId: 'r', employeeId: 'e', roles: ['employee'] } }) } }] });
  });
  it('shares compact/rating load and gates stars by the exact server current contract', async () => {
    const preferences = TestBed.createComponent(AccountPreferencesComponent); const rating = TestBed.createComponent(CurrentCarRatingComponent);
    rating.componentRef.setInput('contractId', 'different-contract'); await preferences.whenStable(); await rating.whenStable();
    expect(client.readEditor).toHaveBeenCalledTimes(1); expect(rating.nativeElement.querySelector('input')).toBeNull();
    rating.componentRef.setInput('contractId', 'contract-1'); await rating.whenStable(); expect(rating.nativeElement.querySelectorAll('input[type=radio]').length).toBe(5);
    expect(preferences.nativeElement.textContent).toContain('input completeness'); expect(preferences.nativeElement.querySelector('article')).toBeNull();
    expect(preferences.nativeElement.querySelector('gcsp-buddy-controls')).toBeTruthy();
  });
  it('disables compact native inputs during saved-status refresh while retaining visible choices', async () => {
    const preferences = TestBed.createComponent(AccountPreferencesComponent); const rating = TestBed.createComponent(CurrentCarRatingComponent);
    rating.componentRef.setInput('contractId', 'contract-1'); await preferences.whenStable(); await rating.whenStable();
    const store = preferences.componentInstance.store; store.requestRemove('economy'); await preferences.whenStable();
    let resolve!: (value: unknown) => void; client.readEditor.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const refreshing = store.reloadBuddyStatus(); await preferences.whenStable(); await rating.whenStable();
    const root = preferences.nativeElement as HTMLElement; const stars = rating.nativeElement as HTMLElement;
    expect(root.querySelector<HTMLFieldSetElement>('.preference-mode')!.disabled).toBe(true);
    root.querySelectorAll<HTMLFieldSetElement>('gcsp-preference-category fieldset').forEach((fieldset) => expect(fieldset.disabled).toBe(true));
    root.querySelectorAll<HTMLButtonElement>('.category-title, .removal button:first-of-type').forEach((button) => expect(button.disabled).toBe(true));
    expect(stars.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(true);
    expect(root.textContent).toContain('Medium · Medium importance'); expect(root.textContent).toContain('Remove this preference?');
    expect(root.querySelector<HTMLInputElement>('.preference-mode input')!.checked).toBe(true);
    resolve({ status: 'ok', value: briefEditorFixture() }); await refreshing; await preferences.whenStable(); await rating.whenStable();
    expect(root.querySelector<HTMLFieldSetElement>('.preference-mode')!.disabled).toBe(false);
    expect(stars.querySelector<HTMLFieldSetElement>('fieldset')!.disabled).toBe(false);
    expect(client.savePreferences).not.toHaveBeenCalled();
  });
  it('presents native independent preference, importance, practical and read-only fact controls', async () => {
    const fixture = TestBed.createComponent(PreferencesComponent); await fixture.whenStable(); const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#preference-economy')?.getAttribute('type')).toBe('range'); expect(root.querySelector('#importance-economy')).toBeTruthy();
    expect(root.textContent).toContain('These facts are read-only.'); expect(root.textContent).toContain('Your current-car feedback');
    expect(root.querySelectorAll('input[name=practical-seats]').length).toBe(3); expect(root.textContent).toContain('Not sure yet');
    expect(root.querySelector('gcsp-error-summary')).toBeTruthy();
  });
  it('uses native multi/stops and separate importance, with explicit removal/cancel intents', async () => {
    const fixture = TestBed.createComponent(PreferenceCategoryComponent); const definition = briefEditorFixture().context.accountPreferences.categories['body'];
    fixture.componentRef.setInput('id', 'category-body'); fixture.componentRef.setInput('definition', definition); fixture.componentRef.setInput('state', { state: 'considered', value: ['estate'], importance: 'high', exact: true }); fixture.componentRef.setInput('open', true); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement; expect(root.querySelectorAll('input[type=checkbox]').length).toBe(2); expect(root.querySelectorAll('input[type=radio]').length).toBe(2);
    const removed = vi.fn(); const kept = vi.fn(); fixture.componentInstance.removed.subscribe(removed); fixture.componentInstance.kept.subscribe(kept);
    fixture.componentRef.setInput('removing', true); await fixture.whenStable();
    const controls = root.querySelectorAll<HTMLButtonElement>('.removal button'); controls[1].click(); expect(kept).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled(); controls[0].click(); expect(removed).toHaveBeenCalledOnce();
  });
  it('gives every star a native accessible name and a clear action', async () => {
    const fixture = TestBed.createComponent(StarRatingComponent); fixture.componentRef.setInput('id', 'rating-example'); fixture.componentRef.setInput('value', 4); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement; const inputs = root.querySelectorAll<HTMLInputElement>('input'); expect(inputs.length).toBe(5); expect(inputs[3].checked).toBe(true); expect(inputs[3].closest('label')?.textContent).toContain('4 stars');
    const rated = vi.fn(); fixture.componentInstance.rated.subscribe(rated); root.querySelector<HTMLButtonElement>('button')!.click(); expect(rated).toHaveBeenCalledWith(null);
  });
  it('retains source plain-copy reasons and supplied facts without ranking or technical metadata', async () => {
    expect(reasonText({ code: 'preference-fit', field: 'comfort', score: 100 }, 'reasons')).toBe('Comfort matches your preference.');
    expect(reasonText({ code: 'preference-fit', field: 'economy', score: 20, desired: 80, observed: 20 }, 'tradeOffs')).toBe('Less economical than you prefer.');
    expect(reasonText({ code: 'unknown-provider-code' }, 'blockers')).toBe("This car does not meet one of your scheme's checks.");
    const fixture = TestBed.createComponent(PreferencesComponent); await fixture.whenStable();
    const decision = { orderUuid: 'exact-order-1', gateStatus: 'eligible' as const, reasons: [{ code: 'allowance-sufficient' }], tradeOffs: [], blockers: [], unknowns: [], versions: {}, snapshot: { display: { name: 'Server supplied car' }, facts: { fuel: { status: 'known', value: 'ev' } } }, terms: { points: { value: 400, policyVersion: 'internal-policy-marker' } } };
    fixture.componentInstance.store.preview.set({ status: 'ok', value: { state: 'recommendations', eligibleCount: 1, decisions: [decision], recommendations: [decision], versions: {} } }); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement; expect(root.textContent).toContain('Server supplied car'); expect(root.textContent).toContain('Within your points allowance.'); expect(root.textContent).toContain('Electric'); expect(root.textContent).not.toContain('internal-policy-marker');
  });
  it('renders representative source decisions with media, allowance, units and separate scheme checks', async () => {
    const fixture = TestBed.createComponent(PreferencesComponent); await fixture.whenStable();
    const source = representativePreviewFixture(); const first = source.decisions[0];
    // Source snapshot has no caption/line; exercise those optional source fields explicitly.
    const display = { ...first.snapshot!.display, line: 'M Sport Touring', images: [{ src: '/different-photo.jpg', caption: 'Do not use this caption' }, { src: first.snapshot!.display!['photo'], caption: 'Source-supplied image caption' }] };
    const decision = { ...first, snapshot: { ...first.snapshot, display } }; const preview = { ...source, decisions: [decision, source.decisions[1]] };
    fixture.componentInstance.store.preview.set({ status: 'ok', value: preview }); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement; const cards = root.querySelectorAll<HTMLElement>('.decision'); const photo = cards[0].querySelector('img')!;
    expect(photo.getAttribute('src')).toBe('/assets/brand-hero/bmw.jpg'); expect(photo.alt).toBe('BMW 320i M Sport Touring'); expect(cards[0].textContent).toContain('Source-supplied image caption'); expect(cards[0].textContent).not.toContain('Do not use this caption');
    for (const text of ['M Sport Touring', 'Points per month: 1100', 'Allowance: 1300', '500 litres', '7 s', '45 mpg']) expect(cards[0].textContent).toContain(text);
    const groups = Array.from(cards[0].querySelectorAll('.decision-reasons')); const checks = groups.find((group) => group.querySelector('h4')?.textContent === 'Scheme checks')!; const preferences = groups.find((group) => group.querySelector('h4')?.textContent === 'Why it suits you')!;
    expect(checks.textContent).toContain('Within your points allowance.'); expect(preferences.textContent).not.toContain('Within your points allowance.'); expect(preferences.textContent).toContain('Estate, the body style you prefer.');
    expect(root.textContent).toContain('1 eligible car; 1 car needs confirmation.'); expect(cards[1].textContent).toContain('No image for this car yet.');
    expect(Array.from(cards, (card) => card.querySelector('h3')?.textContent)).toEqual(source.decisions.map((item) => item.snapshot!.display!['name'])); expect(preview.decisions[0]).toEqual(decision);
    photo.dispatchEvent(new Event('error')); await fixture.whenStable(); expect(cards[0].querySelector('img')).toBeNull(); expect(cards[0].textContent).toContain('No image for this car yet.'); expect(cards[0].querySelector('figcaption')).toBeNull();
  });
  it('rejects unsafe media and allows only local paths or HTTPS', async () => {
    const fixture = TestBed.createComponent(PreferencesComponent); await fixture.whenStable(); const decision = representativePreviewFixture().decisions[0];
    for (const photo of ['//outside.example/car.jpg', 'http://outside.example/car.jpg', 'javascript:alert(1)', 'data:image/png;base64,x']) {
      const unsafe = { ...decision, snapshot: { ...decision.snapshot, display: { ...decision.snapshot!.display, photo } } };
      fixture.componentInstance.store.preview.set({ status: 'ok', value: { ...representativePreviewFixture(), decisions: [unsafe] } }); await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.decision img')).toBeNull(); expect(fixture.nativeElement.querySelector('.decision').textContent).toContain('No image for this car yet.');
    }
    expect(fixture.componentInstance.photo({ ...decision, snapshot: { display: { photo: 'https://example.com/car.jpg' } } })).toBe('https://example.com/car.jpg');
  });
  it('shows confirmation success and final readback failure together in the full editor', async () => {
    const fixture = TestBed.createComponent(PreferencesComponent); await fixture.whenStable();
    client.saveDraft.mockResolvedValue({ status: 'ok', value: { draftVersion: 3, baseBriefVersion: 4, brief: briefEditorFixture().initial.brief } }); client.confirm.mockResolvedValue({ status: 'ok', value: currentBriefFixture() }); client.readEditor.mockResolvedValueOnce({ status: 'unavailable', retryable: true });
    fixture.componentInstance.store.updatePreference('economy', { value: 88 }); await fixture.componentInstance.store.saveFull(); await fixture.whenStable();
    expect(fixture.componentInstance.store.briefVersion()).toBe(5); expect(fixture.componentInstance.store.fullState()).toBe('saved');
    const root = fixture.nativeElement as HTMLElement;
    const status = root.querySelector('.brief-form .gcsp-actions + p[role=status]')!.textContent;
    expect(status).toContain('Your preferences were confirmed. Current readback is unavailable.'); expect(status).not.toContain('not confirmed as saved');
  });
  it('keeps full-page Buddy choice as one deferred search-and-hold preference', async () => {
    const fixture = TestBed.createComponent(PreferencesComponent); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const radios = root.querySelectorAll<HTMLInputElement>('.buddy-choice input[type=radio]');
    expect(radios.length).toBe(2); radios[0].click(); await fixture.whenStable();
    expect(fixture.componentInstance.store.consent()).toEqual({ search: true, hold: true });
    expect(fixture.nativeElement.textContent).toContain('Save your preferences to apply this choice. Engaging lets Buddy search and hold a suitable car.');
    const commands = Array.from(root.querySelectorAll<HTMLButtonElement>('gcsp-buddy-controls button'));
    expect(commands.find((button) => button.textContent?.trim() === 'Engage Buddy')?.disabled).toBe(true);
    expect(client.saveDraft).not.toHaveBeenCalled(); expect(client.confirm).not.toHaveBeenCalled();
  });
  it('lazy loads the native preferences component under the existing employee guard', async () => {
    const route = routes.find((r) => r.path === 'preferences')!; expect(route.canActivate?.length).toBe(1); expect(route.data?.['roles']).toEqual(['employee']); expect(await route.loadComponent!()).toBe(PreferencesComponent);
  });
});
