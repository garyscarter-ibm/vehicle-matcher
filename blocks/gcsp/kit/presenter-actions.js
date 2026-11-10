// Portal pages refresh when the console reports an action: a DOM event on this page, a storage event from other tabs.
export const PRESENTER_ACTION_KEY = 'gcsp:presenter-action';

// The subscription is bare and idempotent; it mirrors presenter-controls/controls.js, which writes the same key.
export function subscribePresenterActions(target) {
  return (listener) => {
    const handler = () => listener();
    const win = target.ownerDocument?.defaultView;
    const crossTab = (event) => { if (event.key === PRESENTER_ACTION_KEY) listener(); };
    target.addEventListener('gcsp:presenter-action', handler);
    win?.addEventListener('storage', crossTab);
    let active = true;
    return () => { if (active) { active = false; target.removeEventListener('gcsp:presenter-action', handler); win?.removeEventListener('storage', crossTab); } };
  };
}
