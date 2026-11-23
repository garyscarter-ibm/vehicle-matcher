import { describe, expect, it, vi } from 'vitest';
import { PRESENTER_ACTION_KEY, publishPresenterAction, subscribePresenterActions } from './presenter-actions';

describe('presenter refresh signals', () => {
  it('publishes same-page and cross-tab signals without command or identity data', () => {
    const listener = vi.fn(); const stop = subscribePresenterActions(document)(listener);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    publishPresenterAction(document);
    expect(listener).toHaveBeenCalledOnce(); expect(write).toHaveBeenCalledWith(PRESENTER_ACTION_KEY, expect.any(String));
    expect(JSON.parse(write.mock.calls[0][1])).toEqual({ at: expect.any(Number), nonce: expect.any(String) });
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' })); expect(listener).toHaveBeenCalledOnce();
    window.dispatchEvent(new StorageEvent('storage', { key: PRESENTER_ACTION_KEY })); expect(listener).toHaveBeenCalledTimes(2);
    stop(); stop(); publishPresenterAction(document); expect(listener).toHaveBeenCalledTimes(2); write.mockRestore();
  });
  it('does not turn storage refusal into a command failure', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => publishPresenterAction(document)).not.toThrow(); write.mockRestore();
  });
});
