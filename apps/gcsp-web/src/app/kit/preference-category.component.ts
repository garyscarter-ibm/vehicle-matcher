import { Component, computed, input, output } from '@angular/core';
import { AccountPreferenceCategoryState, BriefPreferenceCategory, BriefValue } from '../preferences/brief.types';
import { ButtonDirective } from './button.directive';
@Component({
  selector: 'gcsp-preference-category', imports: [ButtonDirective], styleUrl: './preference-controls.css',
  template: `<section class="preference-category" [class.considered]="state().state === 'considered'">
    <button gcspButton variant="ghost" type="button" class="category-title" [disabled]="disabled()" [attr.aria-expanded]="open()" [attr.aria-controls]="id() + '-panel'" (click)="opened.emit()">{{ definition().label }}<span>{{ summary() }}</span></button>
    @if (removing()) { <div class="removal" role="group" [attr.aria-label]="'Remove ' + definition().label + ' preference'">
      <p>Remove this preference? It will no longer count as considered.</p><button gcspButton type="button" [disabled]="disabled()" (click)="removed.emit()">Remove preference</button><button gcspButton variant="ghost" type="button" (click)="kept.emit()">Keep preference</button></div>
    }
    <div [id]="id() + '-panel'" [hidden]="!open()">
      <fieldset [disabled]="disabled()"><legend>{{ definition().question }}</legend>
        @if (definition().kind === 'multi') { @for (option of multiOptions(); track $index) {
          <label class="preference-choice"><input type="checkbox" [checked]="selected(option.value)" (change)="choose(option.value, $event)" />{{ option.label }}</label>
        } } @else { @for (stop of stops(); track stop.value) {
          <label class="preference-choice"><input type="radio" [name]="id() + '-value'" [checked]="value() === stop.value" (change)="changed.emit({ value: stop.value })" />{{ stop.label }}</label>
        } }
      </fieldset>
      @if (state().state === 'considered') { <fieldset [disabled]="disabled()"><legend>Importance</legend>
        <label class="preference-choice"><input type="radio" [name]="id() + '-importance'" [checked]="importance() === 'medium'" (change)="changed.emit({ importance: 'medium' })" />Medium importance</label>
        <label class="preference-choice"><input type="radio" [name]="id() + '-importance'" [checked]="importance() === 'high'" (change)="changed.emit({ importance: 'high' })" />High importance</label>
      </fieldset><button gcspButton variant="ghost" type="button" [disabled]="disabled()" (click)="removeRequested.emit()">Remove {{ definition().label.toLowerCase() }} preference</button> }
    </div>
  </section>`,
})
export class PreferenceCategoryComponent {
  readonly id = input.required<string>(); readonly definition = input.required<BriefPreferenceCategory>();
  readonly state = input<AccountPreferenceCategoryState>({ state: 'unset' }); readonly open = input(false); readonly removing = input(false); readonly disabled = input(false);
  readonly opened = output<void>(); readonly changed = output<{ value?: BriefValue; importance?: 'medium' | 'high' }>();
  readonly removeRequested = output<void>(); readonly removed = output<void>(); readonly kept = output<void>();
  readonly value = computed(() => { const state = this.state(); return state.state === 'considered' ? state.value : null; });
  readonly importance = computed(() => { const state = this.state(); return state.state === 'considered' ? state.importance : null; });
  readonly multiOptions = computed(() => { const d = this.definition(); return d.kind === 'multi' ? d.options : []; });
  readonly stops = computed(() => { const d = this.definition(); return d.kind === 'stops' ? d.stops : []; });
  readonly summary = computed(() => {
    const state = this.state(); if (state.state === 'unset') return 'Not important';
    const d = this.definition(); const options = d.kind === 'multi' ? d.options : d.stops;
    const selected = options.filter((option) => Array.isArray(state.value) ? state.value.includes(option.value) : option.value === state.value).map((option) => option.label);
    return `${selected.join(', ') || 'Saved preference'} · ${state.importance === 'high' ? 'High' : 'Medium'} importance`;
  });
  selected(value: BriefValue): boolean { const current = this.value(); return Array.isArray(current) ? current.includes(value) : current === value; }
  choose(value: BriefValue, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const current = this.value(); const selected: readonly BriefValue[] = Array.isArray(current) ? current : current === null ? [] : [current];
    const next = this.multiOptions().filter((option) => option.value === value ? checked : selected.includes(option.value)).map((option) => option.value);
    this.changed.emit({ value: next });
  }
}
