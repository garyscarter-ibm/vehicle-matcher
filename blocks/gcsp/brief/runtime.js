import { defineGcspBrief } from './gcsp-brief.js';
import { createBriefTransport } from './brief-transport.js';

// Adapt the existing trusted account response to the shell's public presentation shape.
export function createBriefRuntimeAdapter({ fetch: request = globalThis.fetch, baseURL = '', signal } = {}) {
  const transport = createBriefTransport({ fetch: request, baseURL, signal });
  return { transport, async loadAccount(options = {}) {
    try {
      const response = await request(`${baseURL.replace(/\/$/, '')}/api/gcsp/manual/account`, {
        method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: options.signal || signal,
      });
      const found = await response.json();
      if (!response.ok || found.status !== 'ok' || found.value?.state !== 'ready' || typeof found.value.account?.name !== 'string') return { status: 'unavailable' };
      return { status: 'ready', name: found.value.account.name,
        context: found.value.account.gradeId ? `Grade ${found.value.account.gradeId}` : '' };
    } catch { return { status: 'unavailable' }; }
  } };
}

const host = globalThis.document?.querySelector('gcsp-brief[data-live]');
if (host) {
  host.adapter = { ...createBriefRuntimeAdapter(), notice: 'Synthetic local demo',
    navigation: [{ key: 'brief', label: 'Your car brief', available: true, icon: ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'] }] };
  defineGcspBrief();
}
