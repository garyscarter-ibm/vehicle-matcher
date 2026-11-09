import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { inputDigest, ok, result } from '../repository/core.js';
import { createVehicleSnapshot } from '../../vehicles/index.js';
import { allocateInventoryFile, readAllocationInventory } from './vin-allocation.js';

export const STOCK_GENERATOR_VERSION = 'stock-generator.v1';
export const STOCK_GENERATOR_NAMESPACE = `synthetic:${STOCK_GENERATOR_VERSION}`;
// Fact names the generator owns; a factsForConfiguration seam may add others but never override these.
const RESERVED_FACTS = ['stockIdentityKind', 'modelLine', 'colour', 'leadTimeWeeks', 'confirmedDeliveryWeek', 'plannedRelease',
  'syntheticVehicleId', 'configurationHash', 'generatorVersion', 'policyVersion'];
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 512;
// Real corpus configuration ids are base64 signatures that can exceed 512 characters.
const identifier = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keysExactly = (v, keys) => object(v) && Object.keys(v).length === keys.length && Object.keys(v).every((key) => keys.includes(key));
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const invalid = (code) => result('invalid', { code, reasons: [{ field: 'stock-generation', reason: 'Supply complete, supported configuration and policy inputs.' }] });
const unavailable = (code) => result('unavailable', { code, reason: 'The stock generation source is unavailable.', retryable: true });
const ordinal = (parts, size) => Number(createHash('sha256').update(JSON.stringify(parts)).digest().readBigUInt64BE() % BigInt(size));
const range = (v) => keysExactly(v, ['min', 'max']) && Number.isSafeInteger(v.min) && v.min >= 0 && Number.isSafeInteger(v.max) && v.max >= v.min && v.max <= 520;
const shares = (v) => object(v) && Object.keys(v).length > 0 && Object.entries(v).every(([key, value]) => text(key)
  && Number.isFinite(value) && value >= 0 && value <= 1) && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 1) <= 0.000001;
const idList = (v) => Array.isArray(v) && v.every(text) && new Set(v).size === v.length;
const validVisibility = (v) => v === undefined || object(v) && idList(v.companyIds) && idList(v.schemeIds) && (v.employeeIds === null || idList(v.employeeIds));
const day = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;

// Hamilton allocation avoids probabilistic colour/model drift in a small demonstration tranche.
function apportion(total, entries, entropy) {
  const weight = entries.reduce((sum, [, value]) => sum + value, 0);
  const rows = entries.map(([key, value]) => ({ key, count: Math.floor(total * value / weight), fraction: total * value / weight % 1,
    tie: ordinal([...entropy, key], 0x100000000) }));
  let remaining = total - rows.reduce((sum, row) => sum + row.count, 0);
  for (const row of [...rows].sort((a, b) => b.fraction - a.fraction || a.tie - b.tie || a.key.localeCompare(b.key))) {
    if (remaining-- > 0) row.count += 1;
  }
  return rows;
}

function localParts(instant, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
    .filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}
