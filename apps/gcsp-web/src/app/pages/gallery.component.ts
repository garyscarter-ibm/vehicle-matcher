import { Component, signal } from '@angular/core';
import { PreferenceCategoryComponent } from '../kit/preference-category.component';
import { StarRatingComponent } from '../kit/star-rating.component';
import { ButtonDirective } from '../kit/button.directive';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { BuddyControlsComponent } from '../preferences/buddy-controls.component';
@Component({ selector: 'gcsp-gallery', imports: [PreferenceCategoryComponent, StarRatingComponent, ButtonDirective, ScreenIntroComponent, StatusScreenComponent, LabelledFieldComponent, ErrorSummaryComponent, BuddyControlsComponent], styleUrl: './gallery.component.css', template: `
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
    <gcsp-star-rating id="gallery-stars" [value]="rating()" (rated)="rating.set($event)" />
    <gcsp-star-rating id="gallery-stars-disabled" label="Rating unavailable while saving" [value]="3" [disabled]="true" />
    <p role="status">Your changes are not confirmed as saved. Try again or reload.</p>
  </section>
  <section class="gcsp-panel"><h2>Buddy status and actions</h2><div class="buddy-gallery">
    <gcsp-buddy-controls [buddy]="engaged" disabledReason="Preview only. Actions are not connected." />
    <gcsp-buddy-controls [buddy]="paused" disabledReason="Preview only. Actions are not connected." />
  </div></section>
` })
export class GalleryComponent {
  readonly removing = signal(false); readonly rating = signal<number | null>(4);
  readonly category = { kind: 'multi' as const, label: 'Body style', question: 'What body styles?', options: [{ value: 'saloon', label: 'Saloon' }, { value: 'estate', label: 'Estate' }] };
  readonly engaged = { state: 'engaged' as const, reason: null, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
  readonly paused = { state: 'disengaged' as const, reason: 'paused' as const, permissionVersion: 8, minimumCategories: 3, considered: 3, remaining: 0, sameAgain: false, canEngage: false };
}
