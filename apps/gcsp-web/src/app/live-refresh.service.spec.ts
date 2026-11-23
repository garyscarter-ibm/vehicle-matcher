import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveRefreshService } from './live-refresh.service';

// Synthetic DOM events prove orchestration, not actual hidden-tab or BFCache behavior.
describe('shared native live refresh lifecycle', () => {
  let service: LiveRefreshService; let host: Document; let visibility: DocumentVisibilityState;
  const restored = (persisted: boolean) => Object.assign(new Event('pageshow'), { persisted });
  beforeEach(() => {
    vi.useFakeTimers(); visibility = 'visible'; host = document.implementation.createHTMLDocument('refresh');
    Object.defineProperty(host, 'defaultView', { configurable: true, value: window });
    vi.spyOn(host, 'visibilityState', 'get').mockImplementation(() => visibility);
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: host }] });
    service = TestBed.inject(LiveRefreshService);
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('starts no resource or initial read before or during registration, then shares one 30-second timer', async () => {
    const start = vi.spyOn(window, 'setInterval'); const first = vi.fn(); const second = vi.fn();
    expect(vi.getTimerCount()).toBe(0);
    service.subscribe(first); service.subscribe(second);
    expect(first).not.toHaveBeenCalled(); expect(second).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1); expect(start.mock.calls[0][1]).toBe(30_000);
    await vi.advanceTimersByTimeAsync(29_999); expect(first).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  });

  it('stops polling while hidden and rereads immediately when visible again', async () => {
    const refresh = vi.fn(); service.subscribe(refresh);
    visibility = 'hidden'; host.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0); await vi.advanceTimersByTimeAsync(90_000); expect(refresh).not.toHaveBeenCalled();
    visibility = 'visible'; host.dispatchEvent(new Event('visibilitychange')); await Promise.resolve();
    expect(refresh).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000); expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('does not start a poll for a hidden registration and ignores hidden restores', async () => {
    visibility = 'hidden'; const refresh = vi.fn(); service.subscribe(refresh);
    expect(vi.getTimerCount()).toBe(0); window.dispatchEvent(restored(true)); expect(refresh).not.toHaveBeenCalled();
    visibility = 'visible'; window.dispatchEvent(restored(true)); expect(refresh).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
  });

  it('rereads only persisted pageshow restores and leaves ordinary initial pageshow silent', async () => {
    const refresh = vi.fn(); service.subscribe(refresh);
    window.dispatchEvent(restored(false)); expect(refresh).not.toHaveBeenCalled();
    window.dispatchEvent(restored(true)); await Promise.resolve(); expect(refresh).toHaveBeenCalledOnce();
    window.dispatchEvent(restored(true)); expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('isolates thrown and rejected callbacks and lets the next trigger retry them', async () => {
    const thrown = vi.fn(() => { throw new Error('consumer read'); });
    const rejected = vi.fn(() => Promise.reject(new Error('consumer promise'))); const good = vi.fn();
    service.subscribe(thrown); service.subscribe(rejected); service.subscribe(good);
    host.dispatchEvent(new Event('visibilitychange')); await Promise.resolve();
    expect(good).toHaveBeenCalledOnce();
    host.dispatchEvent(new Event('visibilitychange')); await Promise.resolve();
    expect(thrown).toHaveBeenCalledTimes(2); expect(rejected).toHaveBeenCalledTimes(2); expect(good).toHaveBeenCalledTimes(2);
  });

  it('does not overlap an unresolved callback while other consumers keep refreshing', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const slow = vi.fn(() => pending); const quick = vi.fn(); service.subscribe(slow); service.subscribe(quick);
    host.dispatchEvent(new Event('visibilitychange')); await Promise.resolve();
    window.dispatchEvent(restored(true)); await Promise.resolve();
    expect(slow).toHaveBeenCalledOnce(); expect(quick).toHaveBeenCalledTimes(2);
    release(); await pending; await Promise.resolve();
    host.dispatchEvent(new Event('visibilitychange')); expect(slow).toHaveBeenCalledTimes(2);
  });

  it('unregisters idempotently, removes the last listeners/timer and can register again', async () => {
    const removeDocument = vi.spyOn(host, 'removeEventListener'); const removeWindow = vi.spyOn(window, 'removeEventListener');
    const first = vi.fn(); const second = vi.fn(); const stopFirst = service.subscribe(first); const stopSecond = service.subscribe(second);
    stopFirst(); stopFirst(); expect(vi.getTimerCount()).toBe(1);
    host.dispatchEvent(new Event('visibilitychange')); await Promise.resolve();
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
    stopSecond(); expect(vi.getTimerCount()).toBe(0);
    expect(removeDocument).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeWindow).toHaveBeenCalledWith('pageshow', expect.any(Function));
    window.dispatchEvent(restored(true)); expect(second).toHaveBeenCalledOnce();
    const third = vi.fn(); service.subscribe(third); await vi.advanceTimersByTimeAsync(30_000); expect(third).toHaveBeenCalledOnce();
  });

  it('root destruction detaches everything and a late promise cannot restart listeners', async () => {
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    const refresh = vi.fn(() => pending); const stop = service.subscribe(refresh);
    host.dispatchEvent(new Event('visibilitychange')); TestBed.resetTestingModule();
    expect(vi.getTimerCount()).toBe(0); release(); await pending; await Promise.resolve(); stop();
    service.subscribe(vi.fn()); host.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(restored(true));
    await vi.advanceTimersByTimeAsync(60_000); expect(refresh).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('handles a document without a window without allocating a timer', () => {
    TestBed.resetTestingModule(); Object.defineProperty(host, 'defaultView', { configurable: true, value: null });
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: host }] });
    const refresh = vi.fn(); TestBed.inject(LiveRefreshService).subscribe(refresh);
    host.dispatchEvent(new Event('visibilitychange')); expect(refresh).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});
