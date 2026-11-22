import { ChangeDetectorRef, Component, ElementRef, OnDestroy, ViewChild, afterRenderEffect, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivityStore, ActivityView } from '../activity/activity.store';
import { exclusionLines, respondBy, searchLines } from '../activity/activity.copy';
import { BriefEditorStore } from '../preferences/brief-editor.store';
import { BuddyCommandAction } from '../preferences/brief.types';
import { BuddyTileComponent } from '../kit/buddy-tile.component';
import { ActivityTimelineComponent } from '../kit/activity-timeline.component';
import { ActivityOfferComponent } from '../kit/activity-offer.component';
import { SideDrawerComponent } from '../kit/side-drawer.component';
import { StatusScreenComponent } from '../kit/status-screen.component';
import { ButtonDirective } from '../kit/button.directive';
import { buddyEvents } from './account-buddy.copy';
type CommandView = { scope: string; view: ActivityView; refreshing: boolean };
@Component({ selector: 'gcsp-account-buddy', providers: [ActivityStore], host: { class: 'gcsp-account-buddy' },
  imports: [BuddyTileComponent, ActivityTimelineComponent, ActivityOfferComponent, SideDrawerComponent, StatusScreenComponent, ButtonDirective],
  templateUrl: './account-buddy.component.html' })
export class AccountBuddyComponent implements OnDestroy {
  readonly activity = inject(ActivityStore); readonly brief = inject(BriefEditorStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef); private readonly changes = inject(ChangeDetectorRef);
  @ViewChild(SideDrawerComponent, { static: true }) private drawer!: SideDrawerComponent;
  @ViewChild('drawerContent', { static: true }) private content!: ElementRef<HTMLElement>;
  private readonly command = signal<CommandView | null>(null); readonly drawerKind = signal<'history' | 'offer' | null>(null);
  private lastScope: string | null | undefined; private lastEditorKey: string | null = null; private lastProjection: unknown; private focusHeading = false; private disposed = false;
  readonly view = computed(() => { const view = this.activity.view(); const command = this.command();
    return view.phase === 'loading' && command?.scope === this.brief.scope() ? command.view : view; });
  readonly projection = computed(() => this.view().projection); readonly events = computed(() => buddyEvents(this.projection()));
  readonly result = computed(() => { const value = this.projection(); return value ? { status: 'ok' as const, value } : null; });
  readonly phase = computed(() => ['loading', 'auth-loading'].includes(this.view().phase) ? 'loading' : this.view().phase === 'ready' ? 'ready' : 'unavailable');
  readonly pending = computed(() => !!this.command() || this.brief.buddyBusy() || this.view().pending);
  readonly paused = computed(() => this.projection()?.permission?.paused === true);
  readonly searchStatus = computed(() => { const value = this.projection(); return value ? searchLines(value, this.paused()) : []; });
  readonly exclusions = computed(() => { const value = this.projection(); return value ? exclusionLines(value, this.paused()) : []; });
  readonly deadline = computed(() => respondBy(this.projection()?.currentOffer));
  readonly canPause = computed(() => !this.brief.buddyBlockedReason() && this.brief.editor()?.initial.buddy.state === 'engaged');
  readonly canResume = computed(() => !this.brief.buddyBlockedReason() && this.brief.editor()?.initial.buddy.state === 'disengaged' && this.brief.editor()?.initial.buddy.reason === 'paused');
  readonly recoveryMessage = computed(() => this.brief.buddyMessage() || this.brief.buddyBlockedReason() || '');
  constructor() {
    effect(() => {
      const scope = this.brief.scope(); const phase = this.activity.view().phase; const command = this.command(); const pending = this.brief.buddyPendingAction();
      const editor = this.brief.editor(); const editorKey = editor ? JSON.stringify([editor.initial.briefVersion, editor.initial.buddy.state]) : null;
      untracked(() => {
        if (scope !== this.lastScope || phase === 'restarted' || !scope) {
          this.drawer?.close(false); this.drawerKind.set(null); this.command.set(null); this.lastScope = scope; this.lastEditorKey = editorKey;
        } else if (!pending) {
          const editorChanged = editorKey !== null && this.lastEditorKey !== null && editorKey !== this.lastEditorKey;
          if (editorKey !== null) this.lastEditorKey = editorKey;
          if (command && !command.refreshing) {
            const refreshing = { ...command, refreshing: true }; this.command.set(refreshing);
            void this.activity.refresh().finally(() => { if (!this.disposed && this.command() === refreshing) this.command.set(null); });
          } else if (editorChanged && !command) void this.activity.refresh();
        }
      });
    });
    effect(() => {
      const projection = this.projection(); this.view().offerDisplay;
      if (projection !== this.lastProjection && this.content?.nativeElement.contains(this.host.nativeElement.ownerDocument.activeElement)) this.focusHeading = true;
      this.lastProjection = projection;
    });
    afterRenderEffect(() => { this.view(); this.drawerKind(); if (this.focusHeading) { this.focusHeading = false; this.host.nativeElement.querySelector<HTMLElement>('.gcsp-side-drawer-heading h2')?.focus(); } });
  }
  run(action: 'pauseSearch' | 'resumeSearch'): void {
    if (this.pending() || this.phase() !== 'ready' || (action === 'pauseSearch' ? !this.canPause() : !this.canResume())) return;
    const scope = this.brief.scope(); const view = this.view(); if (!scope) return;
    void this.brief.runBuddyCommand(action);
    this.retainCommand(scope, view, action);
  }
  retryCommand(): void {
    const scope = this.brief.scope(); if (!scope || !this.brief.buddyCanRetry() || this.pending()) return;
    const view = this.view(); this.brief.retryBuddy(); this.retainCommand(scope, view);
  }
  private retainCommand(scope: string, view: ActivityView, action?: BuddyCommandAction): void {
    const pending = this.brief.buddyPendingAction();
    if (pending && (!action || pending === action)) this.command.set({ scope, view, refreshing: false });
  }
  async reloadBuddy(): Promise<void> { const scope = this.brief.scope(); if (!scope || this.pending()) return; await this.brief.reloadBuddyStatus(); if (!this.disposed && this.brief.scope() === scope) await this.activity.refresh(); }
  open(kind: 'history' | 'offer', opener: HTMLElement): void {
    if (this.view().phase !== 'ready' || !this.projection() || kind === 'offer' && this.projection()?.currentOffer?.state !== 'active') return;
    this.drawer.close(false); this.drawerKind.set(kind); this.changes.detectChanges(); this.drawer.open(opener);
  }
  closed(): void { this.drawerKind.set(null); }
  ngOnDestroy(): void { this.disposed = true; this.drawer?.close(false); this.activity.dispose(); }
}
