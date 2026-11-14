import { Component, inject, input } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { PreferenceCategoryComponent } from '../kit/preference-category.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { BriefEditorStore } from './brief-editor.store';
import { BuddyControlsComponent } from './buddy-controls.component';
let sequence = 0;
@Component({ selector: 'gcsp-account-preferences', imports: [ButtonDirective, PreferenceCategoryComponent, StatusScreenComponent, BuddyControlsComponent], styleUrl: './preferences.component.css', template: `
  @if (store.editor(); as editor) {
    <section class="compact-preferences" [attr.aria-labelledby]="id + '-title'">
      <div class="preference-heading"><h2 [id]="id + '-title'" tabindex="-1">Preferences</h2>
      @if (store.understanding(); as score) { <div><label [for]="id + '-meter'">Understanding your preferences</label><meter [id]="id + '-meter'" min="0" [max]="score.maximum" [value]="score.value">{{ score.value }} / {{ score.maximum }}</meter><p class="gcsp-note">{{ score.value }} / {{ score.maximum }} input completeness{{ score.pending ? ' · Not yet saved' : '' }}</p></div> }</div>
      <fieldset class="preference-mode" [disabled]="store.locked() || store.fullBusy()"><legend>What would you like next?</legend>
        <label><input type="radio" [name]="id + '-mode'" [checked]="!store.sameAgain()" (change)="store.toggleSameAgain(false)" />Set my preferences</label>
        <label><input type="radio" [name]="id + '-mode'" [checked]="store.sameAgain()" [disabled]="!editor.initial.sameAgain.available" (change)="store.toggleSameAgain(true)" />Same again, please!</label>
      </fieldset>
      @if (!editor.initial.sameAgain.available) { <p class="gcsp-note">{{ editor.initial.sameAgain.reason === 'current-car-unidentified' ? 'Your current car details are incomplete.' : 'Add your current car to use Same again.' }}</p> }
      @if (store.sameAgain()) { <p>More like {{ carDescription() || 'your current car' }}. Your saved preferences are kept.</p> }
      @else { <div class="category-grid">@for (key of editor.context.accountPreferences.order; track key) {
        <gcsp-preference-category [id]="id + '-' + key" [definition]="editor.context.accountPreferences.categories[key]" [state]="store.category(key)" [open]="store.openCategory() === key" [removing]="store.pendingRemoval() === key" [disabled]="store.locked() || store.fullBusy()" (opened)="store.open(key)" (changed)="store.change(key, $event)" (removeRequested)="store.requestRemove(key)" (removed)="remove(key)" (kept)="keep(key)" />
      }</div> }
      <p role="status">{{ store.message() }}</p><div class="gcsp-actions">@if (store.failure() && !store.locked()) { <button gcspButton type="button" (click)="store.retry()">Try again</button> }@if (store.failure()) { <button gcspButton variant="ghost" type="button" (click)="store.reload()">Reload preferences</button> }@if (store.queueNeedsReview()) { <button gcspButton type="button" (click)="store.retry()">Save kept changes</button> }</div>
      <gcsp-buddy-controls [buddy]="editor.initial.buddy" [disabledReason]="store.buddyBlockedReason() ?? ''" [message]="store.buddyMessage()" [pendingAction]="store.buddyPendingAction()" [failure]="store.buddyFailure()" [operationId]="store.buddyOperationId()" [canRetry]="store.buddyCanRetry()" [refreshing]="store.buddyRefreshing()" (action)="store.runBuddyCommand($event)" (retryRequest)="store.retryBuddy()" (reloadStatus)="store.reloadBuddyStatus()" />
    </section>
  } @else { <gcsp-status-screen title="Your preferences" [level]="2" [busy]="store.loading()" [message]="store.loading() ? 'Loading your preferences.' : store.message() || 'Your preferences are unavailable.'">@if (!store.loading()) { <button gcspButton type="button" (click)="store.load()">Try again</button> }</gcsp-status-screen> }
` })
export class AccountPreferencesComponent {
  readonly store = inject(BriefEditorStore); readonly carDescription = input(''); readonly id = `account-preferences-${++sequence}`;
  private focus(key: string): void { queueMicrotask(() => document.getElementById(`${this.id}-${key}-panel`)?.parentElement?.querySelector<HTMLElement>('.category-title')?.focus()); }
  remove(key: string): void { this.store.confirmRemove(key); this.focus(key); }
  keep(key: string): void { this.store.keep(); this.focus(key); }
}
