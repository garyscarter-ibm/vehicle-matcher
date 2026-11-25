import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideRouter } from '@angular/router';
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
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: BriefClient, useValue: client }, { provide: AuthPort, useValue: { state: signal({ status: 'ready', context: { subject: 's', environmentId: 'dev', runId: 'r', employeeId: 'e', roles: ['employee'] } }) } }] });
  });
  it('shares compact/rating load and gates stars by the exact server current contract', async () => {
    const preferences = TestBed.createComponent(AccountPreferencesComponent); const rating = TestBed.createComponent(CurrentCarRatingComponent);
    rating.componentRef.setInput('contractId', 'different-contract'); await preferences.whenStable(); await rating.whenStable();
    expect(client.readEditor).toHaveBeenCalledTimes(1); expect(rating.nativeElement.querySelector('input')).toBeNull();
    rating.componentRef.setInput('contractId', 'contract-1'); await rating.whenStable(); expect(rating.nativeElement.querySelectorAll('input[type=radio]').length).toBe(5);
    expect(preferences.nativeElement.querySelector('[data-kind="input-completeness"]')).toBeTruthy(); expect(preferences.nativeElement.querySelector('article')).toBeNull();
    expect(preferences.nativeElement.querySelector('gcsp-buddy-controls')).toBeTruthy();
  });
  it('disables compact native inputs during saved-status refresh while retaining visible choices', async () => {
    const preferences = TestBed.createComponent(AccountPreferencesComponent); const rating = TestBed.createComponent(CurrentCarRatingComponent);
    rating.componentRef.setInput('contractId', 'contract-1'); await preferences.whenStable(); await rating.whenStable();
    const store = preferences.componentInstance.store; store.requestRemove('economy'); await preferences.whenStable();
    let resolve!: (value: unknown) => void; client.readEditor.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const refreshing = store.reloadBuddyStatus(); await preferences.whenStable(); await rating.whenStable();
    const root = preferences.nativeElement as HTMLElement; const stars = rating.nativeElement as HTMLElement;
    expect(root.querySelector<HTMLFieldSetElement>('.gcsp-prefs-mode-choices')!.disabled).toBe(true);
    const categoryControls = root.querySelectorAll<HTMLButtonElement>('gcsp-preference-category button'); expect(categoryControls.length).toBeGreaterThan(0); categoryControls.forEach(control => expect(control.disabled).toBe(true));
    root.querySelectorAll<HTMLButtonElement>('.gcsp-prefs-open, .gcsp-prefs-removal button').forEach((button) => expect(button.disabled).toBe(true));
    expect(stars.querySelectorAll<HTMLInputElement>('input')).toHaveLength(5); stars.querySelectorAll<HTMLInputElement>('input').forEach((radio) => expect(radio.disabled).toBe(true));
    expect(root.textContent).toContain('Medium'); expect(root.textContent).toContain('Remove your economy preference?');
    expect(root.querySelector<HTMLInputElement>('.gcsp-prefs-mode-choices input')!.checked).toBe(true);
    resolve({ status: 'ok', value: briefEditorFixture() }); await refreshing; await preferences.whenStable(); await rating.whenStable();
    expect(root.querySelector<HTMLFieldSetElement>('.gcsp-prefs-mode-choices')!.disabled).toBe(false);
    expect(stars.querySelectorAll<HTMLInputElement>('input')).toHaveLength(5); stars.querySelectorAll<HTMLInputElement>('input').forEach((radio) => expect(radio.disabled).toBe(false));
    expect(client.savePreferences).not.toHaveBeenCalled();
  });
  it('presents independent source preference, importance, practical and read-only fact controls', async () => {
    const fixture = TestBed.createComponent(PreferencesComponent); await fixture.whenStable(); const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#preference-economy')?.getAttribute('type')).toBe('range'); expect(root.querySelector('#importance-economy')).toBeTruthy();
    expect(root.textContent).toContain('These facts are read-only.'); expect(root.textContent).toContain('Your current-car feedback');
    expect(root.querySelectorAll('#practical-seats button[role=radio]').length).toBe(3); expect(root.textContent).toContain('Not sure yet');
    expect(root.querySelector('gcsp-error-summary')).toBeTruthy();
  });
  it('uses source chips, labelled axes and end labels without allowing empty multiple choices', async () => {
    const f = TestBed.createComponent(PreferencesComponent); await f.whenStable(); const root = f.nativeElement as HTMLElement;
    const body = root.querySelector('#preference-body')!;
    expect(body.classList.contains('vm-options')).toBe(true);
    const choices = body.querySelectorAll<HTMLButtonElement>('button[role=checkbox]'); expect(choices).toHaveLength(2);
    choices[0].click(); await f.whenStable(); expect(f.componentInstance.store.brief().preferences['body'].value).toEqual(['saloon']);
    choices[1].click(); await f.whenStable(); expect(f.componentInstance.store.brief().preferences['body'].value).toEqual(['saloon', 'estate']);
    choices[0].click(); await f.whenStable(); expect(f.componentInstance.store.brief().preferences['body'].value).toEqual(['estate']);
    expect(root.querySelectorAll('.gcsp-brief-axes')).toHaveLength(2);
    for (const text of ['Preference', 'Importance', 'Less economical', 'More economical', 'Not important', 'Very important']) expect(root.textContent).toContain(text);
    const yes = root.querySelector<HTMLButtonElement>('#practical-seats button[role=radio]')!;
    yes.click(); await f.whenStable(); expect(f.componentInstance.store.brief().essentials['seats'].value).toBe(5);
    yes.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await f.whenStable();
    expect(f.componentInstance.store.brief().essentials['seats'].value).toBeNull();
  });
  it('keeps unset axes untouched, charging choices keyboard-operable and disabled chips inert', async () => {
    const editor = briefEditorFixture(); const { economy: _economy, ...preferences } = editor.initial.brief.preferences;
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...editor, initial: { ...editor.initial, brief: { ...editor.initial.brief, preferences } } } });
    const f = TestBed.createComponent(PreferencesComponent); await f.whenStable(); const root = f.nativeElement as HTMLElement; const store = f.componentInstance.store;
    expect(root.querySelector<HTMLInputElement>('#preference-economy')?.getAttribute('aria-valuetext')).toBe('Not set');
    expect(store.brief().preferences['economy']).toBeUndefined(); expect(store.fullDirty()).toBe(false);
    const yes = root.querySelector<HTMLButtonElement>('#practical-charging button')!; yes.click(); await f.whenStable();
    expect(store.brief().essentials['charging'].value).toBeNull();
    const places = root.querySelectorAll<HTMLButtonElement>('#charging-place button'); expect(places).toHaveLength(3); expect(places[0].tabIndex).toBe(0);
    places[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await f.whenStable(); expect(store.brief().essentials['charging'].value).toBe('either');
    const before = store.brief(); store.buddyRefreshing.set(true); await f.whenStable();
    const no = root.querySelectorAll<HTMLButtonElement>('#practical-charging button')[1]; expect(no.matches(':disabled')).toBe(true); no.click();
    root.querySelectorAll<HTMLButtonElement>('#preference-body button')[1].click(); await f.whenStable(); expect(store.brief()).toBe(before);
    store.buddyRefreshing.set(false);
  });
  it('preserves source recommendation badges from supplied scores and ranking without sorting', async () => {
    const f = TestBed.createComponent(PreferencesComponent); await f.whenStable(); const component = f.componentInstance; const original = representativePreviewFixture();
    const first = { ...original.decisions[0], score: 90 }; const second = { ...original.decisions[1], gateStatus: 'eligible' as const, score: 60 };
    const preview = { ...original, decisions: [second, first], recommendations: [first] };
    expect(component.previewCard(first, preview).scoreLabel?.text).toBe('Best match'); expect(component.previewCard(second, preview).scoreLabel).toBeNull();
    const pointsAware = { ...preview, ranking: { rule: 'similarFitThenPoints' } };
    expect(component.previewCard(first, pointsAware).scoreLabel?.text).toBe('Recommended'); expect(component.previewCard(second, pointsAware).scoreLabel).toBeNull();
    const tied = { ...preview, decisions: [first, { ...second, score: 90 }] }; expect(component.previewCard(first, tied).scoreLabel).toBeNull();
    f.componentInstance.store.preview.set({ status: 'ok', value: pointsAware }); await f.whenStable();
    expect(Array.from((f.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.vm-card-explicit'), card => card.dataset['memberId'])).toEqual([second.orderUuid, first.orderUuid]);
    expect(original.decisions[0]).not.toHaveProperty('computedScore');
  });
  it('keeps the frozen editor order when Java object properties arrive reordered and retains additive definitions', async () => {
    const editor = briefEditorFixture(); const slider = editor.context.preferences['economy']; const body = editor.context.preferences['body'];
    const preferences = { size: { ...slider, label: 'Size' }, comfort: { ...slider, label: 'Comfort' }, economy: slider, sportiness: { ...slider, label: 'Sportiness' }, fuel: { ...body, label: 'Fuel' }, body, extraSlider: { ...slider, label: 'Extra slider' }, extraChoice: { ...body, label: 'Extra choice' } };
    const q = editor.context.practicalQuestions['seats'];
    const practicalQuestions = { boot: { ...q, label: 'Boot question' }, seats: q, charging: editor.context.practicalQuestions['charging'], equipment: { ...q, label: 'Equipment question' }, extraQuestion: { ...q, label: 'Extra question' } };
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...editor, context: { ...editor.context, preferences, practicalQuestions } } });
    const f = TestBed.createComponent(PreferencesComponent); await f.whenStable(); const root = f.nativeElement as HTMLElement;
    const legends = (selector: string) => Array.from(root.querySelectorAll(selector), legend => legend.textContent?.trim());
    expect(legends('.gcsp-brief-preference > legend')).toEqual(['Body style', 'Fuel', 'Extra choice', 'Sportiness', 'Comfort', 'Economy', 'Size', 'Extra slider']);
    expect(legends('.gcsp-brief-question > legend')).toEqual(['Do you need at least five seats?', 'Boot question', 'Equipment question', 'Can you charge?', 'Extra question']);
    expect(f.componentInstance.preferenceEntries(true).map(([key]) => key)).toEqual(['sportiness', 'comfort', 'economy', 'size', 'extraSlider']);
    expect(f.componentInstance.preferenceEntries(true).find(([key]) => key === 'extraSlider')?.[1]).toBe(f.componentInstance.store.editor()!.context.preferences['extraSlider']);
    expect(f.componentInstance.acceptedPreferenceRows().map(row => row.label)).toEqual(['Body style', 'Economy']);
    expect(f.componentInstance.acceptedNeedRows().map(row => row.label)).toEqual(['Do you need at least five seats?', 'Can you charge?']);
    expect(Object.keys(preferences)).toEqual(['size', 'comfort', 'economy', 'sportiness', 'fuel', 'body', 'extraSlider', 'extraChoice']);
    expect(Object.keys(practicalQuestions)).toEqual(['boot', 'seats', 'charging', 'equipment', 'extraQuestion']);
    expect(f.componentInstance.store.fullDirty()).toBe(false); expect(client.saveDraft).not.toHaveBeenCalled(); expect(client.savePreferences).not.toHaveBeenCalled();
  });
  it('offers accepted order progress only from the supplied accepted state', async () => {
    const f = TestBed.createComponent(PreferencesComponent); await f.whenStable(); const root = f.nativeElement as HTMLElement;
    expect(root.querySelector('a[href="/orders"]')).toBeNull();
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...briefEditorFixture(), selection: { state: 'accepted', briefVersion: 4 } } });
    await f.componentInstance.store.reload(); await f.whenStable();
    const onward = root.querySelector<HTMLAnchorElement>('a[href="/orders"]'); expect(onward?.textContent).toContain('See your order progress');
    expect(root.querySelector('form')).toBeNull(); expect(root.querySelector('a[href="/activity"]')).toBeNull();
    expect(root.textContent).toContain('These are your saved preferences. They are read only.');
  });
  it('offers Activity only after a clean successful save with Buddy search engaged', async () => {
    const fixture = TestBed.createComponent(PreferencesComponent); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement; const store = fixture.componentInstance.store;
    const onward = () => Array.from(root.querySelectorAll<HTMLAnchorElement>('a')).find(link => link.textContent?.trim() === 'See your buddy at work');
    expect(onward()).toBeUndefined();
    store.consent.set({ search: true, hold: true }); store.fullState.set('saved'); store.fullDirty.set(false); await fixture.whenStable();
    expect(onward()?.getAttribute('href')).toBe('/activity');
    store.fullDirty.set(true); await fixture.whenStable(); expect(onward()).toBeUndefined();
    store.fullDirty.set(false); store.consent.set({ search: false, hold: false }); await fixture.whenStable(); expect(onward()).toBeUndefined();
    store.consent.set({ search: true, hold: true }); store.fullState.set('failed'); await fixture.whenStable(); expect(onward()).toBeUndefined();
    client.readEditor.mockResolvedValueOnce({ status: 'ok', value: { ...briefEditorFixture(), selection: { state: 'accepted' } } });
    await store.reload(); store.fullState.set('saved'); store.consent.set({ search: true, hold: true });
    await fixture.whenStable(); expect(onward()).toBeUndefined();
  });
  it('uses source option buttons and an importance switch, with explicit removal/cancel intents', async () => {
    const fixture = TestBed.createComponent(PreferenceCategoryComponent); const definition = briefEditorFixture().context.accountPreferences.categories['body'];
    fixture.componentRef.setInput('id', 'category-body'); fixture.componentRef.setInput('definition', definition); fixture.componentRef.setInput('state', { state: 'considered', value: ['estate'], importance: 'high', exact: true }); fixture.componentRef.setInput('open', true); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement; expect(root.querySelectorAll('button[role=checkbox]').length).toBe(2); expect(root.querySelectorAll('input[role=switch]').length).toBe(1);
    const removed = vi.fn(); const kept = vi.fn(); fixture.componentInstance.removed.subscribe(removed); fixture.componentInstance.kept.subscribe(kept);
    fixture.componentRef.setInput('removing', true); await fixture.whenStable();
    const controls = root.querySelectorAll<HTMLButtonElement>('.gcsp-prefs-removal button'); controls[0].click(); expect(kept).toHaveBeenCalledOnce(); expect(removed).not.toHaveBeenCalled(); controls[1].click(); expect(removed).toHaveBeenCalledOnce();
  });
  it('gives every star a native accessible name and a clear action', async () => {
    const fixture = TestBed.createComponent(StarRatingComponent); fixture.componentRef.setInput('id', 'rating-example'); fixture.componentRef.setInput('value', 4); await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement; const inputs = root.querySelectorAll<HTMLInputElement>('input'); expect(inputs.length).toBe(5); expect(inputs[3].checked).toBe(true); expect(inputs[3].getAttribute('aria-label')).toBe('4 stars: I really like it');
    const rated = vi.fn(); fixture.componentInstance.rated.subscribe(rated); inputs[3].click(); expect(rated).toHaveBeenCalledWith(null);
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
    const root = fixture.nativeElement as HTMLElement; const cards = root.querySelectorAll<HTMLElement>('.vm-card-explicit'); const photo = cards[0].querySelector('img')!;
    expect(photo.getAttribute('src')).toBe('/assets/brand-hero/bmw.jpg'); expect(photo.alt).toBe('BMW 320i M Sport Touring'); expect(cards[0].textContent).toContain('Source-supplied image caption'); expect(cards[0].textContent).not.toContain('Do not use this caption');
    for (const text of ['M Sport Touring', '1,100 points a month', '1,300 points a month allowance', '500 litres', '7 s', '45 mpg']) expect(cards[0].textContent).toContain(text);
    const checks = root.querySelector('.gcsp-brief-checks')!; const preferences = cards[0].querySelector('.vm-card-decision')!;
    expect(checks.textContent).toContain('Within your points allowance.'); expect(preferences.textContent).not.toContain('Within your points allowance.'); expect(preferences.textContent).toContain('Estate, the body style you prefer.');
    expect(root.textContent).toContain('1 eligible car; 1 car needs confirmation.'); expect(cards[1].textContent).toContain('No image for this car yet');
    expect(Array.from(cards, (card) => card.querySelector('h3')?.textContent)).toEqual(source.decisions.map((item) => item.snapshot!.display!['name'])); expect(preview.decisions[0]).toEqual(decision);
    photo.dispatchEvent(new Event('error')); await fixture.whenStable(); expect(cards[0].querySelector('img')).toBeNull(); expect(cards[0].textContent).toContain('No image for this car yet'); expect(cards[0].querySelector('.vm-media-caption')).toBeNull();
  });
  it('rejects unsafe media and allows only local paths or HTTPS', async () => {
    const fixture = TestBed.createComponent(PreferencesComponent); await fixture.whenStable(); const decision = representativePreviewFixture().decisions[0];
    for (const photo of ['//outside.example/car.jpg', 'http://outside.example/car.jpg', 'javascript:alert(1)', 'data:image/png;base64,x']) {
      const unsafe = { ...decision, snapshot: { ...decision.snapshot, display: { ...decision.snapshot!.display, photo } } };
      fixture.componentInstance.store.preview.set({ status: 'ok', value: { ...representativePreviewFixture(), decisions: [unsafe] } }); await fixture.whenStable();
      expect(fixture.nativeElement.querySelector('.vm-card-explicit img')).toBeNull(); expect(fixture.nativeElement.querySelector('.vm-card-explicit').textContent).toContain('No image for this car yet');
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
  it('keeps full and compact controls usable when an older preview turns stale during the save readback (FUCQ-491)', async () => {
    let older!: (value: unknown) => void; let readback!: (value: unknown) => void;
    const preview = vi.fn().mockReturnValueOnce(new Promise((done) => { older = done; })).mockResolvedValue({ status: 'ok', value: representativePreviewFixture() }); Object.assign(client, { preview });
    const full = TestBed.createComponent(PreferencesComponent); const compact = TestBed.createComponent(AccountPreferencesComponent); await full.whenStable(); await compact.whenStable();
    const store = full.componentInstance.store; client.saveDraft.mockResolvedValue({ status: 'ok', value: { draftVersion: 3, baseBriefVersion: 4, brief: briefEditorFixture().initial.brief } }); client.confirm.mockResolvedValue({ status: 'ok', value: currentBriefFixture() });
    store.updatePreference('economy', { value: 88 }); const previewing = store.requestPreview();
    const server = briefEditorFixture(); client.readEditor.mockReturnValueOnce(new Promise((done) => { readback = done; }));
    const saving = store.saveFull(); await full.whenStable(); older({ status: 'stale-version' }); await previewing;
    readback({ status: 'ok', value: { ...server, initial: { ...server.initial, briefVersion: 5, draftVersion: 3 } } }); await saving; await full.whenStable(); await compact.whenStable();
    const root = full.nativeElement as HTMLElement; const compactRoot = compact.nativeElement as HTMLElement; const submit = root.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(store.failure()).toBeNull(); expect(submit.disabled).toBe(false); expect(submit.tabIndex).toBe(0);
    expect(root.querySelector<HTMLFieldSetElement>('fieldset.full-preference')!.disabled).toBe(false); expect(compactRoot.querySelector<HTMLFieldSetElement>('.gcsp-prefs-mode-choices')!.disabled).toBe(false);
    expect(root.textContent).toContain('Showing saved version 5.'); expect(root.textContent).not.toContain('changed elsewhere'); expect(compactRoot.textContent).not.toContain('changed elsewhere');
    Reflect.deleteProperty(client, 'preview');
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
