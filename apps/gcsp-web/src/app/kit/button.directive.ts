import { Directive, input } from '@angular/core';

@Directive({
  selector: 'button[gcspButton], a[gcspButton]',
  host: {
    '[class.gcsp-button]': 'presentation() === "legacy"',
    '[class.gcsp-button-ghost]': 'presentation() === "legacy" && variant() === "ghost"',
    '[class.vm-btn]': 'presentation() === "source"',
    '[class.vm-btn-primary]': 'presentation() === "source" && variant() === "primary"',
    '[class.vm-btn-ghost]': 'presentation() === "source" && variant() === "ghost"',
  },
})
export class ButtonDirective {
  readonly variant = input<'primary' | 'ghost'>('primary');
  readonly presentation = input<'legacy' | 'source'>('legacy');
}
