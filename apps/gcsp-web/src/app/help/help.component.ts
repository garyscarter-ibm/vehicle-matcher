import { ChangeDetectorRef, Component, ElementRef, OnDestroy, computed, effect, inject, input, untracked } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { FactListComponent } from '../kit/fact-list.component';
import { LabelledFieldComponent } from '../kit/labelled-field.component';
import { ScreenIntroComponent } from '../kit/screen-intro.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { caseNotice } from '../cases/case.projection';
import { HelpStore } from './help.store';

let instance = 0;
@Component({
  selector: 'gcsp-help',
  imports: [ButtonDirective, FactListComponent, LabelledFieldComponent, ScreenIntroComponent, StatusScreenComponent],
  providers: [HelpStore],
  templateUrl: './help.component.html',
  styleUrl: './help.component.css',
})
export class HelpComponent implements OnDestroy {
  readonly quiet = input(false);
  readonly headingLevel = input<1 | 2>(1);
  readonly announce = input<((message: string) => void) | undefined>(undefined);
  readonly store = inject(HelpStore);
  readonly view = this.store.view;
  readonly id = `gcsp-help-${++instance}`;
  readonly reasonId = `${this.id}-reason`;
  readonly notice = caseNotice;
  readonly childLevel = computed(() => this.quiet() ? 2 : this.headingLevel() + 1);
  readonly caveat = computed(() => this.view().cases.length > 0 || this.view().editing || this.view().reviewReason !== null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private destroyed = false;

  constructor() {
    effect(() => {
      const announce = this.announce();
      const message = this.view().message;
      if (announce && message) untracked(() => announce(message));
    });
  }
  ask(): void { this.store.beginRequest(); if (this.view().editing) this.focus('textarea'); }
  setReason(event: Event): void { this.store.setReason((event.target as HTMLTextAreaElement).value); }
  review(event: Event): void {
    event.preventDefault();
    this.store.reviewRequest();
    this.focus(this.view().error ? 'textarea' : this.view().reviewReason ? '[data-help-confirm]' : '[data-help-status]');
  }
  cancel(): void { this.store.cancelRequest(); this.focus('[data-help-ask]'); }
  async confirm(): Promise<void> { await this.perform(() => this.store.confirm()); }
  async retry(): Promise<void> { await this.perform(() => this.store.retryRequest()); }
  async refresh(): Promise<void> { await this.perform(() => this.store.refresh()); }
  ngOnDestroy(): void { this.destroyed = true; this.store.dispose(); }
  private async perform(work: () => Promise<boolean>): Promise<void> {
    const completion = work();
    this.focus('[data-help-status]');
    if (await completion) this.focus('[data-help-status]');
  }
  private focus(selector: string): void {
    if (this.destroyed) return;
    this.changeDetector.detectChanges();
    this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
  }
}
