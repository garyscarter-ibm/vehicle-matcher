import { Component, computed, ElementRef, inject, input, output } from '@angular/core';
import { AccountPreferenceCategoryState, BriefPreferenceCategory, BriefValue } from '../preferences/brief.types';
import { ButtonDirective } from './button.directive';
const ICONS: Record<string, readonly string[]> = {
  body: ['M3 14l2-5h14l2 5', 'M3 14h18v4H3z', 'M6 18v2', 'M18 18v2'],
  fuel: ['M5 21V4h9v17', 'M7 7h5v5H7z', 'M3 21h13', 'M14 8h3l3 3v6a2 2 0 0 1-4 0v-4'],
  sportiness: ['M4 18a9 9 0 1 1 16 0', 'M12 13l5-5', 'M7 16h10'],
  comfort: ['M7 3v9h10v8', 'M7 12l-2 7h14', 'M9 5h4v5', 'M4 21h16'],
  economy: ['M20 4C9 2 3 9 5 16c8 5 16-2 15-12Z', 'M5 20l10-10'],
  size: ['M4 5h16v14H4z', 'M7 12h10', 'M10 9l-3 3 3 3', 'M14 9l3 3-3 3'],
};
@Component({
  selector: 'gcsp-preference-category', imports: [ButtonDirective], host: { style: 'display: contents' },
  template: `
    @if (presentation() === 'all' || presentation() === 'tile') {
      <div class="gcsp-prefs-tile" [class.is-considered]="considered()" [class.is-important]="high()" [class.is-open]="open()">
        <button #tile type="button" class="gcsp-prefs-open" [id]="id() + '-tile'" [disabled]="disabled()" [attr.aria-expanded]="open()" [attr.aria-controls]="panelId() || id() + '-panel'" [attr.aria-label]="accessibleName()" (click)="opened.emit()">
          <span class="gcsp-prefs-top">@if (icon().length) { <svg class="gcsp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" focusable="false" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">@for (path of icon(); track $index) { <path [attr.d]="path" /> }</svg> }<span>{{ definition().label }}</span></span>
          <span class="gcsp-prefs-value">{{ summary() }}</span>
        </button>
        <button type="button" class="gcsp-prefs-remove" [hidden]="!considered()" [disabled]="disabled()" [attr.aria-label]="'Remove ' + definition().label + ' preference'" (click)="removeRequested.emit()">
          <svg class="gcsp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" focusable="false" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M9 6V3h6v3" /><path d="M5 6l1 15h12l1-15" /><path d="M10 10v7" /><path d="M14 10v7" /></svg>
        </button>
      </div>
    }
    @if ((presentation() === 'all' || presentation() === 'removal') && removing()) {
      <div class="gcsp-prefs-removal" role="group" [attr.aria-labelledby]="id() + '-remove-title'">
        <p [id]="id() + '-remove-title'">Remove your {{ definition().label.toLowerCase() }} preference?</p>
        <div class="gcsp-actions"><button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" [disabled]="disabled()" (click)="kept.emit()">Keep it</button><button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" [disabled]="disabled()" (click)="removed.emit()">Remove preference</button></div>
      </div>
    }
    @if ((presentation() === 'all' || presentation() === 'panel') && open()) {
      <div class="gcsp-prefs-panel" [id]="panelId() || id() + '-panel'" [class.is-important]="high()">
        <div class="gcsp-prefs-heading"><h3 [id]="id() + '-question'">{{ definition().question }}</h3><button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" [disabled]="disabled()" (click)="close()">Done</button></div>
        @if (definition().kind === 'multi') {
          <div class="vm-options gcsp-prefs-options" role="group" [attr.aria-label]="definition().question">@for (option of multiOptions(); track $index) {
            <button class="vm-option" type="button" role="checkbox" [class.is-selected]="selected(option.value)" [attr.aria-checked]="selected(option.value)" [disabled]="disabled()" (click)="choose(option.value)"><span class="vm-option-label">{{ option.label }}</span></button>
          }</div>
        } @else {
          <div class="gcsp-prefs-slider"><span class="vm-slider-value" aria-hidden="true" hidden>{{ position() }}</span>
            <input class="vm-slider-input vm-slider-single" type="range" [min]="minimum()" [max]="maximum()" [step]="step()" [value]="position()" [disabled]="disabled()" [attr.aria-label]="definition().question" [attr.aria-valuetext]="stopLabel(position())" (input)="slide($event)" />
            <div class="vm-slider-bounds" hidden><span class="vm-slider-min">{{ minimum() }}</span><span class="vm-slider-max">{{ maximum() }}</span></div>
            <div class="gcsp-prefs-stops" aria-hidden="true">@for (stop of stops(); track stop.value) { <span [class.is-current]="considered() && stop.label === stopLabel(position())">{{ stop.label }}</span> }</div>
          </div>
        }
        <div class="gcsp-prefs-importance"><div class="gcsp-check gcsp-switch" [class.is-important]="high()"><label [for]="id() + '-important'">This is really important</label><input type="checkbox" role="switch" [id]="id() + '-important'" [checked]="high()" [disabled]="!considered() || disabled()" [attr.aria-describedby]="considered() ? null : id() + '-hint'" (change)="setImportance($event)" /></div><p class="gcsp-note gcsp-prefs-hint" [id]="id() + '-hint'" [hidden]="considered()">Choose a preference first.</p></div>
      </div>
    }
  `,
})
export class PreferenceCategoryComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly id = input.required<string>(); readonly definition = input.required<BriefPreferenceCategory>();
  readonly state = input<AccountPreferenceCategoryState>({ state: 'unset' }); readonly open = input(false); readonly removing = input(false); readonly disabled = input(false);
  readonly presentation = input<'all' | 'tile' | 'panel' | 'removal'>('all'); readonly categoryKey = input(''); readonly panelId = input('');
  readonly opened = output<void>(); readonly closed = output<void>(); readonly changed = output<{ value?: BriefValue; importance?: 'medium' | 'high' }>();
  readonly removeRequested = output<void>(); readonly removed = output<void>(); readonly kept = output<void>();
  readonly value = computed(() => { const state = this.state(); return state.state === 'considered' ? state.value : null; });
  readonly importance = computed(() => { const state = this.state(); return state.state === 'considered' ? state.importance : null; });
  readonly considered = computed(() => this.state().state === 'considered'); readonly high = computed(() => this.importance() === 'high');
  readonly icon = computed(() => ICONS[this.categoryKey()] ?? []);
  readonly multiOptions = computed(() => { const d = this.definition(); return d.kind === 'multi' ? d.options : []; });
  readonly stops = computed(() => { const d = this.definition(); return d.kind === 'stops' ? d.stops : []; });
  readonly minimum = computed(() => Math.min(...this.stops().map(s => s.value)));
  readonly maximum = computed(() => Math.max(...this.stops().map(s => s.value)));
  readonly step = computed(() => Math.min(...this.stops().slice(1).map((s, i) => s.value - this.stops()[i].value)));
  readonly position = computed(() => { const d = this.definition(); return this.considered() ? Number(this.value()) : d.kind === 'stops' ? d.openDefault : 0; });
  readonly summary = computed(() => {
    if (!this.considered()) return 'Choose'; const d = this.definition();
    return d.kind === 'stops' ? this.stopLabel(Number(this.value())) : d.options.filter(o => this.selected(o.value)).map(o => o.label).join(', ');
  });
  readonly accessibleName = computed(() => this.considered() ? `${this.definition().label}, considered: ${this.summary()}${this.high() ? ', really important' : ''}` : `${this.definition().label}, choose a preference`);
  stopLabel(value: number): string { return this.stops().reduce((best, stop) => Math.abs(stop.value - value) < Math.abs(best.value - value) ? stop : best, this.stops()[0])?.label ?? ''; }
  selected(value: BriefValue): boolean { const current = this.value(); return Array.isArray(current) ? current.includes(value) : current === value; }
  choose(value: BriefValue): void {
    if (this.disabled()) return;
    const current = this.value(); const selected: readonly BriefValue[] = Array.isArray(current) ? current : current === null ? [] : [current];
    this.changed.emit({ value: this.multiOptions().filter(o => o.value === value ? !selected.includes(value) : selected.includes(o.value)).map(o => o.value) });
  }
  slide(event: Event): void {
    if (this.disabled()) return; const input = event.target as HTMLInputElement; const value = Number(input.value);
    input.setAttribute('aria-valuetext', this.stopLabel(value)); this.changed.emit({ value });
  }
  setImportance(event: Event): void { if (!this.disabled() && this.considered()) this.changed.emit({ importance: (event.target as HTMLInputElement).checked ? 'high' : 'medium' }); }
  close(): void { this.closed.emit(); this.element.nativeElement.querySelector<HTMLButtonElement>('.gcsp-prefs-open')?.focus(); }
}
