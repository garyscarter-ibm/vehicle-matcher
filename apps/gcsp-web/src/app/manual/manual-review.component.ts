import { afterNextRender, Component, computed, effect, ElementRef, inject, Injector, input, output } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { ErrorSummaryComponent, FieldError } from '../kit/error-summary.component';
import { FactListComponent, FactRow } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { MediaGalleryComponent, MediaGalleryImage } from '../kit/media-gallery.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { manualObject } from './manual.projection';
import type { ManualEditableDetails, ManualHandoff, ManualProjection, ManualQuote, ManualRecord } from './manual.types';

const text = (v: unknown): string | null => typeof v === 'string' && !!v.trim() ? v : null;
function shown(v: unknown): string | number | boolean | null {
  if (v == null || v === '' || manualObject(v) && v['status'] === 'unknown') return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) return v.map(shown).filter((part) => part !== null).join(', ') || null;
  if (manualObject(v) && 'value' in v) {
    const value = shown(v['value']); const unit = text(v['unit']);
    return value === null ? null : unit && unit !== 'insurance-group' ? `${value} ${unit}` : value;
  }
  return null;
}
/** Display the server-pinned snapshot only. Gallery facts cannot replace an acquired quote. */
export function manualVehicle(quote: ManualQuote | null, handoff: ManualHandoff | null = null) {
  const snapshot: ManualRecord = quote?.facts ?? handoff?.snapshot ?? {};
  const display = manualObject(snapshot['display']) ? snapshot['display'] : {};
  const facts = manualObject(snapshot['facts']) ? snapshot['facts'] : snapshot;
  const terms = quote?.terms ?? handoff?.terms ?? {};
  const name = text(display['name']) ?? 'Car name not supplied';
  const images: MediaGalleryImage[] = Array.isArray(display['images']) ? display['images'].filter(manualObject)
    .filter((image) => text(image['src'])).map((image) => ({ src: image['src'] as string,
      alt: text(image['alt']) ?? name, ...(text(image['caption']) ? { caption: image['caption'] as string } : {}) })) : [];
  if (!images.length && text(display['photo'])) images.push({ src: display['photo'] as string, alt: name });
  const rows: FactRow[] = [
    { label: 'Model', value: shown(facts['model'] ?? facts['marketingModelRange'] ?? facts['modelRange']) },
    { label: 'Body style', value: shown(facts['body'] ?? facts['bodyType']) },
    { label: 'Engine', value: shown(facts['engine']) }, { label: 'Exterior', value: shown(facts['exterior'] ?? facts['colour']) },
    { label: 'Interior', value: shown(facts['interior'] ?? facts['upholsteryCode']) },
    { label: 'Transmission', value: shown(facts['transmission']) }, { label: 'Insurance group', value: shown(facts['insuranceGroup']) },
  ];
  const allowance = manualObject(terms['allowanceInputs']) ? terms['allowanceInputs'] : {};
  const contribution = terms['contribution'];
  const termRows: FactRow[] = [{ label: 'Points per month', value: manualObject(terms['points']) && terms['points']['unit'] === 'points'
    ? shown(terms['points']['value']) : null }, { label: 'Points allowance', value: manualObject(allowance['allowance'])
    && allowance['allowance']['unit'] === 'points' ? shown(allowance['allowance']['value']) : null },
  { label: 'Contribution', value: manualObject(contribution) && typeof contribution['amount'] === 'number'
    && text(contribution['currency']) ? `${contribution['amount']} ${contribution['currency']}${text(contribution['period']) ? ` / ${contribution['period']}` : ''}` : null }];
  const orderNumber = quote ? shown(facts['orderNumber']) : handoff?.orderNumber;
  return { name, images, rows, termRows, identity: orderNumber ? `Car order ${orderNumber}` : `Car ID ${quote?.orderUuid ?? handoff?.orderUuid ?? 'not supplied'}` };
}

const detailControls: Readonly<Record<string, string>> = {
  'contact.phone': 'manual-contact-phone', 'contact.email': 'manual-contact-email',
  expectedReturnMileage: 'manual-return-mileage', specialRequirements: 'manual-special-requirements',
};

