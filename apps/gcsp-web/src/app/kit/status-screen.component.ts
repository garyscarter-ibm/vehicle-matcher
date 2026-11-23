import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input } from '@angular/core';
import { HeadingLevel, ScreenIntroComponent } from './screen-intro.component';

@Component({
  selector: 'gcsp-status-screen, div[gcspStatusScreen]',
  imports: [NgTemplateOutlet, ScreenIntroComponent],
  host: {
    '[class.vm-screen]': "presentation() === 'source'",
    '[class.vm-status]': "presentation() === 'source'",
    '[attr.role]': "presentation() === 'source' ? announcement() : null",
    '[attr.aria-busy]': "presentation() === 'source' && busy() ? 'true' : null",
  },
  template: `
    <ng-template #actions><ng-content /></ng-template>
    @if (presentation() === 'source') {
      @if (kicker()) { <p class="vm-kicker">{{ kicker() }}</p> }
      @switch (headingLevel()) {
        @case (1) { <h1 class="vm-title">{{ title() }}</h1> }
        @case (3) { <h3 class="vm-title">{{ title() }}</h3> }
        @case (4) { <h4 class="vm-title">{{ title() }}</h4> }
        @case (5) { <h5 class="vm-title">{{ title() }}</h5> }
        @case (6) { <h6 class="vm-title">{{ title() }}</h6> }
        @default { <h2 class="vm-title">{{ title() }}</h2> }
      }
      @if (message()) { <p class="vm-lede">{{ message() }}</p> }
      <ng-container [ngTemplateOutlet]="actions" />
    } @else {
      <section class="gcsp-panel gcsp-status" [attr.role]="announcement()" [attr.aria-busy]="busy() ? 'true' : null">
        <gcsp-screen-intro [title]="title()" [lede]="message()" [level]="headingLevel()" />
        <div class="gcsp-actions"><ng-container [ngTemplateOutlet]="actions" /></div>
      </section>
    }
  `,
})
export class StatusScreenComponent {
  readonly title = input.required<string>();
  readonly message = input('');
  readonly busy = input(false);
  readonly kicker = input('');
  readonly presentation = input<'default' | 'source'>('default');
  readonly level = input<HeadingLevel>();
  readonly headingLevel = computed(() => this.level() ?? (this.presentation() === 'source' ? 2 : 1));
  readonly announcement = input<'status' | 'alert' | null>('status');
}
