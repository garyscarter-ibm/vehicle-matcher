import { Component, input } from '@angular/core';
import { ScreenIntroComponent } from './screen-intro.component';
@Component({ selector: 'gcsp-status-screen', imports: [ScreenIntroComponent], template: `<section class="gcsp-panel gcsp-status" [attr.role]="announcement()" [attr.aria-busy]="busy() ? 'true' : null"><gcsp-screen-intro [title]="title()" [lede]="message()" [level]="level()" /><div class="gcsp-actions"><ng-content /></div></section>` })
export class StatusScreenComponent { readonly title = input.required<string>(); readonly message = input(''); readonly busy = input(false); readonly level = input<1 | 2>(1); readonly announcement = input<'status' | 'alert' | null>('status'); }
