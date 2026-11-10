// Credentials cross only the session endpoint; account authority stays on the server.
export function createSessionHttpAdapter({ fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  async function post(path, payload) {
    try {
      const response = await fetchImpl(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!result || typeof result.status !== 'string' || (!response.ok && result.status === 'ok')) return { status: 'unavailable' };
      return result;
    } catch { return { status: 'unavailable' }; }
  }
  return {
    signIn: ({ email, password }) => post('/api/gcsp/session/login', { email, password }),
    signOut: () => post('/api/gcsp/session/logout', {}),
  };
}
