import decorate from '../vehicle-matcher/vehicle-matcher.js';
import { el } from '../vehicle-matcher/ui.js';
import { ACCESS_KEY_STORAGE } from '../vehicle-matcher/engine.js';
import { resolveEntryContext } from './entry-context.js';
import { createRetailChrome } from './retail-chrome.js';
import { renderLauncher } from './launcher.js';

// A capability is usable only when a real entry callback is registered and enabled.
export function employeeCapabilityAvailable(capability) {
  return capability?.enabled === true && typeof capability.mount === 'function';
}

export function bootDemo({ root = document.getElementById('demo-root'), employeeCapability = null,
  decorateRetail = decorate } = {}) {
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
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        sessionStorage.setItem(ACCESS_KEY_STORAGE, value);
        overlay.remove();
        resolve();
      });
      document.body.append(overlay);
      input.focus();
    });
  }

  const retail = createRetailChrome({ root, params, DEFAULT_API });
  const available = employeeCapabilityAvailable(employeeCapability);
  function render() {
    const context = resolveEntryContext(window.location.href, { employeeAvailable: available });
    root.entryContext = context;
    root.dataset.experience = context.experience;
    root.dataset.entryState = context.state;
    root.dataset.brand = context.brand || '';
    if (context.state === 'retail-picker') retail.renderPicker();
    else if (context.state === 'retail') {
      const block = retail.renderShell(context.brand);
      retail.applyOverrides(block, context.brand);
      window.addEventListener('vm-auth-failed', () => {
        if (document.querySelector('.vm-gate')) return;
        askForPassword('That password was not right. Please try again.')
          .then(() => decorateRetail(block));
      });
      decorateRetail(block);
    } else if (context.state === 'employee' && available) {
      root.replaceChildren();
      employeeCapability.mount(root, context);
    } else renderLauncher(root, context, { input: window.location.href });
    root.dispatchEvent(new CustomEvent('demo-entry-ready', { detail: context, bubbles: true }));
  }
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
    
}
