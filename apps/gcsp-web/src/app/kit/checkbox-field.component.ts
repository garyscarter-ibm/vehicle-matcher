import { Component, computed, input, output } from '@angular/core';

@Component({
  selector: 'div[gcspCheckboxField]',
  host: { class: 'gcsp-check', '[class.gcsp-switch]': 'asSwitch()' },
  template: `
    @if (asSwitch()) {
      <label [for]="inputId()">{{ label() }}</label>
      <input type="checkbox" role="switch" [id]="inputId()" [checked]="checked()" [disabled]="disabled()" [attr.aria-describedby]="describedBy() || null" (change)="onChange($event)" />
    } @else {
      <input type="checkbox" [id]="inputId()" [checked]="checked()" [disabled]="disabled()" [attr.aria-describedby]="describedBy() || null" (change)="onChange($event)" />
      <label [for]="inputId()">{{ label() }}</label>
    }
  `,
})
export class CheckboxFieldComponent {
  readonly controlId = input.required<string>();
  readonly label = input('');
  readonly checked = input(false);
  readonly disabled = input(false);
  readonly describedBy = input<string | null>(null);
  readonly asSwitch = input(false, { alias: 'switch' });
  readonly checkedChange = output<boolean>();
  readonly inputId = computed(() => {
    const id = this.controlId();
    if (!id) throw new TypeError('A unique field id is required.');
    return id;
  });

  onChange(event: Event): void {
    if (!this.disabled()) this.checkedChange.emit((event.target as HTMLInputElement).checked);
  }
}
