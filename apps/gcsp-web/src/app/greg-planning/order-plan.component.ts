import { afterNextRender, Component, ElementRef, inject, Injector, output } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { PlanningStore } from './planning.store';
import { ConstraintEditor } from './planning.types';

@Component({
  selector: 'gcsp-order-plan',
  imports: [ButtonDirective, FactListComponent, LabelledFieldComponent, ScreenIntroComponent, StatusScreenComponent],
  templateUrl: './order-plan.component.html', styleUrl: './order-plan.component.css',
})
export class OrderPlanComponent {
  readonly store = inject(PlanningStore);
  readonly requested = output<void>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  inputId(editor: ConstraintEditor, row = '', edge = ''): string { return `plan-limit-${encodeURIComponent(JSON.stringify([editor.key, row, edge]))}`; }
  edit(editor: ConstraintEditor, event: Event, row = '', edge = ''): void {
    this.store.edit(editor.key, (event.target as HTMLInputElement).value, row, edge);
  }
  async preview(): Promise<void> { await this.store.preview(); this.focusResult(); }
  async replan(): Promise<void> { await this.store.refresh(); this.focusResult(); }
  async current(): Promise<void> { await this.store.backToCurrent(); this.focusResult(); }
  async submit(): Promise<void> { await this.store.submit(); this.requested.emit(); }
  focusResult(): void { afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('[data-plan-result]')?.focus(), { injector: this.injector }); }
}
