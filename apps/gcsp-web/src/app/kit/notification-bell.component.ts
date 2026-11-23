import { DOCUMENT } from '@angular/common';
import { Component, ElementRef, OnDestroy, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { NotificationModel, NotificationNote, emptyNotifications } from './notification-bell.types';

let uid = 0;
@Component({ selector: '[gcspNotificationBell]', host: { class: 'gcsp-bell', '[attr.data-status]': 'model().status' }, templateUrl: './notification-bell.component.html' })
export class NotificationBellComponent implements OnDestroy {
  readonly model = input<NotificationModel>(emptyNotifications('unavailable'));
  readonly bellId = input(`gcsp-bell-${++uid}`);
  readonly noteMs = input(6000);
  readonly pinned = input(false);
  readonly previewOpen = input(false);
  readonly opened = output<void>();
  readonly navigate = output<string>();
  readonly isOpen = signal(false);
  readonly note = signal<NotificationNote | null>(null);
  readonly announcement = signal('');
  readonly waiting = computed(() => this.model().status === 'ok' && this.model().waiting > 0 ? 1 : 0);
  readonly label = computed(() => this.waiting() ? 'Notifications, 1 car offer waiting' : 'Notifications, none waiting');
  private readonly doc = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private lastSignature: string | null = null;
  private lastNote: string | null = null;
  private noteTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  constructor() {
    effect(() => {
      const model = this.model(); const signature = JSON.stringify([model.status, model.rows]);
      const panel = this.panel()?.nativeElement;
      if (signature !== this.lastSignature) {
        this.lastSignature = signature;
        if (panel?.contains(this.doc.activeElement)) queueMicrotask(() => {
          if (!this.destroyed && !panel.contains(this.doc.activeElement)) this.trigger()?.nativeElement.focus();
        });
      }
      untracked(() => {
        if (model.status !== 'ok') { this.hideNote(); this.announcement.set(''); this.lastNote = null; }
        this.showNote(model.note);
      });
    });
    effect(() => { if (this.previewOpen()) untracked(() => this.open()); });
  }
  toggle(): void { if (this.isOpen()) this.close(); else this.open(); }
  open(): void {
    if (this.isOpen() || this.destroyed) return;
    this.isOpen.set(true); this.hideNote(); this.opened.emit();
    if (!this.pinned()) { this.doc.addEventListener('keydown', this.onKey); this.doc.addEventListener('click', this.onOutside, true); }
  }
  close(restoreFocus = true): void {
    if (!this.isOpen()) return;
    this.isOpen.set(false); this.doc.removeEventListener('keydown', this.onKey); this.doc.removeEventListener('click', this.onOutside, true);
    if (restoreFocus) this.trigger()?.nativeElement.focus();
  }
  onPanelClick(event: MouseEvent): void {
    const link = (event.target as Element | null)?.closest?.('a[href]');
    if (!link) return;
    this.close(false);
    if (!(event.metaKey || event.ctrlKey || event.shiftKey || event.button)) { event.preventDefault(); this.navigate.emit(link.getAttribute('href')!); }
  }
  ngOnDestroy(): void { this.close(false); this.hideNote(); this.destroyed = true; }
  private readonly onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') this.close(); };
  private readonly onOutside = (event: MouseEvent) => {
    const root = this.host.nativeElement;
    if (root.contains(event.target as Node)) return;
    const active = this.doc.activeElement; const stranded = !active || active === this.doc.body || root.contains(active);
    this.close(false); if (stranded) this.trigger()?.nativeElement.focus();
  };
  private hideNote(): void { if (this.noteTimer !== null) clearTimeout(this.noteTimer); this.noteTimer = null; this.note.set(null); }
  private showNote(next: NotificationNote | null): void {
    if (!next || next.id === this.lastNote) return;
    this.lastNote = next.id; this.announcement.set(`${next.title}. ${next.text}`);
    if (this.isOpen()) return;
    this.hideNote(); this.note.set(next); this.noteTimer = setTimeout(() => this.hideNote(), this.noteMs());
  }
}
