import { defineGcspBrief } from './gcsp-brief.js';
import { createBriefTransport } from './brief-transport.js';
import { createAccountHttpAdapter } from '../shell/account-runtime.js';
import { routePortalEvents } from '../employee/portal-navigation.js';

// Adapt the existing trusted account response to the shell's public presentation shape.
export function createBriefRuntimeAdapter({ fetch: request = globalThis.fetch, baseURL = '', signal } = {}) {
  const transport = createBriefTransport({ fetch: request, baseURL, signal });
  return { transport, ...createAccountHttpAdapter({ fetch: request, baseURL, signal }) };
}

const host = globalThis.document?.querySelector('gcsp-brief[data-live]');
if (host) {
  host.adapter = { ...createBriefRuntimeAdapter(), notice: 'Synthetic local demo' };
  routePortalEvents(host);
  defineGcspBrief();
}
