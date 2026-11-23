import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfferFollowupComponent } from './offer-followup.component';
import { OfferInteractionStore } from './offer-interaction.store';
import { offerScreenFixture } from './offer-screen.fixture';
import { actionableOffer, followupQuestion, savedFollowup } from './offer-interaction.fixture';

type InteractionState = ReturnType<OfferInteractionStore['state']>;
async function render(phase: InteractionState['followup']['phase'], value: InteractionState['followup']['value']) {
  const state = signal({ followup: { phase, value, answer: 'suv', error: '' } });
  const store = { state, offer: signal(offerScreenFixture('declined')), canConfirmFollowup: () => true,
    chooseAnswer: vi.fn(), refreshFollowup: vi.fn(), confirmFollowup: vi.fn(async () => {}) };
  await TestBed.configureTestingModule({ imports: [OfferFollowupComponent], providers: [provideRouter([]), { provide: OfferInteractionStore, useValue: store }] }).compileComponents();
  const fixture = TestBed.createComponent(OfferFollowupComponent); fixture.detectChanges(); await fixture.whenStable();
  return { fixture, root: fixture.nativeElement as HTMLElement, store };
}
function source(button: Element | null, ghost = false): void {
  expect(button).not.toBeNull(); expect(button!.classList.contains('vm-btn')).toBe(true);
  expect(button!.classList.contains(ghost ? 'vm-btn-ghost' : 'vm-btn-primary')).toBe(true);
  expect(button!.classList.contains('gcsp-button')).toBe(false); expect(button!.classList.contains('gcsp-button-ghost')).toBe(false);
}
afterEach(() => TestBed.resetTestingModule());
describe('OfferFollowup source action composition', () => {
  it('renders confirm and status controls through source buttons while preserving their actions', async () => {
    const { root, store } = await render('ready', followupQuestion());
    source(root.querySelector('button[type="submit"]')); source(root.querySelector('button[variant="ghost"]'), true);
    root.querySelector<HTMLButtonElement>('button[variant="ghost"]')!.click(); expect(store.refreshFollowup).toHaveBeenCalledOnce();
  });
  it('renders the uncertain retry as a source primary action', async () => {
    const { root } = await render('uncertain', followupQuestion());
    source(Array.from(root.querySelectorAll('button')).find(button => button.textContent?.includes('Retry')) ?? null);
  });
  it('renders the supplied next-offer action as a source button and emits only its selector', async () => {
    const previous = offerScreenFixture('declined'); const next = { ...actionableOffer(), offerId: 'offer-2' };
    const side = (offer: typeof previous) => ({ offer, scoreBasis: { kind: 'historical-quote' as const, briefVersion: offer.quote.briefVersion, policyVersion: offer.quote.policyVersion, quotedAt: offer.quote.quotedAt } });
    const { root, fixture } = await render('ready', { schemaVersion: 1, state: 'ready', decisionId: 'decision-1', savedChange: savedFollowup(),
      comparison: { schemaVersion: 1, currentBriefVersion: 8, requirements: [], previous: side(previous), next: side(next) } });
    const button = Array.from(root.querySelectorAll('button')).find(button => button.textContent?.includes('Open this offer'))!;
    source(button); const opened = vi.fn(); fixture.componentInstance.offerOpened.subscribe(opened); button.click(); expect(opened).toHaveBeenCalledWith('offer-2');
  });
  it('renders the confirmed Activity exit as a source anchor with the existing route', async () => {
    const { root } = await render('ready', savedFollowup()); const link = root.querySelector('a[data-followup-link="activity"]');
    source(link); expect(link?.getAttribute('href')).toBe('/activity');
  });
});
