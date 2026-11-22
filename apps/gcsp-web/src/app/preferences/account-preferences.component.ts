import { Component, effect, ElementRef, inject, input } from '@angular/core';
import { ButtonDirective } from '../kit/button.directive';
import { PreferenceCategoryComponent } from '../kit/preference-category.component';
import { PreferenceModeComponent } from '../kit/preference-mode.component';
import { UnderstandingMeterComponent } from '../kit/understanding-meter.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { BriefEditorStore } from './brief-editor.store';
import { BuddyControlsComponent } from './buddy-controls.component';
let sequence = 0;
@Component({ selector: 'gcsp-account-preferences', imports: [ButtonDirective, PreferenceCategoryComponent, PreferenceModeComponent, UnderstandingMeterComponent, StatusScreenComponent, BuddyControlsComponent], styleUrl: './preferences.component.css', template: `
  @if (store.editor(); as editor) {
    <section class="gcsp-prefs gcsp-prefs-choice" [class.is-disabled]="store.locked() || store.fullBusy()" [class.is-same-again]="store.sameAgain()" [attr.aria-labelledby]="id + '-title'">
      <div class="gcsp-prefs-head"><div><h2 class="gcsp-h2" [id]="id + '-title'" tabindex="-1">Your preferences</h2><p class="gcsp-note" [hidden]="store.sameAgain()">Choose at least {{ editor.context.accountPreferences.minimumCategories }} categories. Tell your buddy what matters.</p></div>
        <div class="gcsp-prefs-understanding" data-slot="understanding">@if (store.understanding(); as score) { <gcsp-understanding-meter [id]="id + '-understanding'" [value]="score.value" [maximum]="score.maximum" [pending]="score.pending" [failed]="!!store.failure()" /> }</div>
      </div>
      <gcsp-preference-mode [id]="id" [on]="store.sameAgain()" [available]="editor.initial.sameAgain.available" [reason]="editor.initial.sameAgain.reason ?? ''" [description]="carDescription()" [disabled]="store.locked() || store.fullBusy()" (toggled)="store.toggleSameAgain($event)" />
      <div class="gcsp-prefs-tiles" [hidden]="store.sameAgain()">@for (key of editor.context.accountPreferences.order; track key) {
        <gcsp-preference-category presentation="tile" [panelId]="id + '-panel'" [categoryKey]="key" [id]="id + '-' + key" [definition]="editor.context.accountPreferences.categories[key]" [state]="store.category(key)" [open]="store.openCategory() === key" [disabled]="store.locked() || store.fullBusy() || store.sameAgain()" (opened)="store.open(key)" (removeRequested)="store.requestRemove(key)" />
      }</div>
      @if (!store.sameAgain()) {
        @if (store.pendingRemoval(); as key) { <gcsp-preference-category presentation="removal" [categoryKey]="key" [id]="id + '-' + key" [definition]="editor.context.accountPreferences.categories[key]" [state]="store.category(key)" [removing]="true" [disabled]="store.locked() || store.fullBusy()" (removed)="remove(key)" (kept)="keep(key)" /> }
        @for (key of editor.context.accountPreferences.order; track key) { @if (store.openCategory() === key) { <gcsp-preference-category presentation="panel" [panelId]="id + '-panel'" [categoryKey]="key" [id]="id + '-' + key" [definition]="editor.context.accountPreferences.categories[key]" [state]="store.category(key)" [open]="true" [disabled]="store.locked() || store.fullBusy()" (changed)="store.change(key, $event)" (closed)="close(key)" /> } }
      }
      @if (store.sameAgain() || !store.openCategory()) { <div class="gcsp-prefs-panel" [id]="id + '-panel'" hidden></div> }
      <div class="gcsp-prefs-foot"><div class="gcsp-prefs-statusline"><p class="gcsp-prefs-status" [class.is-failed]="!!store.failure()" [class.is-pending]="store.saving()" role="status" [id]="id + '-status'">{{ store.message() }}</p>
        @if (store.failure() && !store.locked()) { <button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" (click)="store.retry()">Try again</button> }@if (store.failure()) { <button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" (click)="store.reload()">Reload preferences</button> }@if (store.queueNeedsReview()) { <button gcspButton class="vm-btn vm-btn-ghost" variant="ghost" type="button" (click)="store.retry()">Save kept changes</button> }
      </div><div class="gcsp-prefs-action" data-slot="action"></div></div>
      <gcsp-buddy-controls [buddy]="editor.initial.buddy" [disabledReason]="store.buddyBlockedReason() ?? ''" [message]="store.buddyMessage()" [pendingAction]="store.buddyPendingAction()" [failure]="store.buddyFailure()" [operationId]="store.buddyOperationId()" [canRetry]="store.buddyCanRetry()" [refreshing]="store.buddyRefreshing()" (action)="store.runBuddyCommand($event)" (retryRequest)="store.retryBuddy()" (reloadStatus)="store.reloadBuddyStatus()" />
    </section>
  } @else { <gcsp-status-screen title="Your preferences" [level]="2" [busy]="store.loading()" [message]="store.loading() ? 'Loading your preferences.' : store.message() || 'Your preferences are unavailable.'">@if (!store.loading()) { <button gcspButton type="button" (click)="store.load()">Try again</button> }</gcsp-status-screen> }
` })
export class AccountPreferencesComponent {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly store = inject(BriefEditorStore); readonly carDescription = input(''); readonly id = `account-preferences-${++sequence}`;
  constructor() {
    effect(() => {
      const key = this.store.pendingRemoval(); const root = this.element.nativeElement; const active = root.ownerDocument.activeElement;
      if (key && (!active || active === root.ownerDocument.body || root.contains(active))) queueMicrotask(() => root.querySelector<HTMLButtonElement>('.gcsp-prefs-removal button')?.focus());
    });
  }
  private focus(key: string, selector = '.gcsp-prefs-open'): void { queueMicrotask(() => this.element.nativeElement.querySelector<HTMLElement>(`#${this.id}-${key}-tile`)?.closest('.gcsp-prefs-tile')?.querySelector<HTMLElement>(selector)?.focus()); }
  close(key: string): void { this.store.open(key); this.focus(key); }
  remove(key: string): void { this.store.confirmRemove(key); this.focus(key); }
  keep(key: string): void { this.store.keep(); this.focus(key, '.gcsp-prefs-remove'); }
}
