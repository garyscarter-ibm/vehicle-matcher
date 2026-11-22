import { Component, computed, input } from '@angular/core';
const whole = (n: number, low: number, high: number) => Math.min(high, Math.max(low, Math.round(Number.isFinite(Number(n)) ? Number(n) : low)));
@Component({ selector: 'gcsp-understanding-meter', host: { style: 'display: contents' }, template: `
  <div class="gcsp-understanding" [id]="id()" data-kind="input-completeness" [class.is-pending]="pending()" [attr.data-value]="current()">
    <span class="gcsp-understanding-label">{{ label() }}</span><strong class="gcsp-understanding-value" [attr.aria-label]="accessibleName()">{{ current() }} / {{ top() }}</strong><span class="gcsp-understanding-meter" aria-hidden="true">@for (segment of segments(); track $index) { <i [class.is-filled]="$index < current()"></i> }</span>
  </div>
` })
export class UnderstandingMeterComponent {
  readonly id = input.required<string>(); readonly label = input('Buddy understanding'); readonly value = input(0); readonly maximum = input(11); readonly pending = input(false); readonly failed = input(false);
  readonly top = computed(() => whole(this.maximum(), 1, 99)); readonly current = computed(() => whole(this.value(), 0, this.top())); readonly segments = computed(() => Array.from({ length: this.top() }));
  readonly accessibleName = computed(() => `${this.label()} ${this.current()} out of ${this.top()}${this.pending() ? this.failed() ? ' (not saved)' : ' (saving)' : ''}`);
}
