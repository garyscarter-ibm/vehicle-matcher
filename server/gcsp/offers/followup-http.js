import { result } from '../repository/core.js';

const invalid = () => result('invalid', { code: 'invalid-offer-followup-request',
  reasons: [{ field: 'request', reason: 'Supply only the follow-up decision selector and confirmation fields.' }] });
const unavailable = () => result('unavailable', { reason: 'The offer follow-up is temporarily unavailable.', retryable: true });

// The shared employee route middleware supplies authentication, origin checks and no-store headers.
export function createOfferFollowupRoutes(service) {
  return [{ method: 'GET', path: '/api/gcsp/offer-followup', role: 'employee',
    async handle({ context, searchParams = new URLSearchParams() }) {
      if ([...searchParams.keys()].some((key) => key !== 'decisionId') || searchParams.getAll('decisionId').length !== 1) return invalid();
      if (typeof service?.read !== 'function') return unavailable();
      try { return await service.read(context, { decisionId: searchParams.get('decisionId') }); } catch { return unavailable(); }
    } }, { method: 'POST', path: '/api/gcsp/offer-followup/confirm', role: 'employee',
    async handle({ context, body, searchParams = new URLSearchParams() }) {
      if ([...searchParams.keys()].length) return invalid();
      if (typeof service?.confirm !== 'function') return unavailable();
      try { return await service.confirm(context, body); } catch { return unavailable(); }
    } }];
}
