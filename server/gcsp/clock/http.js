import { randomUUID } from 'node:crypto';
import { ok, result } from '../repository/core.js';

// Shared by named scenario reset: credential renewal follows the existing clock authority.
export async function renewPresenterAfterReset({ clock, identity, context, outcome, setCookie }) {
  if (outcome.status !== 'ok') return outcome;
  // A receipt from an older reset remains readable, but cannot authenticate into a later run.
  const current = await clock.now({ ...context, runId: outcome.value.runId });
  if (current.status !== 'ok') return outcome;
  const renewed = await identity.createPresenterSession(`reset-${randomUUID()}`);
  if (renewed.status === 'ok') { setCookie(renewed.value.setCookie); return outcome; }
  return ok({ ...outcome.value, presenterSession: { status: 'unavailable',
    action: 'The reset completed. Reissue the presenter session through trusted backend bootstrap.' } });
}

// afterReset is the runtime's per-run preparation (stock source, reviewed policy sets), as for scenario resets.
export function createClockRoutes(clock, { afterReset } = {}) {
  const route = (path, method, operation) => ({ method, path: `/api/gcsp/presenter/clock${path}`, role: 'presenter',
    purpose: 'presenter-control', ...(operation === 'reset' ? { resetReplay: true } : {}),
    async handle({ context, body, searchParams, identity, setCookie }) {
      if ([...searchParams.keys()].length || method === 'GET' && Object.keys(body).length) return result('invalid', {
        code: 'unsupported-query', reasons: [{ field: 'query', reason: 'Clock controls accept no query selectors.' }],
      });
      if (!clock) return result('unavailable', { reason: 'Demo clock has not been configured.', retryable: true });
      const outcome = await clock[operation](context, body);
      if (operation !== 'reset' || outcome.status !== 'ok') return outcome;
      if (typeof afterReset === 'function') { try { await afterReset(outcome.value.runId); } catch { /* as a mechanics scenario reset */ } }
      return renewPresenterAfterReset({ clock, identity, context, outcome, setCookie });
    } });
  return [route('', 'GET', 'readState'), route('/advance', 'POST', 'advance'), route('/tick', 'POST', 'tick'), route('/reset', 'POST', 'reset')];
}
