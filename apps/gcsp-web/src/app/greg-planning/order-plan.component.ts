import { afterNextRender, Component, computed, ElementRef, inject, Injector, input, output } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { DataTableComponent, DataTableColumn, DataTableRow } from '../kit/data-table.component';
import { FactListComponent } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { RangeSliderComponent, SliderQuestion } from '../kit/range-slider.component';
import { PlanningStore } from './planning.store';
import { ConstraintEditor } from './planning.types';

@Component({
  selector: 'gcsp-order-plan',
  imports: [DataTableComponent, RangeSliderComponent, ButtonDirective, FactListComponent, LabelledFieldComponent, ScreenIntroComponent, StatusScreenComponent],
  templateUrl: './order-plan.component.html', styleUrl: './order-plan.component.css',
})
export class OrderPlanComponent {
  readonly headingLevel = input<1 | 2>(1);
  readonly store = inject(PlanningStore);
  readonly requested = output<void>();
  readonly comparisonColumns: readonly DataTableColumn[] = [{ key: 'name', label: 'Measure or derivative' }, { key: 'current', label: 'Current', numeric: true }, { key: 'preview', label: 'Preview', numeric: true }];
  readonly orderColumns: readonly DataTableColumn[] = [{ key: 'model', label: 'Model' }, { key: 'derivative', label: 'Derivative' }, { key: 'quantity', label: 'Quantity', numeric: true }];
  readonly classColumns: readonly DataTableColumn[] = [{ key: 'name', label: 'Vehicle class and period' }, { key: 'expected', label: 'Expected', numeric: true }, { key: 'low', label: 'Low', numeric: true }, { key: 'high', label: 'High', numeric: true }];
  readonly learnedColumns: readonly DataTableColumn[] = [{ key: 'name', label: 'Measure or derivative' }, { key: 'baseline', label: 'Baseline', numeric: true }, { key: 'learned', label: 'Learned', numeric: true }, { key: 'difference', label: 'Difference', numeric: true }];
  readonly comparisonRows = computed<readonly DataTableRow[]>(() => this.store.plan()?.comparison.map((row, index) => ({ id: String(index), label: row.label, cells: { name: row.label, current: row.current ?? 'Not supplied', preview: row.preview ?? 'No plan' } })) ?? []);
  readonly orderRows = computed<readonly DataTableRow[]>(() => [...this.store.plan()?.lines ?? []].sort((a, b) => Number(b.quantity > 0) - Number(a.quantity > 0)).map(row => ({ id: row.id, label: row.model, cells: { model: row.model, derivative: row.derivative, quantity: row.quantity } })));
  readonly classRows = computed<readonly DataTableRow[]>(() => this.store.plan()?.learnedModel?.classes.map((row, index) => ({ id: String(index), label: row.label, cells: { name: row.label, expected: row.expected, low: row.low, high: row.high } })) ?? []);
  readonly learnedRows = computed<readonly DataTableRow[]>(() => this.store.plan()?.learnedModel?.differences.rows.map((row, index) => {
    const cell = (value: string) => row.changed === true ? { label: value, emphasis: true } : value;
    return { id: String(index), label: row.label, cells: { name: cell(row.label), baseline: row.baseline, learned: cell(row.learned), difference: cell(row.difference) } };
  }) ?? []);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  inputId(editor: ConstraintEditor, row = '', edge = ''): string { return `plan-limit-${encodeURIComponent(JSON.stringify([editor.key, row, edge]))}`; }
  edit(editor: ConstraintEditor, event: Event, row = '', edge = ''): void {
    this.store.edit(editor.key, (event.target as HTMLInputElement).value, row, edge);
  }
  private readonly sliderQuestions = new Map<string, SliderQuestion>();
  sliderQuestion(editor: ConstraintEditor, row: ConstraintEditor['rows'][number]): SliderQuestion {
    const baseline = this.store.editorSource().find(group => group.key === editor.key)?.rows.find(item => item.id === row.id)?.max ?? 0;
    const id = this.inputId(editor, row.id, 'slider'); const max = Math.max(10, baseline * 2);
    const previous = this.sliderQuestions.get(id);
    if (previous?.max === max && previous.label === row.label + ' maximum') return previous;
    const question = { id, label: row.label + ' maximum', min: 0, max, step: 1, unit: ' vehicles' };
    this.sliderQuestions.set(id, question); return question;
  }
  sliderValue(editor: ConstraintEditor, row: ConstraintEditor['rows'][number]): number | null {
    const text = this.store.value(editor, row.id, 'max'); const value = text === '' ? NaN : Number(text);
    return Number.isSafeInteger(value) && value >= 0 && value <= this.sliderQuestion(editor, row).max ? value : null;
  }
  async preview(): Promise<void> { await this.store.preview(); this.focusResult(); }
  async replan(): Promise<void> { await this.store.refresh(); this.focusResult(); }
  async current(): Promise<void> { await this.store.backToCurrent(); this.focusResult(); }
  async submit(): Promise<void> { await this.store.submit(); this.requested.emit(); }
  focusResult(): void { afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('[data-plan-result]')?.focus(), { injector: this.injector }); }
}
