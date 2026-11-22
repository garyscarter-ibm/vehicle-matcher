import { DOCUMENT } from '@angular/common';
import { inject, Injectable, OnDestroy } from '@angular/core';

type Refresh = () => void | Promise<void>;

/** Native page signals only. Each screen retains authority over whether a read is safe. */
@Injectable({ providedIn: 'root' })
export class LiveRefreshService implements OnDestroy {
  private readonly document = inject(DOCUMENT);
  private readonly window = this.document.defaultView;
  private readonly subscribers = new Set<{ readonly refresh: Refresh }>();
  private readonly pending = new Set<Refresh>();
  private timer: number | null = null;
  private destroyed = false;
  private readonly visibilityChanged = () => {
    this.updateTimer();
    this.notify();
  };
  private readonly restored = (event: PageTransitionEvent) => { if (event.persisted) { this.updateTimer(); this.notify(); } };

  subscribe(refresh: Refresh): () => void {
    if (this.destroyed) return () => {};
    const subscription = { refresh };
    this.subscribers.add(subscription);
    if (this.subscribers.size === 1) {
      this.document.addEventListener('visibilitychange', this.visibilityChanged);
      this.window?.addEventListener('pageshow', this.restored);
      this.updateTimer();
    }
    return () => {
      if (!this.subscribers.delete(subscription) || this.subscribers.size) return;
      this.stop();
    };
  }
  private updateTimer(): void {
    if (this.document.visibilityState !== 'visible' || !this.subscribers.size || this.destroyed) { this.clearTimer(); return; }
    if (this.timer === null && this.window) this.timer = this.window.setInterval(() => this.notify(), 30_000);
  }
  private notify(): void {
    if (this.destroyed || this.document.visibilityState !== 'visible') return;
    for (const subscription of [...this.subscribers]) {
      if (!this.subscribers.has(subscription) || this.pending.has(subscription.refresh)) continue;
      const refresh = subscription.refresh;
      this.pending.add(refresh);
      const settled = () => { this.pending.delete(refresh); };
      try { void Promise.resolve(refresh()).then(settled, settled); }
      catch { settled(); }
    }
  }
  private clearTimer(): void {
    if (this.timer !== null) this.window?.clearInterval(this.timer);
    this.timer = null;
  }
  private stop(): void {
    this.clearTimer();
    this.document.removeEventListener('visibilitychange', this.visibilityChanged);
    this.window?.removeEventListener('pageshow', this.restored);
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.subscribers.clear();
    this.stop();
  }
}
