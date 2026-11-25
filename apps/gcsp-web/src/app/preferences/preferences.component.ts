import { RouterLink } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { FactListComponent, FactRow } from '../kit/fact-list.component';
import { BriefPreviewCardComponent, BriefPreviewCardView } from '../kit/brief-preview-card.component';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { choiceLabel, reasonText } from './brief.copy';
import { BriefEditorStore } from './brief-editor.store';
import { BuddyControlsComponent } from './buddy-controls.component';
import { BriefDecision, BriefPreview, BriefValue, PracticalQuestion } from './brief.types';
@Component({ selector: 'gcsp-preferences', imports: [RouterLink, NgTemplateOutlet, ButtonDirective, ScreenIntroComponent, StatusScreenComponent, FactListComponent, BriefPreviewCardComponent, ErrorSummaryComponent, BuddyControlsComponent], host: { class: 'vm gcsp-brief' }, templateUrl: './preferences.component.html', styleUrl: './preferences.component.css' })
export class PreferencesComponent {
  readonly store = inject(BriefEditorStore); readonly replace = signal(false); readonly chargingOpen = signal(false);
  constructor() {
    effect((cleanup) => {
      const brief = this.store.brief(); const editor = this.store.editor(); const blocked = this.store.queueBusy() || this.store.fullBusy() || this.store.locked();
      if (!editor || editor.selection?.state === 'accepted' || blocked || !brief) return;
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
  selected(key: string, value: BriefValue): boolean { const current = this.store.brief().preferences[key]?.value; return Array.isArray(current) ? current.includes(value as string) : current === value; }
  choose(key: string, value: BriefValue): void {
    const definition = this.store.editor()!.context.preferences[key];
    if (!definition.multiple) { this.store.updatePreference(key, { value: value as string }); return; }
    const values = definition.values?.filter(option => option === value ? !this.selected(key, option) : this.selected(key, option)) ?? [];
    if (values.length) this.store.updatePreference(key, { value: values as readonly string[] });
  }
  optionTabStop(key: string, value: BriefValue): boolean {
    const definition = this.store.editor()!.context.preferences[key];
    return this.selected(key, value) || !definition.values?.some(option => this.selected(key, option)) && definition.values?.[0] === value;
  }
  navigateOptions(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const source = event.currentTarget as HTMLButtonElement;
    if (source.matches(':disabled')) return;
    const buttons = Array.from(source.parentElement!.querySelectorAll<HTMLButtonElement>('button[role=radio]')).filter(button => !button.matches(':disabled'));
    if (!buttons.length) return;
    const index = buttons.indexOf(source); const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
    event.preventDefault(); buttons[next].focus(); buttons[next].click();
  }
  hasPreference(key: string): boolean {
    const value = this.store.brief().preferences[key]?.value;
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' || Number.isFinite(value);
  }
  rangeText(key: string, importance = false): string {
    const preference = this.store.brief().preferences[key]; const value = importance ? preference?.importance : preference?.value;
    return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-GB') : 'Not set';
  }
  scaleEnds(key: string): readonly string[] {
    const ends: Readonly<Record<string, readonly string[]>> = { sportiness: ['Less sporty', 'More sporty'], comfort: ['Less comfort', 'More comfort'], economy: ['Less economical', 'More economical'], size: ['Smaller', 'Larger'] };
    return ends[key] ?? ['Less', 'More'];
  }
  readonly practicalAnswers = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }, { value: 'unknown', label: 'Not sure yet' }] as const;
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
  decisionName(decision: BriefDecision): string { return typeof decision.snapshot?.display?.['name'] === 'string' ? decision.snapshot.display['name'] : 'Car name not supplied'; }
  reason(reason: Readonly<Record<string, unknown>>, kind: string): string { return reasonText(reason, kind); }
  choice(value: unknown): string { return choiceLabel(value); }
  decisionLine(decision: BriefDecision): string { const line = decision.snapshot?.display?.['line']; return typeof line === 'string' && line ? line : 'Scheme stock'; }
  photo(decision: BriefDecision): string | null {
    const src = decision.snapshot?.display?.['photo'];
    return typeof src === 'string' && (/^\/(?!\/)/.test(src) || /^https:\/\//.test(src)) ? src : null;
  }
  caption(decision: BriefDecision): string | null {
    const images = decision.snapshot?.display?.['images'];
    const match = Array.isArray(images) ? images.find((image) => image?.src === this.photo(decision)) : null;
    return typeof match?.caption === 'string' ? match.caption : null;
  }
  previewSummary(preview: BriefPreview): string {
    const unknown = preview.decisions.filter((decision) => decision.gateStatus === 'needs-confirmation').length;
    return `${preview.eligibleCount} eligible ${preview.eligibleCount === 1 ? 'car' : 'cars'}${unknown ? `; ${unknown} ${unknown === 1 ? 'car needs' : 'cars need'} confirmation` : ''}.`;
  }
  private readonly checkCodes = new Set(['driver-eligible', 'policy-include', 'allowance-sufficient', 'essential-met']);
  schemeChecks(decision: BriefDecision): readonly Readonly<Record<string, unknown>>[] { return decision.reasons.filter(reason => this.checkCodes.has(String(reason['code']))); }
  previewCard(decision: BriefDecision, preview: BriefPreview): BriefPreviewCardView {
    const scores = preview.decisions.filter(d => d.gateStatus === 'eligible' && typeof d['score'] === 'number' && Number.isFinite(d['score'])).map(d => d['score'] as number);
    const top = Math.max(...scores); const informative = top > 0 && scores.some(score => score < top);
    const ranking = preview['ranking'] as Readonly<Record<string, unknown>> | undefined; const recommended = preview.recommendations[0];
    const pointsValue = (d: BriefDecision): unknown => (d.terms?.['points'] as Readonly<Record<string, unknown>> | undefined)?.['value'];
    const distinct = recommended && preview.decisions.some(d => d.gateStatus === 'eligible' && (d['score'] !== recommended['score'] || pointsValue(d) !== pointsValue(recommended)));
    const scoreLabel = ranking?.['rule'] === 'similarFitThenPoints'
      ? distinct && decision.orderUuid === recommended?.orderUuid ? { text: 'Recommended', title: 'Recommended: makes the most of your points allowance among similarly matched cars.' } : null
      : informative && decision['score'] === top ? { text: 'Best match', title: 'Best match: this car fits your preferences better than the other eligible cars.' } : null;
    const points = pointsValue(decision); const allowance = ((decision.terms?.['allowanceInputs'] as Readonly<Record<string, unknown>> | undefined)?.['allowance'] as Readonly<Record<string, unknown>> | undefined)?.['value'];
    const known = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    const terms = `${known(points) ? points.toLocaleString('en-GB') + ' points a month' : 'Monthly points cost not supplied'} · ${known(allowance) ? allowance.toLocaleString('en-GB') + ' points a month allowance' : 'monthly points allowance not supplied'}`;
    const groups = [
      { label: decision.gateStatus === 'eligible' ? 'Why it suits you' : 'Checks passed', kind: 'reasons', entries: decision.reasons.filter(reason => !this.checkCodes.has(String(reason['code']))) },
      { label: 'Why it is not eligible', kind: 'blockers', entries: decision.blockers },
      { label: 'Needs confirmation', kind: 'unknowns', entries: decision.unknowns },
      { label: 'Trade-offs', kind: 'tradeOffs', entries: decision.tradeOffs },
    ].map(group => ({ label: group.label, entries: group.entries.map(reason => reasonText(reason, group.kind)) }));
    return { id: decision.orderUuid, name: this.decisionName(decision), line: this.decisionLine(decision), photo: this.photo(decision), caption: this.caption(decision), terms, facts: this.facts(decision), gate: decision.gateStatus, groups,
      score: known(decision['score']) ? decision['score'] : undefined, scoreLabel: decision.gateStatus === 'eligible' ? scoreLabel : undefined };
  }
  acceptedPreferenceRows(): readonly FactRow[] {
    const context = this.store.editor()!.context;
    const level = (value: unknown): string => typeof value === 'number' && Number.isFinite(value) ? `${value} out of ${context.slider.maximum}` : 'Not set';
    return Object.entries(context.preferences).filter(([key]) => this.store.brief().preferences[key]).map(([key, definition]) => {
      const p = this.store.brief().preferences[key];
      const value = definition.type === 'slider' ? level(p.value) : Array.isArray(p.value) ? p.value.map(choiceLabel).join(', ') : choiceLabel(p.value);
      return { label: definition.label, value: `${value}, importance ${p.importance === context.slider.minimum ? "I don't mind" : level(p.importance)}` };
    });
  }
  acceptedNeedRows(): readonly FactRow[] {
    return Object.entries(this.store.editor()!.context.practicalQuestions).filter(([key]) => this.store.brief().essentials[key]).map(([key, question]) => {
      const value = this.store.brief().essentials[key].value;
      const answer = value == null ? this.store.editor()!.context.unconfirmedLabel : JSON.stringify(value) === JSON.stringify(question.no) ? 'No'
        : Array.isArray(question.yes) && question.yes.includes(value) ? `Yes, ${value === 'either' ? 'home or work' : value}` : 'Yes';
      return { label: question.label, value: answer };
    });
  }
  facts(decision: BriefDecision): readonly FactRow[] {
    const labels: Record<string, string> = { body: 'Body style', fuel: 'Fuel', seats: 'Seats', boot: 'Boot', zeroTo62: '0 to 62 mph', mpg: 'Fuel economy' };
    const units: Record<string, string> = { L: 'litres', s: 's', 'mpg-imperial': 'mpg' };
    return Object.entries(labels).map(([key, label]) => {
      const fact = decision.snapshot?.facts?.[key] as Record<string, unknown> | undefined; const unit = units[String(fact?.['unit'])];
      const value = fact?.['status'] === 'known' ? ['body', 'fuel'].includes(key) ? this.choice(fact['value']) : this.shown(fact['value']) : null;
      return { label, value, unit, missingLabel: `Not supplied${unit ? ' (' + unit + ')' : ''}` };
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
