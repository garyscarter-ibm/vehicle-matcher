// DOM-free projection of the existing trusted account endpoint for any GCSP shell.
// `states` widens which account states identify the person; an ordered car leaves the slot `no-entitlement`.
export function createAccountHttpAdapter({ fetch: request = globalThis.fetch, baseURL = '', signal, states = ['ready'] } = {}) {
  return { async loadAccount(options = {}) {
    try {
      const response = await request(`${baseURL.replace(/\/$/, '')}/api/gcsp/manual/account`, {
        method: 'GET', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: options.signal || signal,
      });
      const found = await response.json();
      if (!response.ok || found.status !== 'ok' || !states.includes(found.value?.state) || typeof found.value.account?.name !== 'string') return { status: 'unavailable' };
      return { status: 'ready', name: found.value.account.name,
        context: found.value.account.gradeId ? `Grade ${found.value.account.gradeId}` : '' };
    } catch { return { status: 'unavailable' }; }
  } };
}
