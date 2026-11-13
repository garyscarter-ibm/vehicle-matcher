import { Directive, input } from '@angular/core';
@Directive({ selector: 'button[gcspButton], a[gcspButton]', host: { class: 'gcsp-button', '[class.gcsp-button-ghost]': 'variant() === "ghost"' } })
export class ButtonDirective { readonly variant = input<'primary' | 'ghost'>('primary'); }
