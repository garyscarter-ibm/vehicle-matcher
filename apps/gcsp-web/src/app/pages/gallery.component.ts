import { Component, signal } from '@angular/core';
import { PreferenceCategoryComponent } from '../kit/preference-category.component';
import { StarRatingComponent } from '../kit/star-rating.component';
import { ButtonDirective } from '../kit/button.directive';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { BuddyControlsComponent } from '../preferences/buddy-controls.component';
import { DataTableComponent, DataTableColumn, DataTableRow, DataTableRowAction } from '../kit/data-table.component';
import { BuddyStatusComponent } from '../kit/buddy-status.component';
import { BuddyTileComponent } from '../kit/buddy-tile.component';
import { ActivityTimelineComponent } from '../kit/activity-timeline.component';
import { ActivityOfferComponent } from '../kit/activity-offer.component';
import { ActivityOffer, ActivityProjection, ActivityResult } from '../activity/activity.types';
import { VehicleCardComponent } from '../kit/vehicle-card.component';
const buddyPreview = (patch: Partial<ActivityProjection> = {}): ActivityProjection => ({ runId: 'gallery', employeeId: 'gallery', asOf: '2026-11-22T10:00:00Z', clockVersion: 'gallery', briefVersion: 4,
  permission: { searchConsent: true, holdConsent: true, paused: false, permissionVersion: 1, canSearch: true, canHold: true }, state: 'searching', sourceStatus: 'ok', lastSuccessfulCheck: null,
  searchEvidence: { status: 'recorded', checks: 1 }, currentOffer: null, offers: [], stateChanges: [], stateChangesEvidence: { status: 'recorded', rejectedReceipts: 0 }, ...patch });
