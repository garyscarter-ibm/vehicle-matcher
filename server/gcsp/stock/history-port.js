import { ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';
import { object, text } from './port.js';

const CONSUMER = 'stock-release';
const uuid = (value) => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const ids = (value, validate = text) => Array.isArray(value) && value.every(validate) && new Set(value).size === value.length;
const unavailable = () => result('unavailable', { reason: 'Confirmed release history is unavailable.', retryable: true });
const changed = () => result('conflict', { reason: 'Release history time changed. Refresh the current view.' });
const visibilityValid = (value) => object(value) && ids(value.companyIds) && ids(value.schemeIds)
  && (value.employeeIds === null || ids(value.employeeIds));
const visible = (row, context) => row.visibility.companyIds.includes(context.companyId)
  && row.visibility.schemeIds.includes(context.schemeId)
  && (row.visibility.employeeIds === null || row.visibility.employeeIds.includes(context.employeeId));

// This is an authenticated read projection, separate from current stock eligibility.
// Stock is read first: its immutable release provenance was committed with its receipt.
// A later receipt read can confirm that retained snapshot without erasing occupied cars.
export function createStockReleaseHistoryPort({ repository, identity, clock } = {}) {
  if (typeof repository?.query !== 'function' || typeof repository?.currentRun !== 'function'
    || typeof identity?.requireRole !== 'function' || typeof clock?.now !== 'function') {
    throw new TypeError('Inject the repository, identity adapter and DemoClock.');
  }
  async function current(context) {
    const allowed = await identity.requireRole(context, 'employee');
    if (allowed.status !== 'ok') return allowed;
    if (![context.employeeId, context.companyId, context.schemeId].every(text)) return unavailable();
    const time = await clock.now(context);
    if (time.status !== 'ok') return time;
    if (time.value?.runId !== context.runId || !validInstant(time.value?.now) || !text(time.value?.clockVersion)) return unavailable();
    const run = await repository.currentRun(context.environmentId);
    if (run.status !== 'ok') return run.status === 'not-found' ? unavailable() : run;
    if (run.value.runId !== context.runId || run.value.environmentId !== context.environmentId
      || run.value.current !== true || run.value.status !== 'active') return result('stale-run', { reason: 'The current demonstration run changed.' });
    return run.value.clockInstant === time.value.now && run.value.clockVersion === time.value.clockVersion ? time : changed();
  }
  function project(context, stock, receipts, time) {
    if (!Array.isArray(stock) || !Array.isArray(receipts)) return unavailable();
    const retained = new Map();
    for (const row of stock) {
      if (row.release === undefined || row.release === null) continue;
      if (row.runId !== context.runId || !uuid(row.orderUuid) || retained.has(row.orderUuid)
        || !object(row.release) || !visibilityValid(row.visibility)) return unavailable();
      retained.set(row.orderUuid, row);
    }
    const confirmed = new Set(); const visibleCars = new Set(); const visibleTranches = new Set(); const sources = new Set();
    let latestReleasedAt = null;
    for (const receipt of receipts) {
      if (receipt.consumerId !== CONSUMER || receipt.eventType !== 'stock-released'
        || receipt.state !== 'completed' || receipt.outcome?.status !== 'ok') continue;
      const release = receipt.outcome.value;
      if (receipt.runId !== context.runId || receipt.handlerId !== CONSUMER || !object(release)
        || release.kind !== 'stock-released' || release.runId !== context.runId || !text(release.trancheId)
        || receipt.eventId !== release.trancheId || !text(release.windowId) || !text(release.tickId)
        || !(release.supplyId === null || text(release.supplyId)) || !text(release.policyVersion)
        || !validInstant(release.releasedAt) || Date.parse(release.releasedAt) > Date.parse(time.now)
        || !ids(release.orderUuids, uuid) || !ids(release.visibleOrderUuids, uuid)
        || release.orderUuids.some((id) => !release.visibleOrderUuids.includes(id)) || !object(release.source)
        || !['providerId', 'version', 'label'].every((key) => text(release.source[key]))
        || !['synthetic', 'dated-snapshot', 'authorised-live'].includes(release.source.mode)
        || receipt.inputVersions?.source !== release.source.version || receipt.inputVersions?.policy !== release.policyVersion) return unavailable();
      for (const orderUuid of release.orderUuids) {
        const row = retained.get(orderUuid);
        if (!row || confirmed.has(orderUuid)
          || ['trancheId', 'windowId', 'supplyId', 'releasedAt', 'policyVersion'].some((key) => row.release[key] !== release[key])
          || row.release.sourceVersion !== release.source.version) return unavailable();
        confirmed.add(orderUuid);
        if (!visible(row, context)) continue;
        visibleCars.add(orderUuid); visibleTranches.add(release.trancheId); sources.add(release.source.version);
        if (latestReleasedAt === null || Date.parse(release.releasedAt) > Date.parse(latestReleasedAt)) latestReleasedAt = release.releasedAt;
      }
    }
    if ([...retained.keys()].some((id) => !confirmed.has(id))) return unavailable();
    return ok({ runId: context.runId, observedAt: time.now,
      history: { state: visibleCars.size ? 'released' : 'none-visible', releasedCarCount: visibleCars.size,
        releaseCount: visibleTranches.size, latestReleasedAt, sourceVersions: [...sources].sort() },
      source: { state: 'current-version-unknown' } });
  }
  return Object.freeze({ async read(context) {
    const before = await current(context);
    if (before.status !== 'ok') return before;
    const stock = await repository.query(context, 'stock');
    if (stock.status !== 'ok') return stock;
    const receipts = await repository.query(context, 'event_receipts', { consumerId: CONSUMER, state: 'completed' });
    if (receipts.status !== 'ok') return receipts;
    const after = await current(context);
    if (after.status !== 'ok') return after;
    if (after.value.now !== before.value.now || after.value.clockVersion !== before.value.clockVersion) return changed();
    return project(context, stock.value, receipts.value, before.value);
  } });
}
