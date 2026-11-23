import { afterNextRender, Component, DestroyRef, ElementRef, Injector, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { CheckboxFieldComponent } from '../kit/checkbox-field.component';
import { ErrorSummaryComponent, FieldError } from '../kit/error-summary.component';
import { FactListComponent, FactRow } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { OptionListComponent } from '../kit/option-list.component';
import { SideDrawerComponent } from '../kit/side-drawer.component';
import { OfferInteractionStore } from './offer-interaction.store';
import { OfferDecisionKind } from './offer.types';
import { offerPresentationState } from './offer-view-model';

let sequence = 0;
@Component({
  selector: 'gcsp-offer-decision', standalone: true, host: { style: 'display: contents' },
  imports: [ButtonDirective, CheckboxFieldComponent, ErrorSummaryComponent, FactListComponent, LabelledFieldComponent, OptionListComponent, SideDrawerComponent],
  templateUrl: './offer-decision.component.html', styleUrl: './offer-decision.component.css',
})
export class OfferDecisionComponent {
  readonly store = inject(OfferInteractionStore);
  readonly state = this.store.state;
  readonly offer = this.store.offer;
  readonly isPending = computed(() => { const offer = this.offer(); return !!offer && offerPresentationState(offer) === 'pending'; });
  readonly prefix = `offer-decision-${++sequence}`;
  private readonly drawer = viewChild(SideDrawerComponent);
  private readonly element: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly summary = viewChild(ErrorSummaryComponent);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  readonly busy = computed(() => this.state().decision === 'sending');
  readonly decisionNote = computed(() => {
    const offer = this.offer();
    if (!offer || offer.state !== 'pending') return '';
    if (Date.parse(offer.expiresAt) <= Date.parse(offer.serverNow)) return 'Checking availability. Actions are unavailable.';
    if (this.store.canReviewAccept()) return 'Review your details and declarations before accepting.';
    if (this.store.canDecline() && !offer.availableActions.includes('accept')) return 'Acceptance is unavailable. You can still decline this offer.';
    return 'Actions depend on current server availability.';
  });
  readonly mileageTouched = signal(false);
  readonly mileageMessage = computed(() => this.mileageTouched() || this.state().mileage ? this.store.mileageError() : '');
  readonly reasonOptions = computed(() => this.state().reasons.choices.map(({ code, label }) => ({ value: code, label })));
  readonly finishes = computed(() => {
    const quote = this.offer()?.quote;
    return ['colour', 'interior'].map(key => {
      const fact = quote?.facts.facts[key];
      const value = fact ? fact.status === 'known' ? fact.value : null : key === 'colour' ? quote?.facts.display.colour : null;
      const text = Array.isArray(value) ? value.length ? value.map(item => item === null ? 'Not supplied' : String(item)).join(', ') : 'None listed' : value;
      return text ? String(text) : null;
    }).filter(Boolean).join(' · ');
  });
  readonly contactRows = computed<readonly FactRow[]>(() => {
    const contact = this.offer()?.handoff?.contact;
    return [{ label: 'Email', value: contact?.email || 'To confirm' }, { label: 'Phone', value: contact?.phone || 'To confirm' }];
  });
  readonly driverRows = computed<readonly FactRow[]>(() => {
    const driver = this.offer()?.handoff?.driver;
    return [{ label: 'Nominated driver', value: driver?.name || 'To confirm' }, { label: 'Licence number', value: driver?.licence?.displayNumber || 'To confirm' },
      { label: 'Valid until', value: this.date(driver?.licence?.validUntil) }, { label: 'Car entitlement', value: driver?.licence?.categories.includes('car') ? 'Car' : 'To confirm' }];
  });
  readonly returnRows = computed<readonly FactRow[]>(() => {
    const car = this.offer()?.handoff?.returnCar; const recorded = car?.currentOdometer;
    return [{ label: 'Contract ends', value: this.date(car?.contractEndDate) },
      { label: 'Recorded mileage', value: recorded && Number.isFinite(recorded.value) ? `${recorded.value.toLocaleString('en-GB')} ${recorded.unit}` : 'To confirm' }];
  });
  readonly feedback = computed(() => {
    const result = this.state().decision;
    if (!result) return '';
    if (result === 'sending') return 'Checking your decision. Please wait.';
    if (result.status === 'ok') return '';
    if (['unavailable', 'pending'].includes(result.status)) return 'Your decision could not be confirmed. Check the current state before trying again.';
    if (['stale-version', 'stale-run', 'conflict'].includes(result.status)) return 'The offer changed. Check the current state before deciding again.';
    if (['unauthenticated', 'denied', 'forbidden'].includes(result.status)) return 'Your decision was not confirmed. Open this offer from your signed-in account.';
    return 'Your decision was not confirmed. Check the current offer before deciding again.';
  });
  readonly acceptNote = computed(() => {
    const handoff = this.offer()?.handoff;
    if (handoff?.blocker) return ({ 'contact-required': 'Confirm your contact details with scheme support.',
      'driver-review-required': 'Confirm the driver and licence details with driver support.',
      'return-data-required': 'Confirm the old contract and expected return mileage before accepting.',
      'ordering-terms-unavailable': 'Scheme terms are unavailable. Check the offer again.' })[handoff.blocker];
    return !handoff?.driver?.name || !handoff.driver.licence?.displayNumber ? 'Confirm the driver and licence details before accepting.' : '';
  });
  readonly errors = computed<readonly FieldError[]>(() => {
    const state = this.state(); if (!state.review) return [];
    if (state.review === 'decline') return state.error ? [{ controlId: this.prefix + '-reasons', message: state.error }] : [];
    const current = this.offer(); const handoff = current?.handoff;
    const missingReturn = handoff?.mode === 'replacement' && !!this.store.mileageError();
    const unavailable = !current?.availableActions.includes('accept');
    const text = handoff?.blocker ? this.acceptNote() : unavailable ? 'Acceptance is currently unavailable. Check the current offer again.'
      : !handoff?.driver?.name || !handoff.driver.licence?.displayNumber ? this.acceptNote()
        : missingReturn ? 'Confirm the expected return mileage before accepting.' : state.error;
    if (!text || missingReturn && !this.mileageTouched() && !handoff?.blocker && !unavailable) return [];
    return [{ controlId: missingReturn && !handoff?.blocker && !unavailable ? this.prefix + '-mileage'
      : handoff?.declarations.length ? this.prefix + '-declaration-0' : this.prefix + '-terms', message: text }];
  });
  readonly announcement = computed(() => this.feedback() || this.errors().map(error => error.message).join(' '));
  readonly focusError = (id: string): void => {
    const target = this.element.nativeElement.querySelector<HTMLElement>(`#${id}`); if (!target) return;
    const control = id === this.prefix + '-reasons' ? target.querySelector<HTMLElement>('button[role="radio"][tabindex="0"]:not(:disabled)') ?? target : target;
    control.focus();
  };
  private ownsReasonFocus(active: Element | null): boolean {
    const host = this.element.nativeElement;
    return !!active && (active === host.querySelector('.gcsp-side-drawer-title')
      || active === host.querySelector(`#${this.prefix}-reason-status`)
      || !!host.querySelector(`#${this.prefix}-reasons`)?.contains(active));
  }
  constructor() {
    effect(() => { if (!this.state().review) this.drawer()?.close(false); });
    let lastError = '';
    effect(() => {
      const error = this.state().review === 'decline' ? this.state().error : '';
      if (error && error !== lastError) afterNextRender(() => {
        if (!this.destroyRef.destroyed && this.element.nativeElement.isConnected && this.state().review === 'decline' && this.state().error === error) this.summary()?.focus();
      }, { injector: this.injector });
      lastError = error;
    });
    let reasonPhase: string | undefined;
    effect(() => {
      const state = this.state(); const reasons = state.reasons;
      const phase = state.review === 'decline' ? reasons.phase : undefined;
      const changed = phase !== reasonPhase; reasonPhase = phase;
      const mayDecline = this.store.canDecline();
      if (!phase || phase === 'idle' || this.busy() || phase === 'ready' && !changed || !this.ownsReasonFocus(this.element.nativeElement.ownerDocument.activeElement)) return;
      afterNextRender(() => {
        const host = this.element.nativeElement; const document = host.ownerDocument;
        if (this.destroyRef.destroyed || !host.isConnected || this.state().review !== 'decline' || this.state().reasons !== reasons || this.busy()
          || !this.ownsReasonFocus(document.activeElement) && document.activeElement !== document.body) return;
        const target = !mayDecline ? host.querySelector<HTMLElement>('[data-offer-action="decline-cancel"]')
          : phase === 'loading' ? host.querySelector<HTMLElement>(`#${this.prefix}-reason-status`)
            : phase === 'failed' ? host.querySelector<HTMLElement>('[data-offer-action="reasons-refresh"]')
              : host.querySelector<HTMLElement>(`#${this.prefix}-reasons button[role="radio"][tabindex="0"]:not(:disabled)`);
        target?.focus();
      }, { injector: this.injector });
    });
  }
  open(kind: OfferDecisionKind, event: MouseEvent): void {
    this.store.review(kind);
    if (this.state().review === kind) { this.mileageTouched.set(false); this.drawer()?.open(event.currentTarget as HTMLElement); }
  }
  close(): void { if (!this.busy()) this.drawer()?.close(); }
  jumpToDocument(event: Event, record: 'terms' | 'driver-record' | 'return-record'): void {
    event.preventDefault();
    const target = this.element.nativeElement.querySelector<HTMLElement>(`#${this.prefix}-${record}`);
    if (!target) return;
    const terms = target.tagName === 'DETAILS';
    if (terms) (target as HTMLDetailsElement).open = true;
    const heading = target.querySelector<HTMLElement>(terms ? 'summary' : 'h3');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
    target.scrollIntoView?.({ block: 'nearest' });
  }
  date(value: string | null | undefined): string {
    return value && /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value))
      ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'To confirm';
  }
}
