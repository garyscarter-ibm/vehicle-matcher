import { el, button } from '../../vehicle-matcher/ui.js';
import { labelledField } from '../kit/form-controls.js';

let serial = 0;
const valid = (value) => value && Number.isSafeInteger(value.version) && value.version >= 0
  && (value.deliveryEmail === null || typeof value.deliveryEmail === 'string');

export function mountNotificationEmail(root, { adapter, signal } = {}) {
  let version = null; let busy = false; let locked = false; let disposed = false; let command;
  const form = el('form', 'gcsp-notification-email'); form.noValidate = true;
  const input = el('input'); input.type = 'email'; input.autocomplete = 'email'; input.maxLength = 254;
  const field = labelledField({ id: `gcsp-notification-email-${++serial}`, label: 'Notification email', control: input,
    hint: 'Used for car offers and updates. Clear it to stop email notifications.' });
  const status = el('p', 'gcsp-note'); status.setAttribute('role', 'status');
  const save = button({ label: 'Save email', variant: 'ghost' }); save.type = 'submit';
  const reload = button({ label: 'Reload email', variant: 'ghost', onClick: () => load() }); reload.type = 'button';
  const actions = el('div', 'gcsp-notification-email-actions'); actions.append(save, reload);
  form.append(field.root, actions, status); root.replaceChildren(form);
  function controls() {
    input.disabled = busy || locked || version === null;
    save.disabled = input.disabled;
    reload.hidden = !locked && version !== null;
    reload.disabled = busy || locked && version === null;
    form.setAttribute('aria-busy', String(busy));
  }
  function failed(result, reading) {
    if (['access-required', 'stale-run', 'forbidden', 'missing-session', 'expired-session'].includes(result?.status)) {
      locked = true; version = null; status.textContent = 'Sign in again to update your notification email.';
    } else if (['stale-version', 'conflict'].includes(result?.status)) {
      locked = true; status.textContent = 'This email has changed. Reload it before saving.';
    } else {
      status.textContent = reading ? 'Could not load your notification email. Try again.' : 'Could not save your notification email. Try again.';
      if (result?.status === 'invalid') field.setError('Enter a valid email address, or clear the field.');
    }
  }
  async function load() {
    if (disposed || busy) return;
    busy = true; status.textContent = 'Loading email…'; controls();
    try {
      const result = await adapter.readNotificationEmail({ signal });
      if (disposed) return;
      if (result.status === 'ok' && valid(result.value)) {
        version = result.value.version; input.value = result.value.deliveryEmail ?? ''; locked = false; command = null;
        field.setError(); status.textContent = '';
      } else failed(result, true);
    } catch { if (!disposed) failed(null, true); }
    finally { busy = false; if (!disposed) controls(); }
  }
  async function submit(event) {
    event.preventDefault(); if (disposed || busy || locked || version === null) return;
    input.value = input.value.trim(); field.setError();
    if (!input.checkValidity()) { field.setError('Enter a valid email address, or clear the field.'); input.focus(); return; }
    const deliveryEmail = input.value || null;
    if (!command || command.deliveryEmail !== deliveryEmail || command.expectedVersion !== version) {
      command = { commandId: crypto.randomUUID(), expectedVersion: version, deliveryEmail };
    }
    busy = true; status.textContent = 'Saving…'; controls();
    try {
      const result = await adapter.saveNotificationEmail(command, { signal });
      if (disposed) return;
      if (result.status === 'ok' && valid(result.value)) {
        version = result.value.version; input.value = result.value.deliveryEmail ?? ''; command = null;
        status.textContent = result.value.deliveryEmail ? 'Saved.' : 'Email notifications off.';
      } else failed(result, false);
    } catch { if (!disposed) failed(null, false); }
    finally { busy = false; if (!disposed) controls(); }
  }
  form.addEventListener('submit', submit);
  const teardown = () => { disposed = true; form.removeEventListener('submit', submit); };
  signal?.addEventListener('abort', teardown, { once: true });
  teardown.ready = signal?.aborted ? Promise.resolve(teardown()) : load();
  return teardown;
}
