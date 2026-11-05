import decorate from '../vehicle-matcher/vehicle-matcher.js';
import { el, button, statusScreen } from '../vehicle-matcher/ui.js';
import { ACCESS_KEY_STORAGE } from '../vehicle-matcher/engine.js';
import { rememberRetailLocation, resolveEntryContext, retailReturnUrl } from './entry-context.js';
import { createRetailChrome, observeRetailNavigation } from './retail-chrome.js';
import { renderLauncher } from './launcher.js';

// A capability is usable only when a real entry callback is registered and enabled.
export function employeeCapabilityAvailable(capability) {
  return capability?.enabled === true && typeof capability.mount === 'function';
}

export function bootDemo({ root = document.getElementById('demo-root'), employeeCapability = null,
  decorateRetail = decorate } = {}) {
  root.demoEntryCleanup?.();
  let disposed = false;
  const cleanups = [];
  const routeCleanups = [];
  let routeIdentity;
  let gatePending = false;
  const clearRoute = () => routeCleanups.splice(0).forEach((dispose) => dispose());
  const cleanup = () => {
    disposed = true;
    clearRoute();
    cleanups.splice(0).forEach((dispose) => dispose());
    if (root.demoEntryCleanup === cleanup) delete root.demoEntryCleanup;
  };
  root.demoEntryCleanup = cleanup;
  const params = new URLSearchParams(window.location.search);
  const LOCAL_API = 'http://localhost:8787';
  const REMOTE_API = 'https://bmw-matcher-api.onrender.com';
  const pageIsLocal = window.location.protocol === 'file:'
    || ['localhost', '127.0.0.1', '::1', '[::1]', ''].includes(window.location.hostname);
  const DEFAULT_API = pageIsLocal ? LOCAL_API : REMOTE_API;

  const keyFromUrl = params.get('key');
  if (keyFromUrl) {
    sessionStorage.setItem(ACCESS_KEY_STORAGE, keyFromUrl);
  }
  if (params.has('key')) {
    params.delete('key');
    const clean = params.toString();
    window.history.replaceState(
      {}, '',
      window.location.pathname + (clean ? `?${clean}` : '') + window.location.hash,
    );
  }

  function askForPassword(message) {
    return new Promise((resolve) => {
      const overlay = el('div');
      overlay.className = 'vm-gate';
      overlay.innerHTML = `
        <form class="vm-gate-card" autocomplete="off">
          <h1 class="vm-gate-title">Private demo</h1>
          <p class="vm-gate-lede">Enter the password you were given to continue.</p>
          ${message ? `<p class="vm-gate-error">${message}</p>` : ''}
          <input class="vm-gate-input" type="password" name="vm-access"
                 placeholder="Password" aria-label="Password" autofocus>
          <button class="vm-gate-btn" type="submit">Enter</button>
        </form>`;
      const form = overlay.querySelector('.vm-gate-card');
      const input = overlay.querySelector('.vm-gate-input');
      if (root.entryContext?.state === 'employee') {
        form.classList.add('vm');
        const recovery = el('nav', 'demo-choice-actions');
        recovery.setAttribute('aria-label', 'Leave employee cars');
        recovery.append(button({ label: 'Car experiences', variant: 'ghost', href: root.entryContext.links.launcher }),
          button({ label: 'Used cars', variant: 'ghost', href: retailReturnUrl(new URL(root.entryContext.location, window.location.href)) }));
        form.append(recovery);
      }
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        sessionStorage.setItem(ACCESS_KEY_STORAGE, value);
        overlay.remove();
        resolve();
      });
      cleanups.push(() => overlay.remove());
      document.body.append(overlay);
      input.focus();
    });
  }

  const available = employeeCapabilityAvailable(employeeCapability);
  const identity = (context) => JSON.stringify([context.state, context.brand,
    new URL(context.location, window.location.href).searchParams.get('api')]);

  function employeeRoute(context) {
    const abort = new AbortController();
    let mountedCleanup;
    routeCleanups.push(() => { abort.abort(); mountedCleanup?.(); });
    const scope = el('div', 'gcsp demo-entry-host');
    const chrome = el('nav', 'vm demo-launcher-header');
    chrome.setAttribute('aria-label', 'Car experiences');
    chrome.append(button({ label: 'Car experiences', variant: 'ghost', href: context.links.launcher }),
      button({ label: 'Used cars', variant: 'ghost', href: retailReturnUrl(new URL(context.location, window.location.href)) }));
    const state = el('div', 'vm');
    const stage = el('div');
    const focus = (target) => { target.tabIndex = -1; target.focus(); };
    state.append(statusScreen({ title: 'Opening Employee cars', message: 'Loading your account.' }));
    stage.setAttribute('aria-busy', 'true');
    scope.append(chrome, state, stage);
    root.replaceChildren(scope);
    focus(state.querySelector('h2'));
    const failed = () => {
      if (abort.signal.aborted) return;
      mountedCleanup?.();
      stage.replaceChildren();
      stage.setAttribute('aria-busy', 'false');
      root.dataset.entryState = 'employee-load-error';
      state.replaceChildren(statusScreen({ title: 'Employee cars could not open',
        message: 'Try again or choose another car experience.', role: 'alert',
        actions: [button({ label: 'Retry', onClick: render })] }));
      focus(state.querySelector('h2'));
    };
    try {
      const result = employeeCapability.mount(stage, context, { signal: abort.signal, defaultApi: DEFAULT_API });
      Promise.resolve(result).then((dispose) => {
        if (abort.signal.aborted) { if (typeof dispose === 'function') dispose(); return; }
        mountedCleanup = typeof dispose === 'function' ? dispose : undefined;
        state.remove();
        stage.setAttribute('aria-busy', 'false');
        const title = stage.querySelector('h1');
        focus(title || stage);
        if (!title) {
          const observer = new MutationObserver(() => {
            const heading = stage.querySelector('h1');
            if (heading && !abort.signal.aborted) { observer.disconnect(); focus(heading); }
          });
          observer.observe(stage, { childList: true, subtree: true });
          routeCleanups.push(() => observer.disconnect());
        }
      }, failed);
    } catch { failed(); }
  }

  function render() {
    if (disposed) return;
    clearRoute();
    const context = resolveEntryContext(window.location.href, { employeeAvailable: available });
    routeIdentity = identity(context);
    const retail = createRetailChrome({ root, params: new URLSearchParams(window.location.search), DEFAULT_API });
    root.entryContext = context;
    root.dataset.experience = context.experience;
    root.dataset.entryState = context.state;
    root.dataset.brand = context.brand || '';
    if (context.state === 'retail-picker') retail.renderPicker();
    else if (context.state === 'retail') {
      const block = retail.renderShell(context.brand);
      retail.applyOverrides(block, context.brand);
      const syncNavigation = () => {
        const location = rememberRetailLocation(window.location.href, { storage: window.sessionStorage });
        if (location) retail.updateNavigation(new URL(location, window.location.href));
      };
      routeCleanups.push(observeRetailNavigation(window, syncNavigation));
      syncNavigation();
      const retryAuth = () => {
        if (document.querySelector('.vm-gate')) return;
        askForPassword('That password was not right. Please try again.')
          .then(() => { if (!disposed && block.isConnected) decorateRetail(block); });
      };
      window.addEventListener('vm-auth-failed', retryAuth);
      routeCleanups.push(() => window.removeEventListener('vm-auth-failed', retryAuth));
      decorateRetail(block);
    } else if (context.state === 'employee' && available) {
      employeeRoute(context);
    } else renderLauncher(root, context, {
      input: new URL(context.location, window.location.href).href,
    });
    root.dispatchEvent(new CustomEvent('demo-entry-ready', { detail: context, bubbles: true }));
  }
  const retryEmployeeAuth = () => {
    if (disposed || root.entryContext?.state !== 'employee' || gatePending) return;
    gatePending = true;
    clearRoute();
    askForPassword('That password was not right. Please try again.').then(() => {
      gatePending = false;
      if (!disposed) render();
    });
  };
  window.addEventListener('vm-auth-failed', retryEmployeeAuth);
  cleanups.push(() => window.removeEventListener('vm-auth-failed', retryEmployeeAuth));
  cleanups.push(observeRetailNavigation(window, () => {
    if (disposed || gatePending || routeIdentity === undefined) return;
    const context = resolveEntryContext(window.location.href, { employeeAvailable: available });
    if (identity(context) !== routeIdentity) render();
  }));
  const apiHost = (() => {
    try { return new URL(params.get('api') || DEFAULT_API, window.location.href).hostname; }
    catch { return ''; }
  })();
  const apiIsLocal = apiHost === 'localhost' || apiHost === '127.0.0.1' || apiHost === '::1';

  if (sessionStorage.getItem(ACCESS_KEY_STORAGE) || pageIsLocal || apiIsLocal) {
    render();
  } else {
    askForPassword().then(render);
  }
  return cleanup;
}
