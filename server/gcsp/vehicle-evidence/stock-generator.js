import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { inputDigest, ok, result } from '../repository/core.js';
import { createVehicleSnapshot } from '../../vehicles/index.js';
import { allocateInventoryFile, readAllocationInventory } from './vin-allocation.js';
import { readCarNamer } from '../policy/car-name.js';
import { imageDisplay } from './display-images.js';

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
// Whether `size` pairwise-different colours exist among the (colour, key) pairs with `needKeys` of them on different keys:
// enough colours, plus a colour-to-key matching of that size (augmenting paths).
function witnessExists(pairs, size, needKeys) {
  const byColour = new Map();
  for (const [colour, key] of pairs) byColour.set(colour, [...(byColour.get(colour) ?? []), ...(key === undefined ? [] : [key])]);
  if (byColour.size < size) return false;
  const owner = new Map();
  const place = (colour, seen) => (byColour.get(colour) ?? []).some((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    if (!owner.has(key) || place(owner.get(key), seen)) { owner.set(key, colour); return true; }
    return false;
  });
  let matched = 0;
  for (const colour of byColour.keys()) if (matched < needKeys && place(colour, new Set())) matched += 1;
  return matched >= needKeys;
}
const uniquePairs = (items) => [...new Map(items.map(([colour, key]) => [JSON.stringify([colour, key]), [colour, key]])).values()];
const validGuarantee = (v) => v === undefined || object(v) && text(v.principalId) && positive(v.minimumCars) && typeof v.qualifies === 'function'
  && Array.isArray(v.distinct) && v.distinct.includes('colour') && v.distinct.every((name) => ['eligibilityModelKey', 'colour'].includes(name));

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
  visibility, factsForConfiguration, guarantee } = {}) {
  const plan = structuredClone(configurationPlan);
  const release = guarantee === undefined ? undefined : { principalId: guarantee.principalId, minimumCars: guarantee.minimumCars,
    distinct: Array.isArray(guarantee.distinct) ? [...guarantee.distinct] : guarantee.distinct };
  const rowVisibility = visibility === undefined ? undefined : structuredClone(visibility);
  return Object.freeze({
    async generateStock(runId, seed, policyVersion) {
      if (![runId, seed, policyVersion, stockAccount].every(text) || !validPlan(plan)
        || typeof allocationInventoryPath !== 'string' || !isAbsolute(allocationInventoryPath)
        || typeof contextForRun !== 'function' || typeof repository?.transaction !== 'function'
        || typeof repository?.read !== 'function' || typeof registry?.getConfiguration !== 'function'
        || typeof policyService?.getAssumption !== 'function' || !validVisibility(rowVisibility)
        || factsForConfiguration !== undefined && typeof factsForConfiguration !== 'function' || !validGuarantee(guarantee)) return invalid('invalid-generator-input');
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
          plan, stockAccount, clockInstant: run.clockInstant, ...(rowVisibility ? { visibility: rowVisibility } : {}), ...(release ? { guarantee: release } : {}) });
        const previous = run.versions?.stockGeneration;
        if (previous) return previous.requestDigest === requestDigest
          ? ok({ generated: previous.report.totalCars, report: structuredClone(previous.report) })
          : result('conflict', { reason: 'stock-generation-request-mismatch', current: {} });
        const read = { runId, asOf: run.clockInstant, policyVersion };
        const carName = await readCarNamer(policyService, read);
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
        // Optional release mix: per-line weights replace the observed car counts when every planned line has one.
        const mixRead = await policyService.getAssumption('supply.release.modelMix', read);
        const mix = mixRead?.status === 'ok' && mixRead.policyVersion === policyVersion ? mixRead.value?.value : null;
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
          const images = (Array.isArray(response.images) ? response.images : []).filter((image) => image.configurationId === binding.configurationId
            && /^assets\/gcsp-vehicle-evidence\/[a-f0-9]{64}\.webp$/.test(image.asset)
            && ['representative-model', 'representative-configuration'].includes(image.fidelity) && image.role === image.fidelity);
          configurations.set(binding.configurationId, { ...binding, record: response.record, images });
        }
        // Each tranche is drawn on its own, so every release mixes model lines and colours and no two releases repeat.
        if (guarantee && guarantee.minimumCars > trancheSize) return invalid('unsupported-release-guarantee');
        const windowCount = releaseAt.length - 1; const observedTotal = aggregates.reduce((sum, row) => sum + row.observed.carCount, 0);
        const mixed = object(mix) && aggregates.every((row) => Number.isFinite(mix[row.modelLineId]) && mix[row.modelLineId] >= 0)
          && aggregates.some((row) => mix[row.modelLineId] > 0);
        const weightOf = (row) => (mixed ? mix[row.modelLineId] : row.observed.carCount);
        const weightTotal = aggregates.reduce((sum, row) => sum + weightOf(row), 0);
        const vehicles = []; const tally = new Map(aggregates.map((row) => [row.modelLineId, { cars: 0, colours: new Map(), planned: [], debt: new Map() }]));
        const modelDebt = new Map();
        const observedAt = new Date(run.clockInstant).toISOString();
        const snapshotVersion = `${STOCK_GENERATOR_VERSION}:${policyVersion}`;
        const known = (value, sourceRef, unit = null) => ({ status: 'known', value, unit,
          provenance: { sourceRef, observedAt, version: snapshotVersion, assurance: 'synthetic-scenario' } });
        const own = (value, unit) => known(value, `generator:${STOCK_GENERATOR_VERSION}`, unit);
        const extras = new Map();
        async function ensureExtra(binding) {
          const id = binding.configurationId;
          if (extras.has(id)) return null;
          const extra = factsForConfiguration ? await factsForConfiguration(structuredClone(binding), structuredClone(binding.record)) : {};
          if (!object(extra) || Object.keys(extra).some((key) => RESERVED_FACTS.includes(key) || ['vin', 'vin7', 'vin17'].includes(key.toLowerCase()))) return invalid('invalid-stock-facts');
          const wrapped = Object.fromEntries(Object.entries(extra).map(([name, value]) =>
            [name, object(value) && keysExactly(value, ['value', 'unit']) ? own(value.value, value.unit) : own(value)]));
          // Validate before reserving identifiers, so a bad seam value cannot leave reservations behind.
          try { createVehicleSnapshot({ sourceNamespace: STOCK_GENERATOR_NAMESPACE, identityKind: 'exact-stock', sourceKeys: { stockId: id },
            snapshotVersion, observedAt, display: { name: id.slice(0, 32) }, facts: wrapped }); } catch { return invalid('invalid-stock-facts'); }
          extras.set(id, wrapped);
          return null;
        }
        // The pool: every plan configuration the guarantee's principal qualifies for (computed once per configuration).
        const keyOf = (binding) => extras.get(binding.configurationId)?.eligibilityModelKey?.value;
        const qualifying = new Map(); let pool = []; let needKeys = 0; let substituted = 0;
        if (guarantee) {
          for (const binding of configurations.values()) {
            const bad = await ensureExtra(binding);
            if (bad) return bad;
            qualifying.set(binding.configurationId, await guarantee.qualifies(structuredClone(binding), structuredClone(binding.record), structuredClone(extras.get(binding.configurationId))) === true);
          }
          pool = [...configurations.values()].filter((binding) => qualifying.get(binding.configurationId));
          needKeys = !guarantee.distinct.includes('eligibilityModelKey') ? 0
            : Math.min(guarantee.minimumCars, new Set(pool.map(keyOf).filter((key) => key !== undefined)).size);
          if (!witnessExists(uniquePairs(pool.map((binding) => [binding.colour, keyOf(binding)])), guarantee.minimumCars, needKeys)) return invalid('unsupported-release-guarantee');
        }
        const isQualifying = (car) => qualifying.get(car.binding.configurationId) === true;
        for (const model of aggregates) {
          // Observed colours with no configuration for this line are dropped; the covered shares are renormalised.
          const covered = Object.entries(model.observed.colourShares).sort(([a], [b]) => a.localeCompare(b))
            .filter(([colour]) => [...configurations.values()].some((row) => row.modelLineId === model.modelLineId && row.colour === colour));
          tally.get(model.modelLineId).planned = covered;
        }
        for (let tranche = 0; tranche * trancheSize < total; tranche += 1) {
          const windowAt = releaseAt[tranche % windowCount];
          const trancheEntropy = [windowAt, tranche];
          const first = vehicles.length;
          const trancheCars = Math.min(total, (tranche + 1) * trancheSize) - tranche * trancheSize;
          // Each draw carries its rounding debt forward, so small tranches cannot bias the run-level shares.
          const modelCounts = apportion(trancheCars, aggregates.map((row) => [row.modelLineId, Math.max(0,
            trancheCars * weightOf(row) / weightTotal + (modelDebt.get(row.modelLineId) ?? 0))]), [...entropy, 'models', ...trancheEntropy]);
          for (const row of modelCounts) modelDebt.set(row.key, (modelDebt.get(row.key) ?? 0)
            + trancheCars * weightOf(aggregates.find((model) => model.modelLineId === row.key)) / weightTotal - row.count);
          for (const model of aggregates) {
            const count = modelCounts.find((row) => row.key === model.modelLineId).count;
            const covered = tally.get(model.modelLineId).planned;
            if (count && !covered.length) return invalid('unsupported-configuration-coverage');
            const line = tally.get(model.modelLineId); line.cars += count;
            const coveredTotal = covered.reduce((sum, [, share]) => sum + share, 0);
            const colours = count && covered.length ? apportion(count, covered.map(([colour, share]) => [colour, Math.max(0,
              count * share / coveredTotal + (line.debt.get(colour) ?? 0))]), [...entropy, model.modelLineId, ...trancheEntropy]) : [];
            if (count) for (const [colour, share] of covered) line.debt.set(colour, (line.debt.get(colour) ?? 0) + count * share / coveredTotal - colours.find((row) => row.key === colour).count);
            for (const colour of colours) {
              const candidates = [...configurations.values()].filter((row) => row.modelLineId === model.modelLineId && row.colour === colour.key);
              if (colour.count && !candidates.length) return invalid('unsupported-configuration-coverage');
              line.colours.set(colour.key, (line.colours.get(colour.key) ?? 0) + colour.count);
              for (let i = 0; i < colour.count; i += 1) {
                const binding = candidates[ordinal([...entropy, model.modelLineId, colour.key, ...trancheEntropy, i, 'configuration'], candidates.length)];
                const vehicleId = `stock-${inputDigest([requestDigest, ...entropy, model.modelLineId, colour.key, ...trancheEntropy, i])}`;
                const lead = model.observed.leadTimeWeeks;
                const leadTimeWeeks = lead.min + ordinal([...entropy, vehicleId, 'lead'], lead.max - lead.min + 1);
                vehicles.push({ vehicleId, binding, leadTimeWeeks, tranche, model: model.modelLineId });
              }
            }
          }
          // A release must hold enough cars the principal qualifies for: swap non-qualifying cars from the biggest line.
          while (guarantee) {
            const mine = vehicles.slice(first);
            const held = mine.filter(isQualifying);
            const colours = new Set(held.map((car) => car.binding.colour));
            const keys = new Set(held.map((car) => keyOf(car.binding)).filter((key) => key !== undefined));
            if (witnessExists(uniquePairs(held.map((car) => [car.binding.colour, keyOf(car.binding)])), guarantee.minimumCars, needKeys)) break;
            const counts = new Map(mine.map((car) => [car.model, mine.filter((other) => other.model === car.model).length]));
            let index = -1;
            for (const [line] of [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))) {
              const options = []; for (let i = first; i < vehicles.length; i += 1) if (vehicles[i].model === line && !isQualifying(vehicles[i])) options.push(i);
              if (options.length) { index = options[ordinal([...entropy, 'guarantee', ...trancheEntropy, 'replace', substituted], options.length)]; break; }
            }
            const scored = pool.map((binding) => ({ binding, score: (colours.has(binding.colour) ? 0 : 1)
              + (keys.size < needKeys && keyOf(binding) !== undefined && !keys.has(keyOf(binding)) ? 1 : 0) }));
            const best = Math.max(0, ...scored.map((row) => row.score));
            if (index < 0) return invalid('unsupported-release-guarantee');
            const top = scored.filter((row) => row.score === best);
            const binding = top[ordinal([...entropy, 'guarantee', ...trancheEntropy, 'pick', substituted], top.length)].binding;
            const old = vehicles[index]; const lead = aggregates.find((row) => row.modelLineId === binding.modelLineId).observed.leadTimeWeeks;
            const vehicleId = `stock-${inputDigest([requestDigest, ...entropy, 'guarantee', ...trancheEntropy, index])}`;
            const from = tally.get(old.model); const to = tally.get(binding.modelLineId);
            from.cars -= 1; from.colours.set(old.binding.colour, from.colours.get(old.binding.colour) - 1);
            to.cars += 1; to.colours.set(binding.colour, (to.colours.get(binding.colour) ?? 0) + 1);
            vehicles[index] = { vehicleId, binding, tranche, model: binding.modelLineId,
              leadTimeWeeks: lead.min + ordinal([...entropy, vehicleId, 'lead'], lead.max - lead.min + 1) };
            substituted += 1;
          }
        }
        const models = aggregates.map((model) => {
          const { cars: count, colours, planned: covered } = tally.get(model.modelLineId);
          const modelCars = vehicles.filter((car) => car.model === model.modelLineId);
          const offered = Object.keys(model.observed.colourShares);
          const coveredShare = covered.reduce((sum, [, share]) => sum + share, 0);
          return { modelLineId: model.modelLineId, sourceKind: model.observed.sourceKind, cars: count,
            observedShare: model.observed.carCount / observedTotal, releaseShare: weightOf(model) / weightTotal, actualShare: count / total,
            colourShares: Object.fromEntries(covered.map(([colour]) => [colour, count ? (colours.get(colour) ?? 0) / count : 0])),
            plannedColourShares: Object.fromEntries(covered.map(([colour, share]) => [colour, share / coveredShare])),
            coveredColourShare: Math.round(coveredShare * 10000) / 10000, uncoveredColourCount: offered.length - covered.length,
            leadTimeWeeks: count ? { min: Math.min(...modelCars.map((row) => row.leadTimeWeeks)), max: Math.max(...modelCars.map((row) => row.leadTimeWeeks)) } : null,
            observed: structuredClone(model.observed), aggregateKey: model.key };
        });
        const timeZone = values.get('supply.release.cadence').timeZone;
        // Lead time counts from the close of the planned release horizon: a window's backlog can release on any later
        // window, so a delivery week anchored on its own window could end before the car is released (FUCQ-229).
        const horizonEnd = releaseAt[releaseAt.length - 1];
        for (const car of vehicles) {
          const bad = await ensureExtra(car.binding);
          if (bad) return bad;
        }
        const retained = await readAllocationInventory(allocationInventoryPath);
        if (retained.status !== 'ok') return unavailable('retained-allocation-inventory-unavailable');
        // No generation is recorded for this run, so leftover inventory records were never used: replace them.
        const allocated = await allocateInventoryFile({ path: allocationInventoryPath, expectedRevision: retained.inventory.revision,
          plan: { runId, seed: inputDigest(entropy), replaceRunStock: true,
          corpusVersion: plan.corpusVersion, datasetId: plan.datasetId, vehicles: vehicles.map((car) => ({ vehicleId: car.vehicleId,
            configurationId: car.binding.configurationId, snapshotVersion: car.binding.record.snapshotVersion,
            configuration: car.binding.record.configuration, usage: 'stock' })) } });
        if (allocated.status !== 'ok') return result(allocated.status, { reason: 'synthetic-allocation-failed' });
        const identities = new Map(allocated.inventory.records.map((row) => [row.vehicleId, row]));
        let rows;
        try {
          rows = vehicles.map((car) => {
            const identity = identities.get(car.vehicleId);
            const { tranche } = car;
            const windowIndex = tranche % windowCount;
            const at = releaseAt[windowIndex];
            const { modelLineId, colour } = car.binding;
            const aggregateRef = `policy:${plan.aggregateKeys[modelLineId]}`;
            const title = plan.titles?.[modelLineId] ?? modelLineId; const displayName = plan.displayNames?.[modelLineId] ?? title;
            const name = carName(extras.get(identity.configurationId)?.eligibilityModelKey?.value ?? title, displayName);
            const facts = createVehicleSnapshot({ sourceNamespace: STOCK_GENERATOR_NAMESPACE, identityKind: 'exact-stock',
              sourceKeys: { stockId: identity.orderUuid }, snapshotVersion, observedAt, display: imageDisplay(`${name} in ${colour}`, car.binding.images[0]),
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
          models, release: { trancheSize, weeklyVolume: total, windows: releaseAt.slice(0, -1),
            ...(release ? { guarantee: { ...release, substituted } } : {}) }, policyProvenance: provenance };
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