const galleryOffer: ActivityOffer = { offerRef: { offerId: 'gallery-held' }, state: 'active', displayState: 'active', version: 1, briefVersion: 4, createdAt: '2026-11-22T09:00:00Z', expiresAt: '2026-11-23T12:00:00Z' };
const readyBuddy = (value: ActivityProjection): ActivityResult<ActivityProjection> => ({ status: 'ok', value });
@Component({ selector: 'gcsp-gallery', imports: [PreferenceCategoryComponent, StarRatingComponent, ButtonDirective, ScreenIntroComponent, StatusScreenComponent, LabelledFieldComponent, ErrorSummaryComponent, BuddyControlsComponent, DataTableComponent, VehicleCardComponent, BuddyStatusComponent, BuddyTileComponent, ActivityTimelineComponent, ActivityOfferComponent], styleUrl: './gallery.component.css', template: `
  <gcsp-screen-intro title="Angular components" lede="Shared portal components and states." />
  <section class="gcsp-panel"><h2>Actions and fields</h2><div class="gcsp-actions"><button gcspButton type="button">Continue</button><button gcspButton variant="ghost" type="button">Back</button><button gcspButton type="button" disabled>Unavailable</button></div>
  <gcsp-error-summary [errors]="[{ controlId: 'gallery-email', message: 'Enter an email address.' }]" />
  <gcsp-labelled-field controlId="gallery-email" label="Email address" hint="Your notification address." error="Enter an email address."><input id="gallery-email" type="email" aria-describedby="gallery-email-hint gallery-email-error" aria-invalid="true" /></gcsp-labelled-field></section>
  <gcsp-status-screen title="Loading your account" message="Please wait." [busy]="true" [level]="2" />
  <gcsp-status-screen title="Account unavailable" message="Please try again." [level]="2"><button gcspButton type="button">Try again</button></gcsp-status-screen>
  <gcsp-status-screen title="Access not available" message="Your account does not have access to this page." [level]="2" />
  <section class="gcsp-panel"><h2>Preference categories and current-car rating</h2><p class="gcsp-note">Native choices, independent importance, removal confirmation and disabled states.</p>
    <gcsp-preference-category id="gallery-preference" [definition]="category" [state]="{ state: 'considered', value: ['estate'], importance: 'high', exact: true }" [open]="true" [removing]="removing()" (removeRequested)="removing.set(true)" (kept)="removing.set(false)" (removed)="removing.set(false)" />
    <gcsp-preference-category id="gallery-preference-disabled" [definition]="category" [disabled]="true" />
    <gcsp-star-rating id="gallery-stars" help="How highly do you rate your current car?" [pill]="true" [value]="rating()" (rated)="rating.set($event)" />
    <gcsp-star-rating id="gallery-stars-failed" help="How highly do you rate your current car?" [pill]="true" [value]="4" status="failed" [retryable]="true" />
    <gcsp-star-rating id="gallery-stars-disabled" label="Rating unavailable while saving" [value]="3" [disabled]="true" />
    <p role="status">Your changes are not confirmed as saved. Try again or reload.</p>
  </section>
  <section class="gcsp-panel"><h2>Buddy status and actions</h2><div class="buddy-gallery">
    <gcsp-buddy-controls [buddy]="engaged" disabledReason="Preview only. Actions are not connected." />
    <gcsp-buddy-controls [buddy]="paused" disabledReason="Preview only. Actions are not connected." />
  </div></section>
  <section class="gcsp-panel"><h2>GCSP Buddy status</h2><p class="gcsp-note">Read-only source states; links demonstrate the shared outlined variant.</p>
    @for (state of buddyStates; track state) { <p><gcsp-buddy-status [state]="state" /> <gcsp-buddy-status [state]="state" href="#buddy-gallery" /></p> }
    @for (state of ['engaged', 'disengaged', 'unknown']; track state) { <gcsp-buddy-status [state]="state" [prominent]="true" /> }
  </section>
  <section id="buddy-gallery" class="gcsp-panel"><h2>GCSP Buddy tile</h2><p class="gcsp-note">Eight distinct source outcomes. Example actions are disabled.</p><div class="buddy-gallery">
    @for (tile of buddyTiles; track tile.id) { <gcsp-buddy-tile [id]="tile.id" [phase]="tile.phase" [result]="tile.result" [events]="buddyEvents" [orderHref]="tile.id === 'gallery-finished' ? '#buddy-gallery' : null" [offerTitle]="tile.id === 'gallery-held' ? 'BMW i4' : null" [deadline]="tile.id === 'gallery-held' ? 'Respond by 23 Nov 2026, 12:00' : null" /> }
  </div></section>
  <section class="gcsp-panel"><h2>GCSP activity timeline and offer</h2>
    <gcsp-activity-timeline heading="Activity history" [events]="buddyEvents" [level]="3" />
    <gcsp-activity-timeline heading="No activity yet" [events]="[]" [level]="3" />
    <gcsp-activity-offer [offer]="heldOffer" [display]="heldDisplay" [level]="3" />
  </section>
  <section class="gcsp-panel"><h2>Case queue table</h2>
    <gcsp-data-table caption="Example renewal cases" [rowAction]="tableRowAction" [stack]="true" [columns]="tableColumns" [rows]="tableRows" (opened)="tableOpened.set('Opened example case for Paula')" />
    <p role="status">{{ tableOpened() }}</p>
    <gcsp-data-table caption="Unavailable case actions" [rowAction]="tableRowAction" [stack]="true" [columns]="tableColumns" [rows]="tableRows" [disabled]="true" />
  </section>
  <section class="gcsp-panel"><h2>Canonical comparison table</h2><p class="gcsp-note">Source comparison keeps columns at narrow widths. Numeric values, missing evidence, privacy bands and the supplied winner stay distinct. No row actions are configured.</p>
    <gcsp-data-table caption="Example car comparison" [columns]="compareColumns" [rows]="compareRows" [compare]="true" [equalColumns]="true" [captionHidden]="true" />
  </section>
  <section class="gcsp-panel"><h2>Released vehicle card</h2>
    <gcsp-vehicle-card memberId="gallery-exact-stock" name="BMW 3 Series" line="Touring"
      orderNumber="0000001" [images]="[]" [points]="740" [allowance]="1000"
      eligibility="Needs confirmation" [reviewDisabled]="true"
      disabledReason="Reviewing a car is unavailable in this example."
      [facts]="[{ label: 'Exterior', value: 'Blue' }, { label: 'Interior', value: null }]"
      (action)="cardOpened.set('Vehicle details selected for the example car')" />
    <p role="status">{{ cardOpened() }}</p>
  </section>
` })
export class GalleryComponent {
  readonly buddyStates = ['active', 'inactive', 'unset', 'finished', 'unavailable', 'paused'];
  readonly buddyEvents = [{ id: 'check', occurredAt: '2026-11-22T09:30:00Z', label: 'Cars checked', detail: '3 cars checked, 0 suitable.' }, { id: 'resumed', occurredAt: '2026-11-22T09:00:00Z', label: 'Search resumed' }];
  readonly heldOffer = galleryOffer;
  readonly heldDisplay = { offerRef: galleryOffer.offerRef, state: 'active' as const, version: 1, title: 'BMW i4', images: [{ src: '/assets/gcsp-vehicle-evidence/fb2fe89a07cdc8129d0ff56747671006ce0e72380991af3e81e6c59b23f69afe.webp', alt: 'BMW i4 representative configuration', kind: 'representative-configuration', caption: 'Representative configuration' }] };
  readonly buddyTiles: readonly { id: string; phase: string; result: ActivityResult<ActivityProjection> | null }[] = [
    { id: 'gallery-loading', phase: 'loading', result: null },
    { id: 'gallery-unset', phase: 'ready', result: readyBuddy(buddyPreview({ permission: null, state: 'no-brief' })) },
    { id: 'gallery-inactive', phase: 'ready', result: readyBuddy(buddyPreview({ permission: { searchConsent: false, holdConsent: false, paused: false, permissionVersion: 2, canSearch: false, canHold: false } })) },
    { id: 'gallery-active', phase: 'ready', result: readyBuddy(buddyPreview()) },
    { id: 'gallery-paused', phase: 'ready', result: readyBuddy(buddyPreview({ permission: { searchConsent: true, holdConsent: true, paused: true, permissionVersion: 2, canSearch: false, canHold: false } })) },
    { id: 'gallery-held', phase: 'ready', result: readyBuddy(buddyPreview({ currentOffer: galleryOffer, state: 'offer' })) },
    { id: 'gallery-unavailable', phase: 'unavailable', result: { status: 'unavailable' } },
    { id: 'gallery-finished', phase: 'ready', result: readyBuddy(buddyPreview({ currentOffer: { ...galleryOffer, state: 'accepted', displayState: 'accepted' } })) },
  ];
  readonly cardOpened = signal('');
  readonly tableOpened = signal('');
  readonly tableRowAction: DataTableRowAction = { header: 'Action', label: 'Open', name: row => `Open case for ${row.label}` };
  readonly compareColumns: readonly DataTableColumn[] = [{ key: 'metric', label: 'Measure' }, { key: 'first', label: 'Car one', numeric: true, detail: 'Current configuration' }, { key: 'second', label: 'Car two', numeric: true, detail: 'Alternative configuration' }];
  readonly compareRows: readonly DataTableRow[] = [
    { id: 'gallery-points', label: 'Points', cells: { metric: 'Points per month', first: 1200, second: { label: '1,100', winner: true } } },
    { id: 'gallery-band', label: 'Privacy band', cells: { metric: 'Matching employees', first: { label: 'Fewer than five', isBand: true, fewerThan: 5 }, second: { label: 'Not recorded', missing: true } } },
    { id: 'gallery-status', label: 'Status', cells: { metric: 'Status', first: { label: 'Current car', emphasis: true, tone: 'success' }, second: null } },
  ];
  readonly tableColumns = [{ key: 'employee', label: 'Employee' }, { key: 'status', label: 'Status' }, { key: 'owner', label: 'Owner' }];
  readonly tableRows = [{ id: 'gallery-paula', label: 'Paula', cells: { employee: 'Paula', status: 'Open', owner: 'Scheme team' } }];
  readonly removing = signal(false); readonly rating = signal<number | null>(4);
  readonly category = { kind: 'multi' as const, label: 'Body style', question: 'What body styles?', options: [{ value: 'saloon', label: 'Saloon' }, { value: 'estate', label: 'Estate' }] };
  readonly engaged = { state: 'engaged' as const, reason: null, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
  readonly paused = { state: 'disengaged' as const, reason: 'paused' as const, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
}
