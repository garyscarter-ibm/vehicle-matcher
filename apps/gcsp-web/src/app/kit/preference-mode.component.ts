import { Component, computed, input, output, viewChild } from '@angular/core';
import { ButtonDirective } from './button.directive';
import { HelpTipDirective } from './help-tip.directive';
@Component({ selector: 'gcsp-preference-mode', imports: [ButtonDirective, HelpTipDirective], host: { style: 'display: contents' }, template: `
  <div class="gcsp-prefs-mode" data-slot="mode" [gcspHelpTip]="available() ? helpText() : ''" [helpTipId]="id() + '-same-again-help'" helpTipPlacement="below-start" [helpTipDismissOnActivate]="false" helpTipTriggers=".gcsp-prefs-info">
    <fieldset class="gcsp-prefs-mode-choices" [disabled]="disabled()"><legend class="gcsp-prefs-mode-label">Next car preference mode</legend>
      <div class="gcsp-prefs-mode-option"><input type="radio" [id]="id() + '-custom'" [name]="id() + '-mode'" value="custom" [checked]="!sameOn()" [disabled]="disabled()" (change)="toggle(false)" /><label [for]="id() + '-custom'">Set my preferences</label></div>
      <div class="gcsp-prefs-mode-option"><input type="radio" [id]="id() + '-same-again'" [name]="id() + '-mode'" value="same" [checked]="sameOn()" [disabled]="disabled() || !available()" [attr.aria-describedby]="id() + (available() ? '-same-again-help' : '-same-again-note')" (change)="toggle(true)" /><label [for]="id() + '-same-again'">Same again, please!</label></div>
    </fieldset>
    <button gcspButton variant="ghost" class="vm-btn vm-btn-ghost gcsp-prefs-info" type="button" aria-label="About Same again, please!" [attr.aria-describedby]="id() + '-same-again-help'" [hidden]="!available()"><svg class="gcsp-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16v-4" /><path d="M12 8h.01" /><path d="M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0" /></svg></button>
    <div class="gcsp-prefs-same-summary" [hidden]="!sameOn()"><h3>More like your {{ description() || 'current car' }}</h3><p class="gcsp-note">Your current car guides the search. Your custom preferences are kept for later.</p></div>
    <p class="gcsp-note gcsp-prefs-same-note" [id]="id() + '-same-again-note'" [hidden]="available()">{{ reason() === 'current-car-unidentified' ? 'Your current car details are incomplete.' : 'Add your current car to use this.' }}</p>
  </div>
` })
export class PreferenceModeComponent {
  readonly id = input.required<string>(); readonly description = input(''); readonly on = input(false); readonly available = input(true); readonly reason = input(''); readonly disabled = input(false); readonly toggled = output<boolean>();
  private readonly help = viewChild(HelpTipDirective);
  readonly sameOn = computed(() => this.on() && this.available());
  readonly helpText = computed(() => `Select this option if you just love everything about your current car, and your next best car would be another ${this.description()}`);
  toggle(on: boolean): void { if (this.disabled() || on && !this.available()) return; this.help()?.hide(); this.toggled.emit(on); }
}