@Component({
  selector: 'gcsp-manual-review-details',
  imports: [ButtonDirective, ErrorSummaryComponent, FactListComponent, LabelledFieldComponent],
  template: `
    <section class="manual-details" aria-labelledby="manual-details-title">
      <h2 id="manual-details-title">Contact and collection</h2>
      @if (projection().reviewDetails; as snapshot) {
        <gcsp-fact-list [rows]="contextRows()" />
        <p id="manual-details-status" role="status">{{ snapshot.frozen ? 'These review details are frozen.' : detailsDirty() ? 'You have unsaved changes. Save your details before placing your order.' : snapshot.reviewDetailsVersion > 0 ? 'Your saved review details are shown below.' : 'Complete and save your review details before placing your order.' }}</p>
        @if (detailsDraft(); as draft) {
          @if (!snapshot.frozen) {
          <form id="manual-details-form" tabindex="-1" (submit)="save($event)" aria-describedby="manual-details-status">
            <gcsp-error-summary [errors]="errors()" />
            <fieldset [disabled]="!editable()">
              <legend>Your contact details</legend>
              <gcsp-labelled-field controlId="manual-contact-phone" label="Contact telephone (required)" [error]="fieldError('contact.phone')">
                <input id="manual-contact-phone" name="phone" type="tel" autocomplete="tel" required [value]="draft.contact.phone"
                  [attr.aria-invalid]="fieldError('contact.phone') ? 'true' : null" [attr.aria-describedby]="describedBy('contact.phone')" (input)="changeText('phone', $event)" />
              </gcsp-labelled-field>
              <gcsp-labelled-field controlId="manual-contact-email" label="Contact email (required)" [error]="fieldError('contact.email')">
                <input id="manual-contact-email" name="email" type="email" autocomplete="email" required [value]="draft.contact.email"
                  [attr.aria-invalid]="fieldError('contact.email') ? 'true' : null" [attr.aria-describedby]="describedBy('contact.email')" (input)="changeText('email', $event)" />
              </gcsp-labelled-field>
              @if (snapshot.mode === 'replacement') {
                <gcsp-labelled-field controlId="manual-return-mileage" label="Expected return mileage (required)" [hint]="mileageHint()" [error]="fieldError('expectedReturnMileage')">
                  <input id="manual-return-mileage" name="expectedReturnMileage" type="number" inputmode="numeric" min="0" step="1" required
                    [max]="snapshot.constraints.maximumReturnMileage" [value]="draft.expectedReturnMileage ?? ''"
                    [attr.aria-invalid]="fieldError('expectedReturnMileage') ? 'true' : null" [attr.aria-describedby]="describedBy('expectedReturnMileage', true)" (input)="changeMileage($event)" />
                </gcsp-labelled-field>
              }
              <gcsp-labelled-field controlId="manual-special-requirements" label="Special requirements (optional)" [hint]="requirementsHint()" [error]="fieldError('specialRequirements')">
                <textarea id="manual-special-requirements" name="specialRequirements" rows="3" [maxLength]="snapshot.constraints.maximumSpecialRequirements" [value]="draft.specialRequirements"
                  [attr.aria-invalid]="fieldError('specialRequirements') ? 'true' : null" [attr.aria-describedby]="describedBy('specialRequirements', true)" (input)="changeText('specialRequirements', $event)"></textarea>
              </gcsp-labelled-field>
            </fieldset>
            @if (!snapshot.frozen) { <button gcspButton type="submit" [disabled]="!editable() || !canSaveDetails()">Save review details</button> }
          </form>
          }
        }
        @if (snapshot.reviewDetailsVersion > 0) {
          <details><summary>{{ snapshot.frozen ? 'Frozen review details' : 'Saved review details' }}</summary><gcsp-fact-list [rows]="savedRows()" /></details>
        }
      } @else {
        <p id="manual-details-status" role="status">Your contact and collection details are unavailable. Check the current claim to try again.</p>
      }
    </section>
  `,
  styleUrl: './manual-review.component.css',
})
export class ManualReviewDetailsComponent {
  readonly projection = input.required<ManualProjection>();
  readonly detailsDraft = input<ManualEditableDetails | null>(null);
  readonly detailsDirty = input(false); readonly canSaveDetails = input(false);
  readonly busy = input(false); readonly resumeRequired = input(false);
  readonly detailsChange = output<ManualEditableDetails>(); readonly saveDetails = output<void>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private lastErrorKey = '';
  readonly editable = computed(() => !this.busy() && !this.resumeRequired() && this.projection().reviewDetails?.editable === true && !this.projection().order);
  readonly errors = computed<readonly FieldError[]>(() => {
    const errors = new Map<string, string[]>();
    for (const error of this.projection().failure?.reasons ?? []) {
      const controlId = (error.field === 'expectedReturnMileage' && this.projection().reviewDetails?.mode !== 'replacement'
        ? null : detailControls[error.field]) ?? 'manual-details-form';
      errors.set(controlId, [...(errors.get(controlId) ?? []), error.reason]);
    }
    return Array.from(errors, ([controlId, messages]) => ({ controlId, message: messages.join(' ') }));
  });
  readonly mileageHint = computed(() => `From 0 to ${this.projection().reviewDetails?.constraints.maximumReturnMileage} miles.`);
  readonly requirementsHint = computed(() => `Maximum ${this.projection().reviewDetails?.constraints.maximumSpecialRequirements} UTF-16 code units. Requests do not change released stock.`);
  readonly contextRows = computed<readonly FactRow[]>(() => {
    const snapshot = this.projection().reviewDetails;
    if (!snapshot) return [];
    const contract: ManualRecord = snapshot.contract ?? {}; const current: ManualRecord = snapshot.currentContract ?? {};
    return [
      { label: 'Journey', value: snapshot.mode === 'replacement' ? 'Replacement' : 'New order' },
      { label: 'Car order number', value: snapshot.orderNumber },
      { label: 'Requested collection date', value: shown(snapshot.requestedCollection.date) },
      { label: 'Collection location', value: shown(snapshot.requestedCollection.locationId) },
      { label: 'Contract option', value: shown(contract['contractOptionId']) },
      { label: 'Contract months', value: shown(contract['months']) },
      { label: 'Annual mileage', value: shown(contract['annualMileage']), unit: text(contract['mileageUnit']) ?? undefined },
      ...(snapshot.mode === 'replacement' ? [
        { label: 'Returning contract', value: snapshot.oldContractId },
        { label: 'Current car', value: shown(current['model']) },
        { label: 'Current registration', value: shown(current['registration']) },
        { label: 'Current contract ends', value: shown(current['contractEndDate']) },
      ] : []),
      { label: 'Quote', value: snapshot.quote.quoteId },
      { label: 'Draft version', value: snapshot.binding.expectedDraftVersion },
      { label: 'Reservation', value: snapshot.hold.holdId },
      { label: 'Reservation version', value: snapshot.binding.expectedHoldVersion },
    ];
  });
  readonly savedRows = computed<readonly FactRow[]>(() => {
    const snapshot = this.projection().reviewDetails; if (!snapshot || snapshot.reviewDetailsVersion < 1) return [];
    return [{ label: 'Saved review version', value: snapshot.reviewDetailsVersion },
      { label: 'Contact telephone', value: snapshot.details.contact.phone ?? null },
      { label: 'Contact email', value: snapshot.details.contact.email ?? null },
      ...(snapshot.mode === 'replacement' ? [{ label: 'Expected return mileage', value: snapshot.details.expectedReturnMileage == null ? null : `${snapshot.details.expectedReturnMileage} mi` }] : []),
      { label: 'Special requirements', value: snapshot.details.specialRequirements === '' ? 'None' : snapshot.details.specialRequirements ?? null }];
  });
  constructor() {
    effect(() => {
      const errors = this.errors(); const key = JSON.stringify(errors);
      if (errors.length && key !== this.lastErrorKey) afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.gcsp-error-summary')?.focus(), { injector: this.injector });
      this.lastErrorKey = key;
    });
  }
  fieldError(field: string): string { return (this.projection().failure?.reasons ?? []).filter((error) => error.field === field).map((error) => error.reason).join(' '); }
  describedBy(field: string, hint = false): string | null {
    const id = detailControls[field]; const ids = [hint ? `${id}-hint` : '', this.fieldError(field) ? `${id}-error` : ''].filter(Boolean);
    return ids.join(' ') || null;
  }
  changeText(field: 'phone' | 'email' | 'specialRequirements', event: Event): void {
    const draft = this.detailsDraft(); if (!draft || !this.editable()) return;
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.detailsChange.emit(field === 'specialRequirements' ? { ...draft, specialRequirements: value } : { ...draft, contact: { ...draft.contact, [field]: value } });
  }
  changeMileage(event: Event): void {
    const draft = this.detailsDraft(); if (!draft || !this.editable() || this.projection().reviewDetails?.mode !== 'replacement') return;
    const control = event.target as HTMLInputElement;
    this.detailsChange.emit({ ...draft, expectedReturnMileage: control.value === '' || !Number.isFinite(control.valueAsNumber) ? null : control.valueAsNumber });
  }
  save(event: Event): void {
    event.preventDefault();
    if (this.editable() && this.canSaveDetails() && (event.target as HTMLFormElement).reportValidity()) this.saveDetails.emit();
  }
}

