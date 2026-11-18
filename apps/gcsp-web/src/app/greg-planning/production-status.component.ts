import { afterNextRender, Component, ElementRef, inject, Injector, output } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { PlanningStore } from './planning.store';

@Component({ selector: 'gcsp-production-status', imports: [ButtonDirective, FactListComponent, StatusScreenComponent],
  templateUrl: './production-status.component.html', styleUrl: './production-status.component.css' })
export class ProductionStatusComponent {
  readonly store = inject(PlanningStore);
  readonly replanned = output<void>();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  async replan(): Promise<void> { await this.store.refresh(); this.replanned.emit(); }
  async retry(): Promise<void> { await this.store.retrySubmission(); this.focusOutcome(); }
  focusOutcome(): void { afterNextRender(() => (this.host.nativeElement.querySelector<HTMLElement>('[data-production-result]')
    ?? this.host.nativeElement.querySelector<HTMLElement>('#production-title'))?.focus(), { injector: this.injector }); }
}
