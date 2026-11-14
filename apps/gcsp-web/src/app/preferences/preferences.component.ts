import { NgTemplateOutlet } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { choiceLabel, reasonText } from './brief.copy';
import { BriefEditorStore } from './brief-editor.store';
import { BriefDecision, BriefPreview, BriefValue, PracticalQuestion } from './brief.types';
@Component({ selector: 'gcsp-preferences', imports: [NgTemplateOutlet, ButtonDirective, ScreenIntroComponent, StatusScreenComponent, LabelledFieldComponent, ErrorSummaryComponent], templateUrl: './preferences.component.html', styleUrl: './preferences.component.css' })
export class PreferencesComponent {
  readonly store = inject(BriefEditorStore); readonly replace = signal(false); readonly chargingOpen = signal(false);
  constructor() {
    effect((cleanup) => {
      const brief = this.store.brief(); const editor = this.store.editor(); const blocked = this.store.queueBusy() || this.store.fullBusy() || this.store.locked();
      if (!editor || blocked || !brief) return;
      const timer = setTimeout(() => untracked(() => { void this.store.requestPreview(); }), 180);
      cleanup(() => clearTimeout(timer));
    });
  }
  entries<T>(value: Readonly<Record<string, T>>): readonly [string, T][] { return Object.entries(value); }
  preferenceEntries(sliders: boolean) { return this.entries(this.store.editor()!.context.preferences).filter((entry) => (entry[1].type === 'slider') === sliders); }
  knownFacts(): readonly { label: string; value: string }[] {
    const facts = this.store.editor()!.context.knownFacts;
    const asRecord = (value: unknown): Readonly<Record<string, unknown>> => value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
    const contract = asRecord(facts['currentContract']?.value); const annual = asRecord(facts['annualMileage']?.value);
    const drivers = facts['drivers']?.value; const end = contract['contractEndDate'];
    const mileage = typeof annual['value'] === 'number' ? annual['value'] : contract['annualMileage']; const unit = annual['unit'] ?? contract['mileageUnit'];
    return [
      { label: 'Current car', value: this.shown(contract['model']) },
      { label: 'Contract ends', value: typeof end === 'string' && Number.isFinite(Date.parse(end)) ? new Date(end).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'Not supplied' },
      { label: 'Drivers', value: Array.isArray(drivers) ? drivers.map((driver) => this.shown(asRecord(driver)['name'])).join(', ') : 'Not supplied' },
      { label: 'Annual mileage', value: typeof mileage === 'number' ? `${this.shown(mileage)}${typeof unit === 'string' ? ' ' + unit : ''}` : 'Not supplied' },
    ];
  }
  shown(value: unknown): string {
    if (value === null || value === undefined || value === '') return 'Not supplied';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.map((v) => this.shown(v)).join(', ');
    if (typeof value === 'object') return Object.entries(value).map(([key, v]) => `${this.words(key)}: ${this.shown(v)}`).join('; ');
    return String(value);
  }
  words(value: string): string { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, (v) => v.toUpperCase()); }
  number(event: Event): number { return Number((event.target as HTMLInputElement).value); }
  checked(event: Event): boolean { return (event.target as HTMLInputElement).checked; }
  selected(key: string, value: BriefValue): boolean { const current = this.store.brief().preferences[key]?.value; return Array.isArray(current) ? current.includes(value as string) : current === value; }
  choose(key: string, value: BriefValue, event: Event): void {
    const definition = this.store.editor()!.context.preferences[key];
    if (!definition.multiple) { this.store.updatePreference(key, { value: value as string }); return; }
    const checked = this.checked(event); const values = definition.values?.filter((option) => option === value ? checked : this.selected(key, option)) ?? [];
    if (values.length) this.store.updatePreference(key, { value: values as readonly string[] });
    else (event.target as HTMLInputElement).checked = true;
  }
  answer(key: string, question: PracticalQuestion): string {
    const current = this.store.brief().essentials[key]?.value;
    if (key === 'charging' && (this.chargingOpen() || Array.isArray(question.yes) && question.yes.includes(current))) return 'yes';
    return JSON.stringify(current) === JSON.stringify(question.yes) ? 'yes' : JSON.stringify(current) === JSON.stringify(question.no) ? 'no' : current == null ? 'unknown' : 'review';
  }
  practical(key: string, question: PracticalQuestion, answer: 'yes' | 'no' | 'unknown'): void {
    if (key === 'charging') this.chargingOpen.set(answer === 'yes');
    this.store.updateEssential(key, (key === 'charging' && answer === 'yes' ? null : question[answer]) as BriefValue);
  }
  charging(question: PracticalQuestion): readonly BriefValue[] { return Array.isArray(question.yes) ? question.yes : []; }
  feedback(kind: 'preserve' | 'change'): string { return (this.store.brief().currentCarFeedback?.[kind] ?? []).map((key) => this.store.editor()?.context.preferences[key]?.label ?? this.words(key)).join(', ') || 'None supplied'; }
  readonly failedMedia = signal<readonly string[]>([]);
  decisionName(decision: BriefDecision): string { return typeof decision.snapshot?.display?.['name'] === 'string' ? decision.snapshot.display['name'] : 'Car name not supplied'; }
  reason(reason: Readonly<Record<string, unknown>>, kind: string): string { return reasonText(reason, kind); }
  choice(value: unknown): string { return choiceLabel(value); }
  decisionLine(decision: BriefDecision): string { const line = decision.snapshot?.display?.['line']; return typeof line === 'string' && line ? line : 'Scheme stock'; }
  photo(decision: BriefDecision): string | null {
    const src = decision.snapshot?.display?.['photo'];
    return typeof src === 'string' && (/^\/(?!\/)/.test(src) || /^https:\/\//.test(src)) ? src : null;
  }
  mediaKey(decision: BriefDecision): string { return `${decision.orderUuid}\n${this.photo(decision)}`; }
  mediaFailed(decision: BriefDecision): boolean { return this.failedMedia().includes(this.mediaKey(decision)); }
  failMedia(decision: BriefDecision): void { this.failedMedia.update((keys) => [...keys, this.mediaKey(decision)]); }
  caption(decision: BriefDecision): string | null {
    const images = decision.snapshot?.display?.['images'];
    const match = Array.isArray(images) ? images.find((image) => image?.src === this.photo(decision)) : null;
    return typeof match?.caption === 'string' ? match.caption : null;
  }
  previewSummary(preview: BriefPreview): string {
    const unknown = preview.decisions.filter((decision) => decision.gateStatus === 'needs-confirmation').length;
    return `${preview.eligibleCount} eligible ${preview.eligibleCount === 1 ? 'car' : 'cars'}${unknown ? `; ${unknown} ${unknown === 1 ? 'car needs' : 'cars need'} confirmation` : ''}.`;
  }
  points(decision: BriefDecision): string { const points = decision.terms?.['points']; return points && typeof points === 'object' ? this.shown((points as Readonly<Record<string, unknown>>)['value']) : 'Not supplied'; }
  allowance(decision: BriefDecision): string {
    const inputs = decision.terms?.['allowanceInputs'] as Record<string, unknown> | undefined;
    const allowance = inputs?.['allowance'] as Record<string, unknown> | undefined; return this.shown(allowance?.['value']);
  }
  reasonGroups(decision: BriefDecision): readonly { label: string; kind: string; entries: readonly Readonly<Record<string, unknown>>[] }[] {
    const checks = new Set(['driver-eligible', 'policy-include', 'allowance-sufficient', 'essential-met']);
    return [
      { label: 'Scheme checks', kind: 'reasons', entries: decision.reasons.filter((reason) => checks.has(String(reason['code']))) },
      { label: 'Why it suits you', kind: 'reasons', entries: decision.reasons.filter((reason) => !checks.has(String(reason['code']))) },
      { label: 'Trade-offs', kind: 'tradeOffs', entries: decision.tradeOffs },
      { label: 'Why it is not eligible', kind: 'blockers', entries: decision.blockers },
      { label: 'Needs confirmation', kind: 'unknowns', entries: decision.unknowns },
    ];
  }
  facts(decision: BriefDecision): readonly { label: string; value: string }[] {
    const labels: Record<string, string> = { body: 'Body style', fuel: 'Fuel', seats: 'Seats', boot: 'Boot', zeroTo62: '0 to 62 mph', mpg: 'Fuel economy' };
    const units: Record<string, string> = { L: 'litres', s: 's', 'mpg-imperial': 'mpg' };
    return Object.entries(labels).map(([key, label]) => {
      const fact = decision.snapshot?.facts?.[key] as Record<string, unknown> | undefined; const unit = units[String(fact?.['unit'])];
      const value = fact?.['status'] === 'known' ? `${['body', 'fuel'].includes(key) ? this.choice(fact['value']) : this.shown(fact['value'])}${unit ? ' ' + unit : ''}` : `Not supplied${unit ? ' (' + unit + ')' : ''}`;
      return { label, value };
    });
  }
  async reload(): Promise<void> { this.replace.set(false); this.chargingOpen.set(false); await this.store.reload(); }
  errors(): readonly { controlId: string; message: string }[] {
    const failure = this.store.failure(); if (failure?.status !== 'invalid' || !Array.isArray(failure.reasons)) return [];
    return failure.reasons.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return [];
      const reason = entry as Record<string, unknown>; const field = typeof reason['field'] === 'string' ? reason['field'].split('.')[1] : '';
      return field && this.store.editor()?.context.preferences[field] ? [{ controlId: `preference-${field}`, message: 'Review this preference before saving again.' }] : [];
    });
  }
}
