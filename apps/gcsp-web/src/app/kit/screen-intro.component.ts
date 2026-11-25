import { Component, computed, input } from '@angular/core';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

@Component({
  selector: 'gcsp-screen-intro, div[gcspScreenIntro]',
  template: `
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
      @if (lede()) { <p class="vm-lede">{{ lede() }}</p> }
    } @else {
      @if (kicker()) { <p class="vm-kicker">{{ kicker() }}</p> }
      @if (headingLevel() === 1) { <h1 class="gcsp-page-title" tabindex="-1">{{ title() }}</h1> }
      @else if (headingLevel() === 3) { <h3 class="gcsp-intro-title">{{ title() }}</h3> }
      @else { <h2>{{ title() }}</h2> }
      @if (lede()) { <p class="gcsp-note">{{ lede() }}</p> }
    }
  `,
})
export class ScreenIntroComponent {
  readonly title = input.required<string>();
  readonly lede = input('');
  readonly kicker = input('');
  readonly presentation = input<'default' | 'source'>('default');
  readonly level = input<HeadingLevel>();
  readonly headingLevel = computed(() => this.level() ?? (this.presentation() === 'source' ? 2 : 1));
}
