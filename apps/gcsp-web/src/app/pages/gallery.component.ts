import { Component, signal } from '@angular/core';
import { PreferenceModeComponent } from '../kit/preference-mode.component';
import { UnderstandingMeterComponent } from '../kit/understanding-meter.component';
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
@Component({ selector: 'gcsp-gallery', imports: [PreferenceCategoryComponent, PreferenceModeComponent, UnderstandingMeterComponent, StarRatingComponent, ButtonDirective, ScreenIntroComponent, StatusScreenComponent, LabelledFieldComponent, ErrorSummaryComponent, BuddyControlsComponent, DataTableComponent, VehicleCardComponent], styleUrl: './gallery.component.css', template: `
  <gcsp-screen-intro title="Angular components" lede="Shared portal components and states." />
  <section class="gcsp-panel"><h2>Actions and fields</h2><div class="gcsp-actions"><button gcspButton type="button">Continue</button><button gcspButton variant="ghost" type="button">Back</button><button gcspButton type="button" disabled>Unavailable</button></div>
  <gcsp-error-summary [errors]="[{ controlId: 'gallery-email', message: 'Enter an email address.' }]" />
  <gcsp-labelled-field controlId="gallery-email" label="Email address" hint="Your notification address." error="Enter an email address."><input id="gallery-email" type="email" aria-describedby="gallery-email-hint gallery-email-error" aria-invalid="true" /></gcsp-labelled-field></section>
  <gcsp-status-screen title="Loading your account" message="Please wait." [busy]="true" [level]="2" />
  <gcsp-status-screen title="Account unavailable" message="Please try again." [level]="2"><button gcspButton type="button">Try again</button></gcsp-status-screen>
  <gcsp-status-screen title="Access not available" message="Your account does not have access to this page." [level]="2" />
  <section class="gcsp-panel"><h2>Preference categories and current-car rating</h2>
    <section class="gcsp-prefs gcsp-prefs-choice" [class.is-same-again]="sameAgain()">
      <div class="gcsp-prefs-head"><h3>Category preferences</h3><div class="gcsp-prefs-understanding" data-slot="understanding"><gcsp-understanding-meter id="gallery-understanding" [value]="3" [maximum]="11" /></div></div>
      <gcsp-preference-mode id="gallery-mode" description="BMW 3 Series Touring" [on]="sameAgain()" (toggled)="sameAgain.set($event)" />
      <div [hidden]="sameAgain()"><gcsp-preference-category id="gallery-preference" categoryKey="body" [definition]="category" [state]="{ state: 'considered', value: ['estate'], importance: 'high', exact: true }" [open]="true" [removing]="removing()" (removeRequested)="removing.set(true)" (kept)="removing.set(false)" (removed)="removing.set(false)" /></div>
    </section>
    <section class="gcsp-prefs"><h3>Unset category</h3><gcsp-preference-category id="gallery-preference-unset" categoryKey="body" [definition]="category" /></section>
    <section class="gcsp-prefs"><h3>Open unset slider</h3><gcsp-preference-category id="gallery-preference-unset-slider" categoryKey="economy" [definition]="stoppedCategory" [open]="true" /></section>
    <section class="gcsp-prefs"><h3>Medium importance</h3><gcsp-preference-category id="gallery-preference-medium" categoryKey="economy" [definition]="stoppedCategory" [state]="{ state: 'considered', value: 50, importance: 'medium', exact: true }" [open]="true" /></section>
    <section class="gcsp-prefs is-disabled"><h3>Disabled categories</h3><gcsp-preference-category id="gallery-preference-disabled" categoryKey="body" [definition]="category" [state]="{ state: 'considered', value: ['estate'], importance: 'high', exact: true }" [open]="true" [disabled]="true" /></section>
    <section class="gcsp-prefs gcsp-prefs-choice"><h3>Same again unavailable</h3><gcsp-preference-mode id="gallery-mode-unavailable" [available]="false" reason="no-current-car" /></section>
    <section class="gcsp-prefs"><h3>Saving and failed save</h3><gcsp-understanding-meter id="gallery-meter-pending" [value]="6" [maximum]="11" [pending]="true" /><gcsp-understanding-meter id="gallery-meter-failed" [value]="6" [maximum]="11" [pending]="true" [failed]="true" /><p class="gcsp-prefs-status is-failed" role="status">Your changes are not confirmed as saved. Try again or reload.</p></section>
    <gcsp-star-rating id="gallery-stars" [value]="rating()" (rated)="rating.set($event)" />
    <gcsp-star-rating id="gallery-stars-disabled" label="Rating unavailable while saving" [value]="3" [disabled]="true" />
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
  readonly cardOpened = signal('');
  readonly tableOpened = signal('');
  readonly tableColumns = [{ key: 'employee', label: 'Employee' }, { key: 'status', label: 'Status' }, { key: 'owner', label: 'Owner' }];
  readonly tableRows = [{ id: 'gallery-paula', label: 'Paula', cells: { employee: 'Paula', status: 'Open', owner: 'Scheme team' } }];
  readonly sameAgain = signal(false); readonly removing = signal(false); readonly rating = signal<number | null>(4);
  readonly stoppedCategory = { kind: 'stops' as const, label: 'Economy', question: 'How economical?', openDefault: 50, stops: [{ value: 0, label: 'Less' }, { value: 50, label: 'Medium' }, { value: 100, label: 'More' }] };
  readonly category = { kind: 'multi' as const, label: 'Body style', question: 'What body styles?', options: [{ value: 'saloon', label: 'Saloon' }, { value: 'estate', label: 'Estate' }] };
  readonly engaged = { state: 'engaged' as const, reason: null, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
  readonly paused = { state: 'disengaged' as const, reason: 'paused' as const, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
}