@Component({
  selector: 'gcsp-manual-review',
  imports: [ButtonDirective, FactListComponent, MediaGalleryComponent, ScreenIntroComponent, ManualReviewDetailsComponent],
  templateUrl: './manual-review.component.html', styleUrl: './manual-review.component.css',
})
export class ManualReviewComponent {
  readonly projection = input.required<ManualProjection>();
  readonly selection = input<ManualHandoff | null>(null);
  readonly busy = input(false);
  readonly canClaim = input(false);
  readonly detailsDraft = input<ManualEditableDetails | null>(null);
  readonly detailsDirty = input(false); readonly canSaveDetails = input(false);
  readonly detailsChange = output<ManualEditableDetails>(); readonly saveDetails = output<void>();
  readonly claim = output<void>(); readonly continue = output<void>(); readonly resume = output<void>();
  readonly edit = output<void>(); readonly browse = output<void>(); readonly check = output<void>();
  readonly vehicle = computed(() => manualVehicle(this.projection().claim?.quote ?? null, this.projection().claim ? null : this.selection()));
  readonly quoted = computed(() => !!this.projection().claim);
  readonly hasVehicle = computed(() => this.quoted() || !!this.selection());
  readonly reservation = computed(() => {
    const claim = this.projection().claim;
    if (!claim) return 'Choosing a car does not place an order.';
    return claim.state === 'quoted' && ['preview', 'review', 'resume-required'].includes(this.projection().state)
      ? `Reserved until ${new Date(claim.hold.expiresAt).toLocaleString('en-GB', { timeZoneName: 'short' })}. Continuing does not place an order.`
      : 'Check the current reservation before continuing.';
  });
}
