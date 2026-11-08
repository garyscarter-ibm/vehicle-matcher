// Browser transport for the bounded server-owned policy projection. No policy values originate here.
const text = (v) => typeof v === 'string' && v.trim().length > 0;
const integer = (v) => Number.isSafeInteger(v) && v >= 0;
const instant = (v) => text(v) && Number.isFinite(Date.parse(v));
const count = (v) => v?.kind === 'exact' ? integer(v.value) && text(v.label)
  : v?.kind === 'band' && integer(v.fewerThan) && v.fewerThan > 0 && text(v.label) && !('value' in v);
const fit = (v) => count(v?.employeesWithEligibleStock) && count(v?.scoredBriefs)
  && (v.meanBestScore?.status === 'available' ? Number.isFinite(v.meanBestScore.value)
    : v.meanBestScore?.status === 'suppressed' && integer(v.meanBestScore.fewerThan) && !('value' in v.meanBestScore));
const held = (v) => v && (v.count === null || integer(v.count)) && text(v.message);
const presentation = (v) => v === undefined || v && integer(v.minimum) && integer(v.maximum) && v.maximum > v.minimum
  && v.step === 1 && ['assumptionKey', 'source', 'sourceDate', 'basis', 'status', 'unit'].every((key) => text(v[key]));
const field = (v) => text(v?.id) && ['price', 'weight'].includes(v.kind) && text(v.key)
  && v.id === `${v.kind}:${v.key}` && integer(v.value) && text(v.unit) && presentation(v.presentationRange)
  && ['source', 'sourceDate', 'basis', 'status'].every((key) => text(v[key]))
  && (v.kind !== 'price' || text(v.schemeId) && (text(v.configurationId) || text(v.matchField) && text(v.matchValue)));
export function validPolicy(v) {
  return text(v?.activeVersion) && instant(v.asOf) && instant(v.effectiveFrom) && held(v.heldOffers)
    && Array.isArray(v.fields) && v.fields.length > 0 && v.fields.every(field)
    && new Set(v.fields.map((f) => f.id)).size === v.fields.length
    && v.fields.filter((f) => f.kind === 'weight').length === 6;
}
export function validPreview(v) {
  return v?.preview === true && text(v.activeVersion) && instant(v.asOf)
    && Array.isArray(v.differences) && v.differences.length > 0
    && v.differences.every((d) => text(d.id) && integer(d.before) && integer(d.after) && text(d.unit))
    && [v.active, v.draft].every((a) => count(a?.demand?.demand?.unmet?.total?.count) && fit(a?.fit)) && held(v.heldOffers);
}
export function validPublished(v) {
  return v?.accepted === true && text(v.policyVersion) && instant(v.effectiveFrom) && text(v.publisher)
    && held(v.heldOffers) && ['active', 'pending'].includes(v.activation?.status)
    && typeof v.activationRequired === 'boolean';
}
const unavailable = () => ({ status: 'unavailable', message: 'Policy controls are unavailable. Retry in a moment.' });
export function policyOutcome(httpStatus, body, action) {
  const validate = { readPolicy: validPolicy, preview: validPreview, publish: validPublished }[action];
  if (httpStatus === 200 && body?.status === 'ok' && validate?.(body.value)) return { status: 'ready', value: body.value };
  if ([401, 403].includes(httpStatus)) return { status: 'refused', message: 'Only Greg can preview or publish policy. Reopen the scheme ordering lead session.' };
  if (body?.status === 'stale-run') return { status: 'refused', message: 'The demo was reset. Reopen the scheme ordering lead session.' };
  if (['invalid', 'conflict', 'stale-version'].includes(body?.status)) {
    const reasons = (Array.isArray(body.reasons) ? body.reasons : []).filter((r) => text(r?.reason)).map((r) => r.reason);
    return { status: 'rejected', message: [body.reason, ...reasons, 'Refresh policy and preview again before publishing.'].filter(text).join(' ') };
  }
  return unavailable();
}
export function createGregPublishHttpAdapter({ base = '', fetchImpl = globalThis.fetch } = {}) {
  const request = async (action, input, { signal } = {}) => {
    const read = action === 'readPolicy';
    try {
      const response = await fetchImpl(`${base}/api/gcsp/greg/policy${read ? '' : `/${action}`}`, {
        method: read ? 'GET' : 'POST', credentials: 'include', cache: 'no-store', signal,
        headers: { Accept: 'application/json', ...(read ? {} : { 'Content-Type': 'application/json' }) },
        ...(read ? {} : { body: JSON.stringify(input) }),
      });
      let body; try { body = await response.json(); } catch { return unavailable(); }
      return policyOutcome(response.status, body, action);
    } catch (error) { if (signal?.aborted) throw error; return unavailable(); }
  };
  return { readPolicy: (options) => request('readPolicy', null, options),
    preview: (input, options) => request('preview', input, options), publish: (input, options) => request('publish', input, options) };
}
