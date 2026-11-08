import { journeyIntent, toAccountView } from './account-view.js';
import { isAccessLapsed } from '../kit/run-restarted.js';

const unavailable = (code, httpStatus = null) => ({ status: 'unavailable', code, httpStatus, retryable: true,
  view: { state: 'unavailable', editable: false, supportOwner: 'scheme-support', action: 'retry' } });

export function createAccountHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { signal, body } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}/api/gcsp/manual/${path}`, { method: body ? 'POST' : 'GET',
        credentials: 'include', signal, headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch (error) {
      if (signal?.aborted) throw error;
      return unavailable('account-transport-unavailable');
    }
    let envelope;
    try { envelope = await response.json(); } catch { return unavailable('account-response-invalid', response.status); }
    if (isAccessLapsed(response.status, envelope)) return { status: 'access-required' };
    const value = envelope?.value;
    if (!envelope || typeof envelope !== 'object' || typeof envelope.status !== 'string'
      || envelope.status === 'ok' && (!response.ok || !value || typeof value !== 'object'
        || path === 'account' && (typeof value.state !== 'string' || !Array.isArray(value.actions))
        || path === 'draft' && (!Number.isSafeInteger(value.draftVersion) || value.draftVersion < 1
          || !value.choices || typeof value.choices !== 'object'))) {
      return unavailable('account-response-invalid', response.status);
    }
    return envelope;
  }
  const readAccount = (options) => request('account', options);
  const readDraft = (options) => request('draft', options);
  const saveDraft = (input, options = {}) => request('draft', { ...options, body: input });
  const browseStock = (options) => request('stock', options);
  const readOrder = (options) => request('order', options);
  // Offers the employee can open; failure only hides the link.
  async function readOffers({ signal } = {}) {
    try {
      const response = await fetchImpl(`${base}/api/gcsp/offers/current`, { credentials: 'include', signal, headers: { Accept: 'application/json' } });
      const envelope = await response.json();
      const offers = envelope?.status === 'ok' && response.ok ? envelope.value?.offers : null;
      if (!Array.isArray(offers) || offers.some((row) => typeof row?.offerId !== 'string' || typeof row.runId !== 'string')) return { status: 'unavailable' };
      const listed = offers.map(({ offerId, runId }) => ({ offerId, runId }));
      // The link opens the newest offer, so read its state; a failed read leaves the link as it was.
      if (listed.length) {
        const [{ offerId, runId }] = listed;
        try {
          const read = await fetchImpl(`${base}/api/gcsp/offers/${encodeURIComponent(offerId)}?runId=${encodeURIComponent(runId)}`,
            { credentials: 'include', signal, headers: { Accept: 'application/json' } });
          const offer = await read.json();
          if (read.ok && offer?.status === 'ok' && typeof offer.value?.state === 'string') listed[0].state = offer.value.state;
        } catch (error) { if (signal?.aborted) throw error; }
      }
      return { status: 'ok', value: { offers: listed } };
    } catch (error) { if (signal?.aborted) throw error; return { status: 'unavailable' }; }
  }
  return { readAccount, readDraft, saveDraft, browseStock, readOffers, readOrder,
    async loadAccount(options) {
      const envelope = await readAccount(options); const model = toAccountView(envelope);
      return { status: envelope.status === 'ok' ? 'ready' : 'unavailable', name: model.account?.name ?? 'Account unavailable',
        context: [model.account?.company ?? model.account?.companyId, model.account?.gradeId].filter(Boolean).join(', '),
        model, envelope };
    },
    async startJourney({ account, action, draft = null, commandId, reviewedContextVersion = null }, options = {}) {
      const supplied = account?.status === 'ok' && account.value.state === 'ready'
        && account.value.actions?.find((row) => row.enabled === true && row.action === action?.action
          && row.slotId === action.slotId && row.schemeId === action.schemeId && row.oldContractId === action.oldContractId);
      if (!supplied) return { status: 'invalid', code: 'account-action-unavailable',
        view: { state: 'validation', editable: false, supportOwner: 'scheme-support', action: 'refresh-review' } };
      if (draft && !['ok', 'not-found'].includes(draft.status)) return draft;
      const reviewed = reviewedContextVersion === account.value.contextVersion
        && draft?.value?.contextVersion !== account.value.contextVersion;
      if (draft?.value?.requiresRefresh && !reviewed) return { status: 'stale-version', resource: 'manual-context', action: 'refresh',
        view: { state: 'context-changed', editable: false, supportOwner: 'employee', action: 'refresh-review' } };
      return saveDraft({ commandId, expectedDraftVersion: draft?.value?.draftVersion ?? 0,
        expectedContextVersion: account.value.contextVersion, choices: journeyIntent(supplied) }, options);
    },
  };
}
