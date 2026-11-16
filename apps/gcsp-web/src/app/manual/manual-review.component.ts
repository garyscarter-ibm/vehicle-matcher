import { Component, computed, input, output } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent, FactRow } from '../kit/fact-list.component';
import { MediaGalleryComponent, MediaGalleryImage } from '../kit/media-gallery.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { manualObject } from './manual.projection';
import type { ManualHandoff, ManualProjection, ManualQuote, ManualRecord } from './manual.types';

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

@Component({
  selector: 'gcsp-manual-review',
  imports: [ButtonDirective, FactListComponent, MediaGalleryComponent, ScreenIntroComponent],
  templateUrl: './manual-review.component.html', styleUrl: './manual-review.component.css',
})
export class ManualReviewComponent {
  readonly projection = input.required<ManualProjection>();
  readonly selection = input<ManualHandoff | null>(null);
  readonly busy = input(false);
  readonly canClaim = input(false);
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
