import { Component, input } from '@angular/core';
export interface FieldError { readonly controlId: string; readonly message: string }
@Component({ selector: 'gcsp-error-summary', template: `@if (errors().length) { <section class="gcsp-error-summary" role="alert" aria-labelledby="error-summary-title" tabindex="-1"><h2 id="error-summary-title">Check the following</h2><ul>@for (error of errors(); track error.controlId) { <li><a [href]="'#' + error.controlId" (click)="focusControl($event, error.controlId)">{{ error.message }}</a></li> }</ul></section> }` })
export class ErrorSummaryComponent {
  readonly errors = input<readonly FieldError[]>([]);
  focusControl(event: Event, id: string): void { const control = (event.target as HTMLElement).ownerDocument.getElementById(id); if (control) { event.preventDefault(); control.focus(); } }
}
