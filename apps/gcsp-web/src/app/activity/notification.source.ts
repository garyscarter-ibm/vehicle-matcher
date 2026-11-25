import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, effect, inject, untracked } from '@angular/core';
import { AuthPort, SessionState } from '../auth/auth.port';
import { NotificationModel, emptyNotifications } from '../kit/notification-bell.types';
import { subscribePresenterActions } from '../kit/presenter-actions';
import { ActivityClient } from './activity.client';
import { ActivityOfferDisplay, ActivityProjection, ActivityRequestOptions, ActivityResult } from './activity.types';
import { notificationDeadline, notificationModel } from './notification.model';

interface NotificationAdapter {
  readActivity(options: ActivityRequestOptions): Promise<ActivityResult<ActivityProjection>>;
  readOfferDisplay?(options: { offerId: string; runId: string; signal: AbortSignal }): Promise<ActivityResult<ActivityOfferDisplay>>;
}
interface SourceOptions {
  adapter: NotificationAdapter;
  document: Document;
  subscribe?: (listener: () => void) => (() => void);
  pollMs?: number;
}

/** Frozen source lifecycle: one coalesced read, cached display, one-off note and note-free retained model. */
export function createNotificationSource({ adapter, document: doc, subscribe, pollMs = 30_000 }: SourceOptions) {
  let model = emptyNotifications();
  let update: ((model: NotificationModel) => void) | null = null;
  let stops: (() => void)[] = [];
  let timer: ReturnType<typeof setInterval> | null = null;
  let abort: AbortController | null = null;
  let busy = false; let again = false; let hasRead = false; let activeId: string | null = null;
  let display: ActivityOfferDisplay | null = null; let connection = 0;
  const visible = () => doc.visibilityState !== 'hidden';
  const push = (next: NotificationModel) => { model = { ...next, note: null }; update?.(next); };

  async function readOnce(signal: AbortSignal): Promise<void> {
    let out: ActivityResult<ActivityProjection> | null;
    try { out = await adapter.readActivity({ signal }); } catch { out = null; }
    if (signal.aborted) return;
    if (out?.status !== 'ok') {
      if (!hasRead) push(emptyNotifications('unavailable'));
      return;
    }
    const value = out.value; const offer = value.currentOffer; const offerId = offer?.offerRef.offerId;
    if (offerId && display?.offerRef.offerId !== offerId) display = null;
    if (offerId && !display && adapter.readOfferDisplay) {
      let result: ActivityResult<ActivityOfferDisplay> | null;
      try { result = await adapter.readOfferDisplay({ offerId, runId: value.runId, signal }); } catch { result = null; }
      if (signal.aborted) return;
      display = result?.status === 'ok' ? result.value : null;
    }
    const next = notificationModel(value, offerId ? display : null);
    const nowActive = offer?.state === 'active' ? offerId ?? null : null;
    const text = offer ? [display?.title, notificationDeadline(offer)].filter(Boolean).join('. ') : '';
    hasRead && nowActive && nowActive !== activeId
      ? push({ ...next, note: { id: nowActive, title: 'Your buddy found a car', text: text ? `${text}.` : 'Reserved for you.' } })
      : push(next);
    hasRead = true; activeId = nowActive;
  }

  async function read(): Promise<void> {
    if (!update) return;
    if (busy) { again = true; return; }
    busy = true; const mine = connection; const controller = new AbortController(); abort = controller;
    try { await readOnce(controller.signal); }
    finally {
      if (mine === connection) {
        busy = false;
        const repeat = again && !!update; again = false;
        if (repeat) void read();
      }
    }
  }
  const poll = () => { if (visible() && !busy) void read(); };
  function arm(): void { if (timer === null && Number.isFinite(pollMs) && pollMs > 0 && visible()) timer = setInterval(poll, pollMs); }
  function disarm(): void { if (timer !== null) clearInterval(timer); timer = null; }
  const onPageshow = (event: PageTransitionEvent) => { if (event.persisted) void read(); };
  function onVisibility(): void { if (visible()) { arm(); void read(); } else disarm(); }
  function disconnect(token: number): void {
    if (token !== connection) return;
    connection++; update = null; again = false; abort?.abort(); abort = null; busy = false; disarm();
    for (const stop of stops.splice(0)) stop();
  }
  return {
    getModel: () => model,
    refresh: read,
    connect(next: (model: NotificationModel) => void): () => void {
      disconnect(connection);
      const token = ++connection; update = next; next(model);
      const stopAction = subscribe?.(() => void read());
      doc.addEventListener('visibilitychange', onVisibility); doc.defaultView?.addEventListener('pageshow', onPageshow);
      stops = [() => { doc.removeEventListener('visibilitychange', onVisibility); doc.defaultView?.removeEventListener('pageshow', onPageshow); }];
      if (stopAction) stops.push(stopAction);
      arm(); void read(); return () => disconnect(token);
    },
    destroy(): void { disconnect(connection); },
  };
}

export function notificationScopeKey(state: SessionState): string | null {
  if (state.status !== 'ready') return null;
  const c = state.context;
  return c.roles.includes('employee') && !c.roles.includes('presenter') && [c.subject, c.environmentId, c.runId, c.employeeId].every((v) => typeof v === 'string' && v.trim())
    ? JSON.stringify([c.subject, c.environmentId, c.runId, c.employeeId]) : null;
}
type Update = (model: NotificationModel, scopeKey: string | null) => void;

/** One transient source per authenticated employee scope, shared across shell remounts. */
@Injectable({ providedIn: 'root' })
export class NotificationSource {
  private readonly auth = inject(AuthPort);
  private readonly client = inject(ActivityClient);
  private readonly doc = inject(DOCUMENT);
  private readonly listeners = new Set<Update>();
  private scopeKey: string | null | undefined;
  private source: ReturnType<typeof createNotificationSource> | null = null;
  private disconnect: (() => void) | null = null;
  constructor() {
    effect(() => { const key = notificationScopeKey(this.auth.state()); untracked(() => this.setScope(key)); });
    inject(DestroyRef).onDestroy(() => { this.source?.destroy(); this.listeners.clear(); });
  }
  connect(update: Update): () => void {
    this.setScope(notificationScopeKey(this.auth.state()));
    this.listeners.add(update);
    if (this.listeners.size === 1) this.start();
    else update(this.source?.getModel() ?? emptyNotifications('unavailable'), this.scopeKey ?? null);
    let active = true;
    return () => {
      if (!active) return;
      active = false; this.listeners.delete(update);
      if (!this.listeners.size) { this.disconnect?.(); this.disconnect = null; }
    };
  }
  private setScope(key: string | null): void {
    if (key === this.scopeKey) return;
    this.disconnect?.(); this.disconnect = null; this.source?.destroy(); this.scopeKey = key;
    this.source = key ? createNotificationSource({ adapter: this.client, document: this.doc, subscribe: subscribePresenterActions(this.doc) }) : null;
    if (this.listeners.size) this.start();
  }
  private start(): void {
    const key = this.scopeKey ?? null;
    const emit = (model: NotificationModel) => {
      if (key !== notificationScopeKey(this.auth.state())) return;
      for (const update of this.listeners) update(model, key);
    };
    if (this.source) this.disconnect = this.source.connect(emit);
    else emit(emptyNotifications('unavailable'));
  }
}
