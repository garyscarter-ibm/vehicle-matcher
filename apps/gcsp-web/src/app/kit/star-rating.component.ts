import { Component, computed, effect, ElementRef, inject, input, output, signal, ViewChild, ViewEncapsulation } from '@angular/core';
import { ButtonDirective } from './button.directive';
import { HelpTipDirective } from './help-tip.directive';

export const RATING_WORDS = ['', 'Not for me', 'Ready for a change', 'It’s okay', 'I really like it', 'I love it'];
export type RatingStatus = 'idle' | 'pending' | 'saved' | 'failed';
const clean = (value: number | null) => Number.isInteger(value) && value! >= 1 && value! <= 5 ? value : null;

@Component({ selector: 'gcsp-star-rating', imports: [ButtonDirective, HelpTipDirective], encapsulation: ViewEncapsulation.None,
  styleUrl: './star-rating.component.css', template: `
  <fieldset class="gcsp-star-rating" [class.gcsp-star-rating-overlay]="overlay()" [class.gcsp-star-rating-pill]="pill()"
    [attr.aria-disabled]="disabled() ? 'true' : null" [attr.data-status]="status()" [attr.aria-busy]="status() === 'pending' ? 'true' : null"
    [gcspHelpTip]="help()" [helpTipId]="id() + '-help'" helpTipPlacement="above-end" helpTipTriggers="input">
    <legend>{{ label() }}</legend>
    @if (retryable()) { <div class="gcsp-star-failed" [hidden]="status() !== 'failed'"><span>Rating not saved</span><button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" aria-label="Try saving your rating again" (click)="retried.emit()">Try again</button></div> }
    <ng-content /><div class="gcsp-star-row">@for (star of stars; track star) {
      <label class="gcsp-star" [class.is-filled]="(current() ?? 0) >= star"><input type="radio" [name]="id()" [value]="star" [checked]="current() === star" [disabled]="disabled()"
        [attr.aria-label]="star + (star === 1 ? ' star: ' : ' stars: ') + (labels()[star] ?? '')"
        (click)="click($event, star)" (keydown)="key($event, star)" (keyup)="keyup($event)" (blur)="releaseSpace()" (pointerdown)="releaseSpace()" (change)="paint()" />
        <svg class="gcsp-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L2.9 9.4l6.3-.9Z" /></svg>
      </label>
    }</div><span class="gcsp-vh" role="status" aria-live="polite" aria-atomic="true">{{ announcement() }}</span>
  </fieldset>` })
export class StarRatingComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  @ViewChild(HelpTipDirective) private tip?: HelpTipDirective;
  readonly id = input.required<string>(); readonly label = input('How do you rate your current car?'); readonly value = input<number | null>(null);
  readonly disabled = input(false); readonly overlay = input(false); readonly pill = input(false); readonly help = input('');
  readonly labels = input<readonly (string | undefined)[]>(RATING_WORDS); readonly status = input<RatingStatus>('idle'); readonly retryable = input(false);
  readonly rated = output<number | null>(); readonly retried = output<void>(); readonly stars = [1, 2, 3, 4, 5]; readonly current = signal<number | null>(null);
  readonly announcement = computed(() => this.status() === 'saved' ? this.current() === null ? 'Rating cleared' : `Rating saved: ${this.current()} of 5`
    : this.status() === 'failed' ? 'Rating not saved. Try again.' : '');
  private spaceHeld = false;
  constructor() { effect(() => { this.current.set(clean(this.value())); }); }
  private radios(): NodeListOf<HTMLInputElement> { return this.host.nativeElement.querySelectorAll('input'); }
  paint(): void { this.radios().forEach((radio, at) => { radio.checked = at + 1 === this.current(); radio.closest('label')?.classList.toggle('is-filled', at < (this.current() ?? 0)); }); }
  private choose(star: number): void { this.tip?.dismiss(); const next = this.current() === star ? null : star; this.current.set(next); this.paint(); this.rated.emit(next); }
  click(event: MouseEvent, star: number): void {
    if (this.disabled()) return;
    if (this.spaceHeld && event.detail === 0) { this.spaceHeld = false; this.paint(); return; } this.choose(star);
  }
  key(event: KeyboardEvent, star: number): void {
    if (this.disabled() || event.altKey || event.ctrlKey || event.metaKey) return;
    const space = event.key === ' ' || event.key === 'Spacebar';
    if (space || event.key === 'Enter') { event.preventDefault(); if (event.repeat) return; this.spaceHeld = space; this.choose(star); return; }
    const to = ({ ArrowRight: Math.min(5, star + 1), ArrowUp: Math.min(5, star + 1), ArrowLeft: Math.max(1, star - 1), ArrowDown: Math.max(1, star - 1), Home: 1, End: 5 } as Record<string, number>)[event.key];
    if (to) { event.preventDefault(); this.spaceHeld = false; this.tip?.dismiss(); this.radios()[to - 1].focus(); if (this.current() !== to) { this.current.set(to); this.paint(); this.rated.emit(to); } }
  }
  keyup(event: KeyboardEvent): void {
    if (event.key !== ' ' && event.key !== 'Spacebar') return; event.preventDefault();
    const win = this.host.nativeElement.ownerDocument.defaultView; if (win?.requestAnimationFrame) win.requestAnimationFrame(() => { this.spaceHeld = false; }); else this.spaceHeld = false;
  }
  releaseSpace(): void { this.spaceHeld = false; }
}
