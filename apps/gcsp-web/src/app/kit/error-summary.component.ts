import { Component, ElementRef, computed, input, viewChild } from '@angular/core';
export interface FieldError { readonly controlId: string; readonly message: string }
@Component({ selector: 'gcsp-error-summary', host: { '[class.is-source]': "presentation() === 'source'" }, styleUrl: './error-summary.component.css', template: `
  @if (presentation() === 'source' || errors().length) {
    <section #summaryRoot class="gcsp-error-summary" [attr.role]="presentation() === 'source' ? null : 'alert'"
      [attr.aria-labelledby]="headingId()" [attr.tabindex]="presentation() === 'source' ? null : -1" [hidden]="errors().length === 0">
      <h2 #summaryHeading [id]="headingId()" [class.gcsp-h2]="presentation() === 'source'" [attr.tabindex]="presentation() === 'source' ? -1 : null">{{ headingTitle() }}</h2>
      <ul [class.gcsp-error-links]="presentation() === 'source'">
        @for (error of errors(); track error.controlId) {
          <li><a [href]="'#' + error.controlId" (click)="focusControl($event, error.controlId)">{{ error.message }}</a></li>
        }
      </ul>
    </section>
  }
` })
export class ErrorSummaryComponent {
  readonly errors = input<readonly FieldError[]>([]);
  readonly presentation = input<'default' | 'source'>('default');
  readonly summaryId = input<string | undefined>();
  readonly title = input<string | undefined>();
  readonly onSelect = input<((id: string) => void) | undefined>();
  readonly headingId = computed(() => {
    const id = this.summaryId();
    if (this.presentation() === 'source' && !id) throw new TypeError('A unique summary id is required.');
    return id ? `${id}-title` : 'error-summary-title';
  });
  readonly headingTitle = computed(() => this.title() ?? (this.presentation() === 'source' ? 'Check your choices' : 'Check the following'));
  private readonly root = viewChild<ElementRef<HTMLElement>>('summaryRoot');
  private readonly heading = viewChild<ElementRef<HTMLHeadingElement>>('summaryHeading');

  focus(): void {
    if (!this.errors().length) return;
    (this.presentation() === 'source' ? this.heading() : this.root())?.nativeElement.focus();
  }

  focusControl(event: Event, id: string): void {
    const select = this.onSelect();
    if (select) { event.preventDefault(); select(id); return; }
    const control = (event.target as HTMLElement).ownerDocument.getElementById(id);
    if (this.presentation() === 'source' || control) event.preventDefault();
    control?.focus();
  }
}
