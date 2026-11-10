import { isAccessLapsed, isRunRestarted } from '../kit/run-restarted.js';

// Valid account states that identify the person; an accepted or ordered car leaves the slot `no-entitlement`.
const IDENTIFIED = ['ready', 'no-entitlement', 'ordering-closed', 'not-yet-eligible'];

// Both manual accounts and session contexts carry the same durable profile identity.
export function accountIdentity(account) {
  const email = account?.email || account?.contact?.email;
  return { name: account?.name ?? 'Account unavailable', ...(typeof email === 'string' && email ? { email } : {}) };
}

// DOM-free projection of the existing trusted account endpoint for any GCSP shell.
export function createAccountHttpAdapter({ fetch: request = globalThis.fetch, baseURL = '', signal } = {}) {
  return { async loadAccount(options = {}) {
    try {
      const response = await request(`${baseURL.replace(/\/$/, '')}/api/gcsp/manual/account`, {
        method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: options.signal || signal,
      });
      const found = await response.json();
      // A restart, or a lapsed access key (401 with no status), passes through so the shell stays quiet.
      if (isAccessLapsed(response.status, found)) return { status: 'access-required' };
      if (isRunRestarted(found)) return { status: found.status };
      if (!response.ok || found.status !== 'ok' || !IDENTIFIED.includes(found.value?.state) || typeof found.value.account?.name !== 'string') return { status: 'unavailable' };
      return { status: 'ready', ...accountIdentity(found.value.account),
        context: found.value.account.gradeId ? `Grade ${found.value.account.gradeId}` : '' };
    } catch { return { status: 'unavailable' }; }
  } };
}


export function createContextHttpAdapter({ fetch: request = globalThis.fetch, baseURL = '' } = {}) {
  return { async loadAccount({ signal } = {}) {
    try {
      const response = await request(`${baseURL.replace(/\/$/, '')}/api/gcsp/context`, {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' },
      });
      const found = await response.json();
      if (isAccessLapsed(response.status, found)) return { status: 'access-required' };
      if (isRunRestarted(found)) return { status: found.status };
      if (!response.ok || found?.status !== 'ok' || typeof found.value?.name !== 'string') return { status: 'unavailable' };
      const context = found.value;
      return { status: 'ready', ...accountIdentity(context),
        context: context.roles?.includes('greg') ? 'Scheme ordering lead' : context.gradeId ? `Grade ${context.gradeId}` : '' };
    } catch { return { status: 'unavailable' }; }
  } };
}
