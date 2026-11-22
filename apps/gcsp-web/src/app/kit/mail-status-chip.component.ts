import { Component, computed, input, ViewEncapsulation } from '@angular/core';

const SENT = { tone: 'ok', paths: ['M5 12.5l4.5 4.5L19 7.5'] };
const RETRYING = { tone: 'warn', paths: ['M20 12a8 8 0 1 1-2.5-5.8', 'M20 4v5h-5'] };
const FAILED = { tone: 'bad', paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M9 9l6 6', 'M15 9l-6 6'] };
const WAITING = { tone: 'wait', paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7.5V12l3 2'] };

/** The frozen messageList status chip; callers retain their delivery-truth copy. */
@Component({
  selector: 'span[gcspMailStatusChip]',
  host: { '[class]': "'gcsp-mail-status is-' + presentation().tone" },
  encapsulation: ViewEncapsulation.None,
  template: `
      <svg class="gcsp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none"
        stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        @for (path of presentation().paths; track $index) { <path [attr.d]="path" /> }
      </svg>
      <span>{{ label() }}</span>
  `,
  styleUrl: './mail-status-chip.component.css',
})
export class MailStatusChipComponent {
  readonly state = input('');
  readonly transport = input<string | null>(null);
  readonly label = input.required<string>();
  readonly presentation = computed(() => {
    switch (this.state()) {
      case 'sent': return this.transport() === 'captured' || this.transport() === 'configured' ? SENT : WAITING;
      case 'retrying': return RETRYING;
      case 'failed': return FAILED;
      default: return WAITING;
    }
  });
}
