import { Component, computed, effect, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
import { ButtonDirective } from './button.directive';
@Component({ selector: 'gcsp-preference-mode', imports: [ButtonDirective], host: { style: 'display: contents' }, template: `
  <div class="gcsp-prefs-mode" data-slot="mode" (pointerenter)="enter($event)" (pointerleave)="leave()" (focusin)="focusIn = true" (focusout)="focusOut($event)" (keydown.escape)="dismiss()">
    <p class="gcsp-help-tip gcsp-help-tip-below-start" [id]="id() + '-same-again-help'" role="tooltip" [hidden]="!visible()">Select this option if you just love everything about your current car, and your next best car would be another {{ description() }}</p>
    <fieldset class="gcsp-prefs-mode-choices" [disabled]="disabled()"><legend class="gcsp-prefs-mode-label">Next car preference mode</legend>
      <div class="gcsp-prefs-mode-option"><input type="radio" [id]="id() + '-custom'" [name]="id() + '-mode'" value="custom" [checked]="!sameOn()" [disabled]="disabled()" (change)="toggle(false)" /><label [for]="id() + '-custom'">Set my preferences</label></div>
      <div class="gcsp-prefs-mode-option"><input type="radio" [id]="id() + '-same-again'" [name]="id() + '-mode'" value="same" [checked]="sameOn()" [disabled]="disabled() || !available()" [attr.aria-describedby]="id() + (available() ? '-same-again-help' : '-same-again-note')" (change)="toggle(true)" /><label [for]="id() + '-same-again'">Same again, please!</label></div>
    </fieldset>
    <button gcspButton variant="ghost" class="vm-btn vm-btn-ghost gcsp-prefs-info" type="button" aria-label="About Same again, please!" [attr.aria-describedby]="id() + '-same-again-help'" [hidden]="!available()" (pointerenter)="hover($event)" (pointerdown)="pointerFocus = true" (keydown)="pointerFocus = false" (focus)="focusHelp()" (blur)="keyFocus = false; pointerFocus = false" (click)="activate()"><svg class="gcsp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16v-4" /><path d="M12 8h.01" /><path d="M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" /></svg></button>
    <div class="gcsp-prefs-same-summary" [hidden]="!sameOn()"><h3>More like your {{ description() || 'current car' }}</h3><p class="gcsp-note">Your current car guides the search. Your custom preferences are kept for later.</p></div>
    <p class="gcsp-note gcsp-prefs-same-note" [id]="id() + '-same-again-note'" [hidden]="available()">{{ reason() === 'current-car-unidentified' ? 'Your current car details are incomplete.' : 'Add your current car to use this.' }}</p>
  </div>
` })
export class PreferenceModeComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly id = input.required<string>(); readonly description = input(''); readonly on = input(false); readonly available = input(true); readonly reason = input(''); readonly disabled = input(false); readonly toggled = output<boolean>();
  readonly sameOn = computed(() => this.on() && this.available()); readonly visible = signal(false);
  private dismissed = false; private pointerIn = false; focusIn = false; keyFocus = false; pointerFocus = false;
  constructor() { effect(() => { if (!this.available()) this.hide(); }); }
  hide(): void { this.visible.set(false); }
  dismiss(): void { if (this.visible()) { this.dismissed = true; this.hide(); } }
  private show(): void { if (!this.dismissed && this.available()) this.visible.set(true); }
  enter(event: PointerEvent): void { if (event.pointerType !== 'touch') this.pointerIn = true; }
  hover(event: PointerEvent): void { if (event.pointerType !== 'touch') this.show(); }
  leave(): void { this.pointerIn = false; if (!this.keyFocus) this.hide(); this.release(); }
  private release(): void { if (!this.pointerIn && !this.focusIn) this.dismissed = false; }
  focusHelp(): void { if (this.pointerFocus) { this.pointerFocus = false; return; } this.keyFocus = true; this.show(); }
  focusOut(event: FocusEvent): void { if (this.element.nativeElement.contains(event.relatedTarget as Node | null)) return; this.focusIn = false; this.keyFocus = false; this.hide(); this.release(); }
  activate(): void { this.pointerFocus = false; this.dismissed = false; this.show(); }
  toggle(on: boolean): void { if (this.disabled() || on && !this.available()) return; this.hide(); this.toggled.emit(on); }
  @HostListener('document:pointerdown', ['$event']) outside(event: Event): void { if (this.visible() && !this.element.nativeElement.contains(event.target as Node)) { this.dismissed = true; this.hide(); } }
}