function localInstant(date, time, timeZone) {
  const [hour, minute] = time.split(':').map(Number);
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
  let candidate = target;
  for (let i = 0; i < 3; i += 1) {
    const p = localParts(new Date(candidate), timeZone);
    const delta = target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (delta === 0) return new Date(candidate).toISOString();
    candidate += delta;
  }
  throw new Error('unsupported-release-local-time');
}
function releaseDates(asOf, cadence) {
  if (!keysExactly(cadence, ['timeZone', 'slots']) || !text(cadence.timeZone) || !Array.isArray(cadence.slots) || cadence.slots.length < 1 || cadence.slots.length > 7
    || new Set(cadence.slots.map((slot) => slot.weekday)).size !== cadence.slots.length
    || !cadence.slots.every((slot) => keysExactly(slot, ['weekday', 'time']) && Number.isInteger(slot.weekday) && slot.weekday >= 0 && slot.weekday <= 6
      && typeof slot.time === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot.time))) throw new Error('unsupported-release-cadence');
  const local = localParts(new Date(asOf), cadence.timeZone);
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const dates = [];
  for (let offset = 0; offset < 15 && dates.length < cadence.slots.length + 1; offset += 1) {
    const current = new Date(date.getTime() + offset * 86400000);
    const slot = cadence.slots.find((row) => row.weekday === current.getUTCDay());
    if (slot) {
      const at = localInstant(current, slot.time, cadence.timeZone);
      if (Date.parse(at) >= Date.parse(asOf)) dates.push(at);
    }
  }
  if (dates.length !== cadence.slots.length + 1) throw new Error('unsupported-release-cadence');
  return dates;
}
function confirmedWeek(releaseAt, weeks, timeZone) {
  const local = localParts(new Date(releaseAt), timeZone);
  const date = new Date(Date.UTC(local.year, local.month - 1, local.day + weeks * 7));
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
function validPlan(plan) {
  return object(plan) && ['synthetic-fixture', 'accepted-f77', 'retained-corpus'].includes(plan.kind) && ['source', 'datasetId', 'corpusVersion'].every((key) => text(plan[key]))
    && (plan.titles === undefined || object(plan.titles) && Object.values(plan.titles).every(text))
    && (plan.displayNames === undefined || object(plan.displayNames) && Object.values(plan.displayNames).every(text))
    && Array.isArray(plan.configurations) && plan.configurations.length > 0 && plan.configurations.length <= 10000
    && new Set(plan.configurations.map((row) => row?.configurationId)).size === plan.configurations.length
    && object(plan.aggregateKeys) && Object.keys(plan.aggregateKeys).length > 0
    && Object.entries(plan.aggregateKeys).every(([key, value]) => text(key) && text(value))
    && plan.configurations.every((row) => object(row) && identifier(row.configurationId) && ['modelLineId', 'colour'].every((key) => text(row[key]))
      && Object.hasOwn(plan.aggregateKeys, row.modelLineId));
}
// A retained-corpus assumed aggregate claims no sample, so sampleDate and requestCount must be absent.
function validAggregate(value, modelLineId, plan) {
  const assumed = plan.kind === 'retained-corpus' && value?.sourceKind === 'assumed-aggregate';
  const sampled = assumed ? !Object.hasOwn(value, 'sampleDate') && !Object.hasOwn(value, 'requestCount')
    : day(value?.sampleDate) && positive(value?.requestCount) && value.requestCount <= 400;
  return object(value) && Object.keys(value).every((key) => ['modelLineId', 'carCount', 'colourShares', 'upholsteryShares',
    'leadTimeWeeks', 'deliveryDateSpread', 'priceBand', 'sampleDate', 'requestCount', 'sourceKind'].includes(key))
    && value.modelLineId === modelLineId && Number.isSafeInteger(value.carCount) && value.carCount >= 0
    && shares(value.colourShares) && shares(value.upholsteryShares) && range(value.leadTimeWeeks)
    && keysExactly(value.deliveryDateSpread, ['min', 'max']) && day(value.deliveryDateSpread.min) && day(value.deliveryDateSpread.max)
    && value.deliveryDateSpread.min <= value.deliveryDateSpread.max && sampled && keysExactly(value.priceBand, ['min', 'max', 'currency'])
    && value.priceBand.currency === 'GBP' && Number.isFinite(value.priceBand.min) && value.priceBand.min >= 0
    && Number.isFinite(value.priceBand.max) && value.priceBand.max >= value.priceBand.min;
}

/** Trusted composition supplies the accepted configuration plan and existing read/write ports.
 * No transport, identity lookup, reset, release, policy loader, price or eligibility authority. */
export function createStockGenerator({ repository, registry, policyService, contextForRun, configurationPlan, stockAccount, allocationInventoryPath,
  visibility, factsForConfiguration } = {}) {
  const plan = structuredClone(configurationPlan);
  const rowVisibility = visibility === undefined ? undefined : structuredClone(visibility);
  return Object.freeze({
    async generateStock(runId, seed, policyVersion) {
      if (![runId, seed, policyVersion, stockAccount].every(text) || !validPlan(plan)
        || typeof allocationInventoryPath !== 'string' || !isAbsolute(allocationInventoryPath)
        || typeof contextForRun !== 'function' || typeof repository?.transaction !== 'function'
        || typeof repository?.read !== 'function' || typeof registry?.getConfiguration !== 'function'
        || typeof policyService?.getAssumption !== 'function' || !validVisibility(rowVisibility)
        || factsForConfiguration !== undefined && typeof factsForConfiguration !== 'function') return invalid('invalid-generator-input');
      try {
        const context = await contextForRun(runId);
        if (context?.runId !== runId) return invalid('run-context-mismatch');
        const ref = { table: 'runs', key: { runId } };
        const found = await repository.read(context, ref);
        if (found.status !== 'ok') return found;
        const run = found.value;
        if (!Number.isFinite(Date.parse(run.clockInstant)) || run.policyVersion !== policyVersion) {
          return result('conflict', { reason: 'run-source-version-mismatch', current: {} });
        }
        const requestDigest = inputDigest({ generatorVersion: STOCK_GENERATOR_VERSION, runId, seed, policyVersion,
          plan, stockAccount, clockInstant: run.clockInstant, ...(rowVisibility ? { visibility: rowVisibility } : {}) });
        const previous = run.versions?.stockGeneration;
        if (previous) return previous.requestDigest === requestDigest
          ? ok({ generated: previous.report.totalCars, report: structuredClone(previous.report) })
          : result('conflict', { reason: 'stock-generation-request-mismatch', current: {} });
        const read = { runId, asOf: run.clockInstant, policyVersion };
        const keys = ['supply.release.size', 'supply.weeklyReleaseVolume', 'supply.release.cadence', ...Object.values(plan.aggregateKeys)];
        const values = new Map(); const provenance = [];
        for (const key of keys) {
          const response = await policyService.getAssumption(key, read);
          if (response?.status !== 'ok') return unavailable('required-stock-policy-unavailable');
          if (response.policyVersion !== policyVersion || response.value?.key !== key) return invalid('incoherent-stock-policy');
          values.set(key, response.value.value);
          provenance.push(Object.fromEntries(['key', 'value', 'unit', 'status', 'basis', 'source', 'sourceDate', 'policyVersion', 'effectiveFrom', 'effectiveTo']
            .filter((field) => Object.hasOwn(response.value, field)).map((field) => [field, response.value[field]])));
        }
        const trancheSize = values.get('supply.release.size');
        const weekly = values.get('supply.weeklyReleaseVolume');
        if (!positive(trancheSize) || trancheSize > 100000 || !keysExactly(weekly, ['min', 'max']) || !positive(weekly.min)
          || !positive(weekly.max) || weekly.max < weekly.min || weekly.max > 100000) return invalid('unsupported-release-policy');
        const releaseAt = releaseDates(run.clockInstant, values.get('supply.release.cadence'));
        const entropy = [STOCK_GENERATOR_VERSION, runId, seed, policyVersion];
        const total = weekly.min + ordinal([...entropy, 'weekly-volume'], weekly.max - weekly.min + 1);
        const aggregates = Object.entries(plan.aggregateKeys).sort(([a], [b]) => a.localeCompare(b)).map(([modelLineId, key]) => ({
          modelLineId, key, observed: values.get(key),
        }));
        if (!aggregates.every((row) => validAggregate(row.observed, row.modelLineId, plan))
          || aggregates.reduce((sum, row) => sum + row.observed.carCount, 0) === 0) return invalid('unsupported-stock-aggregate');
        if (aggregates.some((row) => {
          const provenanceRow = provenance.find((entry) => entry.key === row.key);
          const accepted = plan.kind === 'synthetic-fixture' ? [['synthetic-fixture', 'assumed']]
            : plan.kind === 'retained-corpus' ? [['assumed-aggregate', 'assumed'], ['observed-aggregate', 'observed aggregate']]
              : [['observed-aggregate', 'observed aggregate']];
          return !accepted.some(([kind, status]) => row.observed.sourceKind === kind && provenanceRow.status === status);
        })) return invalid('aggregate-provenance-mismatch');
        const configurations = new Map(); let activeDigest;
        for (const binding of [...plan.configurations].sort((a, b) => a.configurationId.localeCompare(b.configurationId))) {
          const response = await registry.getConfiguration(binding.configurationId);
          if (!['ok', 'complete', 'partial'].includes(response?.status) || !object(response.record?.configuration)) return unavailable('configuration-unavailable');
          if (response.record.configurationId !== binding.configurationId || !text(response.record.snapshotVersion)
            || response.active?.datasetId !== plan.datasetId || response.active?.version !== plan.corpusVersion
            || !text(response.active.manifestDigest) || activeDigest && activeDigest !== response.active.manifestDigest) return invalid('configuration-source-mismatch');
          activeDigest = response.active.manifestDigest;
          configurations.set(binding.configurationId, { ...binding, record: response.record });
        }
        const modelCounts = apportion(total, aggregates.map((row) => [row.modelLineId, row.observed.carCount]), [...entropy, 'models']);
        const vehicles = []; const models = [];
        for (const model of aggregates) {
          const count = modelCounts.find((row) => row.key === model.modelLineId).count;
          // Observed colours with no configuration for this line are dropped; the covered shares are renormalised.
          const offered = Object.entries(model.observed.colourShares).sort(([a], [b]) => a.localeCompare(b));
          const covered = offered.filter(([colour]) => [...configurations.values()].some((row) => row.modelLineId === model.modelLineId && row.colour === colour));
          const coveredShare = covered.reduce((sum, [, share]) => sum + share, 0);
          if (count && !covered.length) return invalid('unsupported-configuration-coverage');
          const colours = apportion(count, covered, [...entropy, model.modelLineId]);
          const modelCars = [];
          for (const colour of colours) {
            const candidates = [...configurations.values()].filter((row) => row.modelLineId === model.modelLineId && row.colour === colour.key);
            if (colour.count && !candidates.length) return invalid('unsupported-configuration-coverage');
            for (let i = 0; i < colour.count; i += 1) {
              const binding = candidates[ordinal([...entropy, model.modelLineId, colour.key, i, 'configuration'], candidates.length)];
              const vehicleId = `stock-${inputDigest([requestDigest, ...entropy, model.modelLineId, colour.key, i])}`;
              const lead = model.observed.leadTimeWeeks;
              const leadTimeWeeks = lead.min + ordinal([...entropy, vehicleId, 'lead'], lead.max - lead.min + 1);
              const car = { vehicleId, binding, leadTimeWeeks }; modelCars.push(car); vehicles.push(car);
            }
          }
          models.push({ modelLineId: model.modelLineId, sourceKind: model.observed.sourceKind, cars: count,
            observedShare: model.observed.carCount / aggregates.reduce((sum, row) => sum + row.observed.carCount, 0), actualShare: count / total,
            colourShares: Object.fromEntries(colours.map((row) => [row.key, count ? row.count / count : 0])),
            plannedColourShares: Object.fromEntries(covered.map(([colour, share]) => [colour, share / coveredShare])),
            coveredColourShare: Math.round(coveredShare * 10000) / 10000, uncoveredColourCount: offered.length - covered.length,
            leadTimeWeeks: count ? { min: Math.min(...modelCars.map((row) => row.leadTimeWeeks)), max: Math.max(...modelCars.map((row) => row.leadTimeWeeks)) } : null,
            observed: structuredClone(model.observed), aggregateKey: model.key });
        }
        const timeZone = values.get('supply.release.cadence').timeZone;
        // Lead time counts from the close of the planned release horizon: a window's backlog can release on any later
        // window, so a delivery week anchored on its own window could end before the car is released (FUCQ-229).
        const horizonEnd = releaseAt[releaseAt.length - 1];
        const observedAt = new Date(run.clockInstant).toISOString();
        const snapshotVersion = `${STOCK_GENERATOR_VERSION}:${policyVersion}`;
        const known = (value, sourceRef, unit = null) => ({ status: 'known', value, unit,
          provenance: { sourceRef, observedAt, version: snapshotVersion, assurance: 'synthetic-scenario' } });
        const own = (value, unit) => known(value, `generator:${STOCK_GENERATOR_VERSION}`, unit);
        const extras = new Map();
        for (const car of vehicles) {
          const id = car.binding.configurationId;
          if (extras.has(id)) continue;
          const extra = factsForConfiguration ? await factsForConfiguration(structuredClone(car.binding), structuredClone(car.binding.record)) : {};
          if (!object(extra) || Object.keys(extra).some((key) => RESERVED_FACTS.includes(key) || ['vin', 'vin7', 'vin17'].includes(key.toLowerCase()))) return invalid('invalid-stock-facts');
          const wrapped = Object.fromEntries(Object.entries(extra).map(([name, value]) =>
            [name, object(value) && keysExactly(value, ['value', 'unit']) ? own(value.value, value.unit) : own(value)]));
          // Validate before reserving identifiers, so a bad seam value cannot leave reservations behind.
          try { createVehicleSnapshot({ sourceNamespace: STOCK_GENERATOR_NAMESPACE, identityKind: 'exact-stock', sourceKeys: { stockId: id },
            snapshotVersion, observedAt, display: { name: id.slice(0, 32) }, facts: wrapped }); } catch { return invalid('invalid-stock-facts'); }
          extras.set(id, wrapped);
        }
        const retained = await readAllocationInventory(allocationInventoryPath);
        if (retained.status !== 'ok') return unavailable('retained-allocation-inventory-unavailable');
        const retainedStock = retained.inventory.records.filter((row) => row.runId === runId && row.vehicleId.startsWith('stock-'));
        const plannedVehicles = new Set(vehicles.map((car) => car.vehicleId));
        if (retainedStock.length && (retainedStock.length !== vehicles.length || retainedStock.some((row) =>
          row.seed !== inputDigest(entropy) || row.corpusVersion !== plan.corpusVersion || row.originatingDatasetId !== plan.datasetId
          || !plannedVehicles.has(row.vehicleId)))) return result('conflict', { reason: 'retained-stock-request-mismatch', current: {} });
        const allocated = await allocateInventoryFile({ path: allocationInventoryPath, expectedRevision: retained.inventory.revision,
          plan: { runId, seed: inputDigest(entropy),
          corpusVersion: plan.corpusVersion, datasetId: plan.datasetId, vehicles: vehicles.map((car) => ({ vehicleId: car.vehicleId,
            configurationId: car.binding.configurationId, snapshotVersion: car.binding.record.snapshotVersion,
            configuration: car.binding.record.configuration, usage: 'stock' })) } });
        if (allocated.status !== 'ok') return result(allocated.status, { reason: 'synthetic-allocation-failed' });
        const identities = new Map(allocated.inventory.records.map((row) => [row.vehicleId, row]));
        let rows;
        try {
          rows = vehicles.map((car, index) => {
            const identity = identities.get(car.vehicleId);
            const tranche = Math.floor(index / trancheSize);
            const windowIndex = tranche % (releaseAt.length - 1);
            const at = releaseAt[windowIndex];
            const { modelLineId, colour } = car.binding;
            const aggregateRef = `policy:${plan.aggregateKeys[modelLineId]}`;
            const title = plan.titles?.[modelLineId] ?? modelLineId; const displayName = plan.displayNames?.[modelLineId] ?? title;
            const facts = createVehicleSnapshot({ sourceNamespace: STOCK_GENERATOR_NAMESPACE, identityKind: 'exact-stock',
              sourceKeys: { stockId: identity.orderUuid }, snapshotVersion, observedAt, display: { name: `${displayName} in ${colour}` },
              facts: { ...extras.get(identity.configurationId), stockIdentityKind: own('synthetic'), modelLine: known(title, aggregateRef), colour: known(colour, aggregateRef),
                leadTimeWeeks: known(car.leadTimeWeeks, aggregateRef, 'weeks'),
                confirmedDeliveryWeek: known(confirmedWeek(horizonEnd, car.leadTimeWeeks, timeZone), aggregateRef),
                plannedRelease: known({ releaseId: `${runId}:stock:${tranche}`, windowStart: at, windowEnd: releaseAt[windowIndex + 1], policyVersion },
                  'policy:supply.release.cadence'),
                syntheticVehicleId: own(identity.vehicleId), configurationHash: own(identity.configurationHash),
                generatorVersion: own(STOCK_GENERATOR_VERSION), policyVersion: own(policyVersion) } });
            return { runId, orderUuid: identity.orderUuid, orderNumber: identity.orderNumber, wholesalerOrderId: identity.wholesalerOrderId,
              configurationId: identity.configurationId, corpusVersion: plan.corpusVersion, revision: 1, account: stockAccount,
              ...(rowVisibility ? { visibility: structuredClone(rowVisibility) } : {}), state: 'unreleased', status: 'unreleased', available: false, facts };
          });
        } catch { return invalid('invalid-stock-facts'); }
        const report = { runId, seed, policyVersion, generatorVersion: STOCK_GENERATOR_VERSION, totalCars: rows.length,
          configurationSource: { kind: plan.kind, source: plan.source, datasetId: plan.datasetId, corpusVersion: plan.corpusVersion, manifestDigest: activeDigest },
          models, release: { trancheSize, weeklyVolume: total, windows: releaseAt.slice(0, -1) }, policyProvenance: provenance };
        const digest = inputDigest({ plan, report, stockAccount, rows });
        return repository.transaction(context, { commandId: `stock-generation:${runId}`, inputDigest: digest }, async (tx) => {
          const current = await tx.get(ref);
          if (current.status !== 'ok') return current;
          if (current.value.version !== run.version) return result('stale-version', { reason: 'run-changed-during-generation' });
          const existing = await tx.list('stock');
          if (existing.status !== 'ok') return existing;
          if (existing.value.some((row) => row.facts?.sourceNamespace === STOCK_GENERATOR_NAMESPACE)) return result('conflict', { reason: 'stock-generation-exists', current: {} });
          for (const row of rows) {
            const write = await tx.insert('stock', row);
            if (write.status !== 'ok') return write;
          }
          const changed = await tx.compareAndSwap(ref, run.version, { versions: { ...run.versions,
            stockGeneration: { policyVersion, requestDigest, inputDigest: digest, generatorVersion: STOCK_GENERATOR_VERSION,
              corpusVersion: plan.corpusVersion, inventoryDigest: allocated.inventory.contentDigest, report } } });
          return changed.status === 'ok' ? ok({ generated: rows.length, report }) : changed;
        });
      } catch { return unavailable('stock-generation-unavailable'); }
    },
  });
}
