// HTTP adapter for the presenter outbox. The server owns role and run checks; this only maps replies to view states.

const UNAVAILABLE = 'The captured emails could not be loaded. Try again in a moment.';
const REFUSED = 'Only the presenter can open the outbox. Switch back to the presenter session and try again.';
const RESET = 'The demo was reset. Reopen the presenter session to see the new run.';

/** Pure: HTTP status and parsed JSON body -> { status: 'ready' | 'empty' | 'refused' | 'unavailable', ... }. */
export function outcomeToState(httpStatus, body) {
  if (httpStatus === 200 && body?.status === 'ok' && Array.isArray(body.value?.messages)) {
    const messages = body.value.messages;
    return messages.length ? { status: 'ready', messages } : { status: 'empty' };
  }
  if (httpStatus === 401 || httpStatus === 403) return { status: 'refused', message: REFUSED };
  if (httpStatus === 409 && body?.status === 'stale-run') return { status: 'refused', message: RESET };
  return { status: 'unavailable', message: UNAVAILABLE };
}

export function createOutboxHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  return {
    async loadMessages({ signal } = {}) {
      let response;
      try {
        response = await fetchImpl(`${base}/api/gcsp/presenter/outbox`, { method: 'GET', credentials: 'include', signal, headers: { Accept: 'application/json' } });
      } catch (error) {
        if (signal?.aborted) throw error;
        return { status: 'unavailable', message: UNAVAILABLE };
      }
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      return outcomeToState(response.status, body);
    },
  };
}
