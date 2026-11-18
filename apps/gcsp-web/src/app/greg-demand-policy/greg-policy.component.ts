import { DOCUMENT } from '@angular/common';
import { ChangeDetectorRef, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { AuthPort } from '../auth/auth.port';
import { ButtonDirective } from '../kit/button.directive';
import { ErrorSummaryComponent } from '../kit/error-summary.component';
import { FactListComponent } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { GregStore } from './greg.store';
import type { GregEditorField } from './greg.store';
import type { GregCount, GregFit, GregProvenance } from './greg.types';

const plainRules: readonly (readonly [RegExp, string])[] = [
  [/^People, cars and behaviour are fictional and assumed; .*$/, 'People, cars and behaviour are modelled, not BMW records.'],
  [/^Fictional cohort and assumed behaviour; /, 'Modelled cohort and assumed behaviour; '],
  [/^Fictional facts for mechanics; /, 'Vehicle and driver facts are assumed; '],
  [/^Underlying needs are synthetic latent inputs, not a real employee confirmation\.$/, 'Underlying needs are modelled inputs, not an employee confirmation.'],
  [/ Not a verified BMW amount\.$/, ''], [/\bin demo brief\/Q15\b/, 'in the brief (Q15)'],
  [/\b(?:synthetic|fictional|demonstration|demo)\b(?:[- ]clock)?[- ]?(?=\w)/gi, ''],
];
let sequence = 0;

@Component({
  selector: 'gcsp-greg-policy',
  imports: [ButtonDirective, ErrorSummaryComponent, FactListComponent, LabelledFieldComponent, ScreenIntroComponent, StatusScreenComponent],
  templateUrl: './greg-policy.component.html', styleUrl: './greg-policy.component.css',
})
export class GregPolicyComponent {
  readonly store = inject(GregStore);
  readonly view = this.store.view;
  private readonly auth = inject(AuthPort);
  private readonly document = inject(DOCUMENT);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly statusElement = viewChild<ElementRef<HTMLElement>>('status');
  readonly id = `gcsp-greg-policy-${++sequence}`;
  readonly safeMaximum = Number.MAX_SAFE_INTEGER;
  readonly selectedPriceId = signal('');
  readonly authenticationUnavailable = computed(() => this.auth.state().status === 'unavailable');
  readonly priceGroups = computed(() => {
    const groups = new Map<string, { id: string; label: string; fields: GregEditorField[] }>();
    for (const field of this.view().fields.filter(f => f.kind === 'price')) {
      const id = field.schemeId!;
      if (!groups.has(id)) groups.set(id, { id, label: field.schemeLabel!, fields: [] });
      groups.get(id)!.fields.push(field);
    }
    return [...groups.values()];
  });
  readonly selectedPrice = computed(() => this.view().fields.find(f => f.kind === 'price' && f.id === this.selectedPriceId())?.id
    ?? this.view().fields.find(f => f.kind === 'price')?.id ?? '');
  readonly errors = computed(() => this.view().fields.filter(f => !!f.error).map(f => ({ controlId: this.controlId(f.id), message: `${f.label}: ${f.error}` })));
  readonly metadata = computed(() => {
    const p = this.view().policy;
    return p ? [{ label: 'Active version', value: p.activeVersionLabel }, { label: 'Effective from', value: this.time(p.effectiveFrom) }, { label: 'As of', value: this.time(p.asOf) }] : [];
  });
  readonly sources = computed(() => {
    const groups = new Map<string, { provenance: GregProvenance; covers: Set<string> }>();
    const add = (cover: string, p: GregProvenance) => {
      const key = JSON.stringify([p.status, p.source, p.sourceDate, p.basis]);
      const group = groups.get(key) ?? { provenance: p, covers: new Set<string>() };
      group.covers.add(cover); groups.set(key, group);
    };
    for (const field of this.view().fields) {
      add(field.kind === 'price' ? 'Points costs' : 'Recommendation weights', field);
      if (field.presentationRange) add('Slider ranges', field.presentationRange);
    }
    return [...groups.entries()].map(([key, { provenance: p, covers }]) => ({ key, rows: [
      { label: 'Covers', value: [...covers].join(', ') }, { label: 'Status', value: this.plainText(p.status.charAt(0).toUpperCase() + p.status.slice(1)) },
      { label: 'Source', value: this.plainText(p.source) }, { label: 'Date', value: p.sourceDate }, { label: 'Basis', value: this.plainText(p.basis) },
    ] }));
  });
  readonly previewRows = computed(() => {
    const p = this.view().preview; if (!p) return [];
    const countRow = (label: string, a: GregCount, b: GregCount) => ({ label, active: a.label, draft: b.label,
      activeBand: a.kind === 'band', draftBand: b.kind === 'band', change: a.kind === 'exact' && b.kind === 'exact' ? String(b.value - a.value) : 'Unknown (privacy bands)' });
    const a = p.active.fit.meanBestScore; const b = p.draft.fit.meanBestScore;
    return [countRow('Briefs with unmet demand', p.active.demand.demand.unmet.total.count, p.draft.demand.demand.unmet.total.count),
      countRow('Employees with eligible stock', p.active.fit.employeesWithEligibleStock, p.draft.fit.employeesWithEligibleStock),
      countRow('Scored saved briefs', p.active.fit.scoredBriefs, p.draft.fit.scoredBriefs),
      { label: 'Mean best recommendation fit', active: this.score(a), draft: this.score(b), activeBand: false, draftBand: false,
        change: a.status === 'available' && b.status === 'available' ? `${(b.value - a.value).toFixed(1)} / 100` : 'Unknown (privacy suppression)' }];
  });
  readonly publicationTitle = computed(() => {
    const p = this.view().publication;
    if (!p) return 'Publication outcome unknown';
    if (this.view().uncertain || !p.activation) return 'Policy saved, activation not confirmed';
    return p.activation.status === 'pending' ? 'Policy saved, activation pending'
      : p.activation.publishedVersionActive ? 'Policy published and active' : 'Policy saved, a later policy is active';
  });
  controlId(id: string): string { return `${this.id}-field-${this.view().fields.findIndex(f => f.id === id)}`; }
  descriptionIds(field: GregEditorField): string { const id = this.controlId(field.id); return `${id}-hint${field.error ? ` ${id}-error` : ''}`; }
  fieldName(id: string): string { return this.view().fields.find(f => f.id === id)?.label ?? id; }
  fieldUnit(id: string): string { return this.view().fields.find(f => f.id === id)?.unitLabel ?? ''; }
  time(value: string): string { return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/London', timeZoneName: 'short' }); }
  plainText(value: string): string {
    const out = plainRules.reduce((s, [from, to]) => s.replace(from, to), value);
    return /^(?:synthetic|fictional|demo)/i.test(value) && out !== value ? out.charAt(0).toUpperCase() + out.slice(1) : out;
  }
  score(value: GregFit['meanBestScore']): string { return value.status === 'available' ? `${value.value.toFixed(1)} / 100` : 'Suppressed for privacy'; }
  onSummaryClick(event: MouseEvent): void {
    const anchor = (event.target as Element | null)?.closest('a'); const href = anchor?.getAttribute('href');
    const field = this.view().fields.find(f => `#${this.controlId(f.id)}` === href); if (!field) return;
    event.preventDefault(); if (field.kind === 'price') this.selectedPriceId.set(field.id);
    this.changeDetector.detectChanges(); this.document.getElementById(this.controlId(field.id))?.focus();
  }
  run(action: 'preview' | 'publish' | 'retry'): void {
    const result = action === 'preview' ? this.store.previewChanges() : action === 'publish' ? this.store.publishPreview() : this.store.retryPublication();
    this.statusElement()?.nativeElement.focus(); void result;
  }
}
