import { result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const unavailable = () => result('unavailable', {
  reason: 'Released-car history and availability could not be confirmed together.', retryable: true,
});
const changed = () => result('conflict', {
  reason: 'Released-car history or availability changed. Refresh the current view.',
});

function validHistory(value, context, time) {
  const history = value?.history;
  if (value?.runId !== context.runId || value.observedAt !== time.now || !object(history)
    || !count(history.releasedCarCount) || !count(history.releaseCount)
    || history.releaseCount > history.releasedCarCount || !Array.isArray(history.sourceVersions)
    || !history.sourceVersions.every(text) || new Set(history.sourceVersions).size !== history.sourceVersions.length
    || value.source?.state !== 'current-version-unknown') return false;
  if (history.state === 'none-visible') return history.releasedCarCount === 0 && history.releaseCount === 0
    && history.latestReleasedAt === null && history.sourceVersions.length === 0;
  return history.state === 'released' && history.releasedCarCount > 0 && history.releaseCount > 0
    && validInstant(history.latestReleasedAt) && Date.parse(history.latestReleasedAt) <= Date.parse(time.now)
    && history.sourceVersions.length > 0;
}

/**
 * Decorate the real ManualClaimsService stock read after its claimInput enrichment.
 * This module owns no route, stock port, claim command, repository or policy instance.
 * The trusted host binds every other operation to the original service instance.
 */
export function createManualGalleryStockRead({ manual, releaseHistory, identity, clock } = {}) {
  if (typeof manual?.browseStock !== 'function' || typeof releaseHistory?.read !== 'function'
    || typeof identity?.requireRole !== 'function' || typeof clock?.now !== 'function') {
    throw new TypeError('Inject the actual manual claims service, release history, identity and DemoClock.');
  }
  async function time(context) {
    const observed = await clock.now(context);
    if (observed.status !== 'ok') return observed;
    return observed.value?.runId === context.runId && validInstant(observed.value.now)
      && text(observed.value.clockVersion) ? observed : unavailable();
  }
  return Object.freeze({ async browseStock(context) {
    try {
      const allowed = await identity.requireRole(context, 'employee');
      if (allowed.status !== 'ok') return allowed;
      const before = await time(context);
      if (before.status !== 'ok') return before;
      // Keep the original service's authentication, pending/expiry reconciliation,
      // exact gates and server-issued claimInput. No automatic replay occurs here.
      const stock = await manual.browseStock(context);
      if (stock.status !== 'ok') return stock;
      const history = await releaseHistory.read(context);
      if (history.status !== 'ok') return history;
      const stillAllowed = await identity.requireRole(context, 'employee');
      if (stillAllowed.status !== 'ok') return stillAllowed;
      const after = await time(context);
      if (after.status !== 'ok') return after;
      if (after.value.now !== before.value.now || after.value.clockVersion !== before.value.clockVersion
        || stock.value?.versions?.clock !== before.value.clockVersion
        || history.value?.observedAt !== before.value.now) return changed();
      if (!validHistory(history.value, context, before.value)
        || !Array.isArray(stock.value?.decisions) || !Array.isArray(stock.value?.cars)
        || history.value.history.releasedCarCount < stock.value.decisions.length) return unavailable();
      // History never determines current suitability, availability, ranking or a
      // global first-release state. Preserve the complete existing browse DTO.
      return { ...stock, value: { ...stock.value, releaseHistory: history.value } };
    } catch { return unavailable(); }
  } });
}
