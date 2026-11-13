import { Component } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
@Component({ selector: 'gcsp-gallery', imports: [ButtonDirective, ScreenIntroComponent, StatusScreenComponent, LabelledFieldComponent, ErrorSummaryComponent], template: `
  <gcsp-screen-intro title="Angular components" lede="Shared portal components and states." />
  <section class="gcsp-panel"><h2>Actions and fields</h2><div class="gcsp-actions"><button gcspButton type="button">Continue</button><button gcspButton variant="ghost" type="button">Back</button><button gcspButton type="button" disabled>Unavailable</button></div>
  <gcsp-error-summary [errors]="[{ controlId: 'gallery-email', message: 'Enter an email address.' }]" />
  <gcsp-labelled-field controlId="gallery-email" label="Email address" hint="Your notification address." error="Enter an email address."><input id="gallery-email" type="email" aria-describedby="gallery-email-hint gallery-email-error" aria-invalid="true" /></gcsp-labelled-field></section>
  <gcsp-status-screen title="Loading your account" message="Please wait." [busy]="true" [level]="2" />
  <gcsp-status-screen title="Account unavailable" message="Please try again." [level]="2"><button gcspButton type="button">Try again</button></gcsp-status-screen>
  <gcsp-status-screen title="Access not available" message="Your account does not have access to this page." [level]="2" />
` })
export class GalleryComponent {}
