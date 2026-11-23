export const PRESENTER_ACTION_KEY = 'gcsp:presenter-action';

export function subscribePresenterActions(target: Document) {
  return (listener: () => void): (() => void) => {
    const handler = () => listener();
    const crossTab = (event: StorageEvent) => { if (event.key === PRESENTER_ACTION_KEY) listener(); };
    target.addEventListener(PRESENTER_ACTION_KEY, handler);
    target.defaultView?.addEventListener('storage', crossTab);
    let active = true;
    return () => {
      if (!active) return;
      active = false; target.removeEventListener(PRESENTER_ACTION_KEY, handler); target.defaultView?.removeEventListener('storage', crossTab);
    };
  };
}

export function publishPresenterAction(target: Document): void {
  target.dispatchEvent(new Event(PRESENTER_ACTION_KEY));
  try {
    target.defaultView?.localStorage.setItem(PRESENTER_ACTION_KEY, JSON.stringify({ at: Date.now(), nonce: crypto.randomUUID() }));
  } catch { /* A successful presenter command stays successful when browser storage is refused. */ }
}
