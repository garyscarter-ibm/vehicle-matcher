import { Component, input } from '@angular/core';
@Component({ selector: 'gcsp-screen-intro', template: `@if (kicker()) { <p class="vm-kicker">{{ kicker() }}</p> } @if (level() === 1) { <h1 class="gcsp-page-title" tabindex="-1">{{ title() }}</h1> } @else { <h2>{{ title() }}</h2> } @if (lede()) { <p class="gcsp-note">{{ lede() }}</p> }` })
export class ScreenIntroComponent { readonly title = input.required<string>(); readonly lede = input(''); readonly kicker = input(''); readonly level = input<1 | 2>(1); }
