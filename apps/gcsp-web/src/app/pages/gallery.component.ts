import { Component, signal } from '@angular/core';
import { PreferenceCategoryComponent } from '../kit/preference-category.component';
import { StarRatingComponent } from '../kit/star-rating.component';
import { ButtonDirective } from '../kit/button.directive';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { BuddyControlsComponent } from '../preferences/buddy-controls.component';
import { DataTableComponent } from '../kit/data-table.component';
import { VehicleCardComponent } from '../kit/vehicle-card.component';
import { NotificationBellComponent } from '../kit/notification-bell.component';
import { NotificationModel } from '../kit/notification-bell.types';
@Component({ selector: 'gcsp-gallery', imports: [PreferenceCategoryComponent, StarRatingComponent, ButtonDirective, ScreenIntroComponent, StatusScreenComponent, LabelledFieldComponent, ErrorSummaryComponent, BuddyControlsComponent, DataTableComponent, VehicleCardComponent, NotificationBellComponent], styleUrl: './gallery.component.css', template: `
  <gcsp-screen-intro title="Angular components" lede="Shared portal components and states." />
  <section class="gcsp-panel"><h2>GCSP notification bell</h2><div class="notification-gallery">
    @for (example of bells; track example.label) { <div class="notification-example" [class.has-panel]="example.open"><h3>{{ example.label }}</h3>
      <div gcspNotificationBell [model]="example.model" [previewOpen]="example.open" [pinned]="true" [noteMs]="2147483647"></div>
    </div> }
  </div></section>
  <section class="gcsp-panel"><h2>Actions and fields</h2><div class="gcsp-actions"><button gcspButton type="button">Continue</button><button gcspButton variant="ghost" type="button">Back</button><button gcspButton type="button" disabled>Unavailable</button></div>
  <gcsp-error-summary [errors]="[{ controlId: 'gallery-email', message: 'Enter an email address.' }]" />
  <gcsp-labelled-field controlId="gallery-email" label="Email address" hint="Your notification address." error="Enter an email address."><input id="gallery-email" type="email" aria-describedby="gallery-email-hint gallery-email-error" aria-invalid="true" /></gcsp-labelled-field></section>
  <gcsp-status-screen title="Loading your account" message="Please wait." [busy]="true" [level]="2" />
  <gcsp-status-screen title="Account unavailable" message="Please try again." [level]="2"><button gcspButton type="button">Try again</button></gcsp-status-screen>
  <gcsp-status-screen title="Access not available" message="Your account does not have access to this page." [level]="2" />
  <section class="gcsp-panel"><h2>Preference categories and current-car rating</h2><p class="gcsp-note">Native choices, independent importance, removal confirmation and disabled states.</p>
    <gcsp-preference-category id="gallery-preference" [definition]="category" [state]="{ state: 'considered', value: ['estate'], importance: 'high', exact: true }" [open]="true" [removing]="removing()" (removeRequested)="removing.set(true)" (kept)="removing.set(false)" (removed)="removing.set(false)" />
    <gcsp-preference-category id="gallery-preference-disabled" [definition]="category" [disabled]="true" />
    <gcsp-star-rating id="gallery-stars" [value]="rating()" (rated)="rating.set($event)" />
    <gcsp-star-rating id="gallery-stars-disabled" label="Rating unavailable while saving" [value]="3" [disabled]="true" />
    <p role="status">Your changes are not confirmed as saved. Try again or reload.</p>
  </section>
  <section class="gcsp-panel"><h2>Buddy status and actions</h2><div class="buddy-gallery">
    <gcsp-buddy-controls [buddy]="engaged" disabledReason="Preview only. Actions are not connected." />
    <gcsp-buddy-controls [buddy]="paused" disabledReason="Preview only. Actions are not connected." />
  </div></section>
  <section class="gcsp-panel"><h2>Case queue table</h2>
    <gcsp-data-table caption="Example renewal cases" [columns]="tableColumns" [rows]="tableRows" (opened)="tableOpened.set('Opened example case for Paula')" />
    <p role="status">{{ tableOpened() }}</p>
    <gcsp-data-table caption="Unavailable case actions" [columns]="tableColumns" [rows]="tableRows" [disabled]="true" />
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
  private readonly waitingBell: NotificationModel = { status: 'ok', waiting: 1, note: null, rows: [{ key: 'offer:gallery', kind: 'offer', waiting: true,
    title: 'Your buddy found a car', car: 'BMW i5 Touring eDrive40, Sophisto Grey', detail: 'Reserved for you. Respond by 14:00.', image: { src: '/assets/gcsp-vehicle-evidence/00419fa06ad620a42de6311039c7df679f692b7f2af52d5a7daba46cd034dc93.webp' },
    action: { label: 'View your offer', href: '/gcsp/offers/gallery', variant: 'button' } }] };
  readonly bells: readonly { label: string; open: boolean; model: NotificationModel }[] = [
    { label: 'None waiting', open: false, model: { status: 'ok', waiting: 0, rows: [], note: null } },
    { label: 'Waiting', open: false, model: this.waitingBell },
    { label: 'New offer note', open: false, model: { ...this.waitingBell, note: { id: 'gallery-note', title: 'Your buddy found a car', text: 'BMW i5 Touring. Respond by 14:00.' } } },
    { label: 'Open current offer', open: true, model: this.waitingBell },
    { label: 'Open empty', open: true, model: { status: 'ok', waiting: 0, rows: [], note: null } },
    { label: 'Open expired offer', open: true, model: { status: 'ok', waiting: 0, note: null, rows: [{ key: 'offer:expired-gallery', kind: 'offer', title: 'Your offer expired.',
      action: { label: 'View expired offer', href: '/gcsp/offers/expired-gallery', variant: 'link' } }] } },
    { label: 'Open unavailable', open: true, model: { status: 'unavailable', waiting: 0, rows: [], note: null } },
  ];
  readonly cardOpened = signal('');
  readonly tableOpened = signal('');
  readonly tableColumns = [{ key: 'employee', label: 'Employee' }, { key: 'status', label: 'Status' }, { key: 'owner', label: 'Owner' }];
  readonly tableRows = [{ id: 'gallery-paula', label: 'Paula', cells: { employee: 'Paula', status: 'Open', owner: 'Scheme team' } }];
  readonly removing = signal(false); readonly rating = signal<number | null>(4);
  readonly category = { kind: 'multi' as const, label: 'Body style', question: 'What body styles?', options: [{ value: 'saloon', label: 'Saloon' }, { value: 'estate', label: 'Estate' }] };
  readonly engaged = { state: 'engaged' as const, reason: null, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
  readonly paused = { state: 'disengaged' as const, reason: 'paused' as const, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
}
