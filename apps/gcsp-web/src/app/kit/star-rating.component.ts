import { Component, input, output } from '@angular/core';
import { ButtonDirective } from './button.directive';
@Component({ selector: 'gcsp-star-rating', imports: [ButtonDirective], styleUrl: './preference-controls.css', template: `
  <fieldset class="star-rating" [disabled]="disabled()"><legend>{{ label() }}</legend><div class="stars">
    @for (star of stars; track star) { <label [class.selected]="(value() ?? 0) >= star"><input type="radio" [name]="id()" [checked]="value() === star" (change)="rated.emit(star)" /><span aria-hidden="true">★</span><span class="star-label">{{ star }} {{ star === 1 ? 'star' : 'stars' }}</span></label> }
    <button gcspButton variant="ghost" type="button" [disabled]="disabled() || value() === null" (click)="rated.emit(null)">Clear rating</button>
  </div></fieldset>` })
export class StarRatingComponent {
  readonly id = input.required<string>(); readonly label = input('How do you rate your current car?'); readonly value = input<number | null>(null); readonly disabled = input(false);
  readonly rated = output<number | null>(); readonly stars = [1, 2, 3, 4, 5];
}
