const SESSION_CHANGE_KEY = 'gcsp-session-change';

// Only an opaque change marker crosses tabs. The next page obtains authority from its server cookie.
export function announceSessionChange(win) {
  try { win.localStorage.setItem(SESSION_CHANGE_KEY, `${Date.now()}:${Math.random()}`); }
  catch { /* Storage can be disabled; the current tab still navigates through the server guard. */ }
}

export function installSessionLifecycle({ win, active, clear, reload }) {
  let suspended = false;
  function suspend() { suspended = true; clear(); }
  function onStorage(event) {
    if (event.key !== SESSION_CHANGE_KEY || suspended || !active()) return;
    suspend(); reload();
  }
  function onPageHide() { if (active()) suspend(); }
  function onPageShow(event) {
    if (!event.persisted || (!suspended && !active())) return;
    suspend(); reload();
  }
  win.addEventListener('storage', onStorage);
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);
  return () => {
    win.removeEventListener('storage', onStorage);
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', onPageShow);
  };
}
