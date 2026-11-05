import { defineGcspBrief } from './gcsp-brief.js';
import { createBriefTransport } from './brief-transport.js';
import { createAccountHttpAdapter } from '../shell/account-runtime.js';

// Adapt the existing trusted account response to the shell's public presentation shape.
export function createBriefRuntimeAdapter({ fetch: request = globalThis.fetch, baseURL = '', signal } = {}) {
  const transport = createBriefTransport({ fetch: request, baseURL, signal });
  return { transport, ...createAccountHttpAdapter({ fetch: request, baseURL, signal }) };
}

const host = globalThis.document?.querySelector('gcsp-brief[data-live]');
if (host) {
  host.adapter = { ...createBriefRuntimeAdapter(), notice: 'Synthetic local demo',
    navigation: [{ key: 'brief', label: 'Your car brief', available: true, icon: ['M6 3h12v18H6z', 'M9 8h6', 'M9 12h6', 'M9 16h4'] }] };
  defineGcspBrief();
}
