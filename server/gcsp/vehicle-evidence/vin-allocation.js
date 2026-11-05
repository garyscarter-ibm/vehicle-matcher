import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inputDigest, ok } from '../repository/core.js';
import { calculateVinCheckDigit, generateVin, VIN_GENERATOR_VERSION } from './vin-generator.js';

const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const recordKey = (row) => JSON.stringify([row.runId, row.vehicleId]);
const sortRecords = (records) => records.sort((a, b) => compare(recordKey(a), recordKey(b)));
const VIN_FIELDS = ['vin17', 'vin7', 'serial', 'profile', 'sourceKind', 'sources', 'confidence', 'unknownFields',
  'completeVinDecoded', 'modelYear', 'productionEra', 'productionDate', 'registrationDate', 'vinAllocationOrigin'];
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const canonicalAllocationContent = (inventory) => JSON.stringify(canonical(inventory), null, 2) + '\n';
const seal = (inventory) => {
  const { contentDigest, ...content } = inventory;
  return { ...content, contentDigest: inputDigest(content) };
};
const validLimits = (limits) => object(limits) && [['maxAttempts', 1000000], ['serialSpace', 1000000],
  ['orderNumberSpace', 10000000], ['wholesalerSpace', 90000000]].every(([key, max]) => Number.isInteger(limits[key]) && limits[key] > 0 && limits[key] <= max)
  && Object.keys(limits).length === 4;

export function emptyAllocationInventory(limits = {}) {
  const settings = { maxAttempts: 1000, serialSpace: 1000000, orderNumberSpace: 10000000, wholesalerSpace: 90000000, ...limits };
  if (!validLimits(settings)) throw new TypeError('Invalid finite allocation limits');
  return seal({ schemaVersion: '1', generatorVersion: VIN_GENERATOR_VERSION, revision: 0, limits: settings, records: [] });
}

function validRecord(row) {
  if (!object(row) || !['runId', 'vehicleId', 'configurationId', 'snapshotVersion', 'configurationHash', 'seed',
    'corpusVersion', 'originatingDatasetId'].every((key) => text(row[key])) || row.identityKind !== 'synthetic'
    || row.generatorVersion !== VIN_GENERATOR_VERSION || !uuid(row.orderUuid) || !/^[0-9]{7}$/.test(row.orderNumber)
    || !Number.isInteger(row.wholesalerOrderId) || row.wholesalerOrderId < 10000000 || row.wholesalerOrderId > 99999999
    || !['stock', 'delivered-car', 'current-car'].includes(row.usage)) return false;
  if (row.usage === 'stock') return !['vin17', 'vin7', 'serial', 'profile'].some((key) => Object.hasOwn(row, key));
  return typeof row.vin17 === 'string' && /^[A-HJ-NPR-Z0-9]{17}$/.test(row.vin17)
    && row.vin17[8] === calculateVinCheckDigit(row.vin17).character && row.vin7 === row.vin17.slice(-7)
    && row.serial === row.vin17.slice(11) && /^[0-9]{6}$/.test(row.serial)
    && text(row.profile?.profileId) && row.profile.profileVersion === '1'
    && row.profile.registryVersion === 'vin-profiles.v1' && row.profile.referenceOnly === true
    && row.sourceKind === 'evidenced-reference' && Array.isArray(row.sources) && row.sources.length > 0
    && row.productionDate === null && row.registrationDate === null && row.completeVinDecoded === false
    && ['seed', 'runId', 'originatingDatasetId'].every((key) => text(row.vinAllocationOrigin?.[key]));
}

function inventoryValid(inventory) {
  try {
    if (!object(inventory) || inventory.schemaVersion !== '1' || inventory.generatorVersion !== VIN_GENERATOR_VERSION
      || !Number.isSafeInteger(inventory.revision) || inventory.revision < 0 || !validLimits(inventory.limits)
      || !Array.isArray(inventory.records) || !inventory.records.every(validRecord)
      || inventory.contentDigest !== seal(inventory).contentDigest) return false;
    const unique = (key, select = (r) => r[key]) => {
      const values = inventory.records.map(select).filter((v) => v !== undefined);
      return new Set(values).size === values.length;
    };
    const physicalCars = new Map(); const vins = new Map(); const shortVins = new Map();
    for (const row of inventory.records.filter((record) => record.vin17)) {
      const association = inputDigest([row.vehicleId, row.configurationId, row.configurationHash, row.snapshotVersion,
        row.corpusVersion, ...VIN_FIELDS.map((key) => row[key])]);
      for (const [map, key] of [[physicalCars, row.vehicleId], [vins, row.vin17], [shortVins, row.vin7]]) {
        if (map.has(key) && map.get(key) !== association) return false;
        map.set(key, association);
      }
    }
    return unique('identity', recordKey) && unique('orderUuid') && unique('wholesalerOrderId')
      && unique('orderNumber', (r) => JSON.stringify([r.runId, r.orderNumber]));
  } catch { return false; }
}

const VEHICLE_FIELDS = ['vehicleId', 'configurationId', 'snapshotVersion', 'configuration', 'usage',
  'profileId', 'profileVersion', 'registryVersion', 'referenceOnly'];
function planValid(plan) {
  try {
    return object(plan) && ['runId', 'seed', 'corpusVersion', 'datasetId'].every((key) => text(plan[key]))
      && Object.keys(plan).every((key) => ['runId', 'seed', 'corpusVersion', 'datasetId', 'generatorVersion', 'vehicles'].includes(key))
      && Array.isArray(plan.vehicles) && plan.vehicles.length > 0 && plan.vehicles.length <= 100000
      && new Set(plan.vehicles.map((v) => v?.vehicleId)).size === plan.vehicles.length
      && plan.vehicles.every((vehicle) => object(vehicle) && Object.keys(vehicle).every((key) => VEHICLE_FIELDS.includes(key))
        && ['vehicleId', 'configurationId', 'snapshotVersion'].every((key) => text(vehicle[key]))
        && ['stock', 'current-car', 'delivered-car'].includes(vehicle.usage) && object(vehicle.configuration)
        && (vehicle.usage === 'stock' || text(vehicle.profileId) && vehicle.referenceOnly === true)
        && Boolean(inputDigest(vehicle.configuration)));
  } catch { return false; }
}
const digest = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest();
const ordinal = (parts, size) => Number(digest(parts).readBigUInt64BE() % BigInt(size));
function orderUuid(parts) {
  const bytes = digest(parts).subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Plans against the complete retained inventory; callers publish only a successful whole result. */
export async function allocateSyntheticIdentities(inventory, plan, { expectedRevision } = {}) {
  if (!inventoryValid(inventory)) return { status: 'invalid-inventory' };
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== inventory.revision) {
    return { status: 'stale-revision', expectedRevision, currentRevision: inventory.revision };
  }
  if (!planValid(plan)) return { status: 'invalid-input' };
  if (plan.generatorVersion !== undefined && plan.generatorVersion !== VIN_GENERATOR_VERSION) return { status: 'version-conflict' };
  if (inventory.records.some((row) => row.runId === plan.runId && row.corpusVersion !== plan.corpusVersion)) return { status: 'version-conflict' };
  const next = structuredClone(inventory);
  const { limits, records } = next;
  let collisions = 0; let changed = false;
  const exhausted = (reason, attempts) => ({ status: 'exhausted', reason, attempts, collisions });
  const choose = (parts, size, occupied, convert) => {
    const attempts = Math.min(limits.maxAttempts, size);
    const start = ordinal(parts, size);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const candidate = convert((start + attempt) % size, attempt);
      if (!occupied(candidate)) return { value: candidate };
      collisions += 1;
    }
    return { attempts };
  };
  for (const vehicle of [...plan.vehicles].sort((a, b) => compare(a.vehicleId, b.vehicleId))) {
    const common = { runId: plan.runId, vehicleId: vehicle.vehicleId, configurationId: vehicle.configurationId,
      snapshotVersion: vehicle.snapshotVersion, configurationHash: inputDigest(vehicle.configuration), seed: plan.seed,
      corpusVersion: plan.corpusVersion, generatorVersion: VIN_GENERATOR_VERSION };
    let row = records.find((entry) => recordKey(entry) === recordKey(common));
    const physicalCar = records.find((entry) => entry.vehicleId === vehicle.vehicleId && entry.vin17);
    if (physicalCar && (['configurationId', 'snapshotVersion', 'configurationHash', 'corpusVersion', 'generatorVersion']
      .some((key) => physicalCar[key] !== common[key])
      || vehicle.profileId !== undefined && vehicle.profileId !== physicalCar.profile.profileId
      || vehicle.profileVersion !== undefined && vehicle.profileVersion !== physicalCar.profile.profileVersion
      || vehicle.registryVersion !== undefined && vehicle.registryVersion !== physicalCar.profile.registryVersion)) return { status: 'version-conflict' };
    if (row && (Object.entries(common).some(([key, value]) => row[key] !== value)
      || row.profile && (vehicle.profileId !== undefined && vehicle.profileId !== row.profile.profileId
        || vehicle.profileVersion !== undefined && vehicle.profileVersion !== row.profile.profileVersion
        || vehicle.registryVersion !== undefined && vehicle.registryVersion !== row.profile.registryVersion
        || vehicle.referenceOnly !== undefined && vehicle.referenceOnly !== row.profile.referenceOnly))) return { status: 'version-conflict' };
    if (vehicle.profileVersion !== undefined && vehicle.profileVersion !== '1') return { status: 'version-conflict' };
    const entropy = [VIN_GENERATOR_VERSION, plan.seed, plan.runId, plan.corpusVersion, vehicle.vehicleId];
    if (!row) {
      const id = choose([...entropy, 'uuid'], limits.maxAttempts, (value) => records.some((r) => r.orderUuid === value),
        (value, attempt) => orderUuid([...entropy, 'uuid', attempt]));
      if (id.value === undefined) return exhausted('order-uuid-space', id.attempts);
      const number = choose([...entropy, 'order-number'], limits.orderNumberSpace,
        (value) => records.some((r) => r.runId === plan.runId && r.orderNumber === value), (value) => String(value).padStart(7, '0'));
      if (number.value === undefined) return exhausted('order-number-space', number.attempts);
      const wholesaler = choose([...entropy, 'wholesaler'], limits.wholesalerSpace,
        (value) => records.some((r) => r.wholesalerOrderId === value), (value) => 10000000 + value);
      if (wholesaler.value === undefined) return exhausted('wholesaler-space', wholesaler.attempts);
      row = { ...common, originatingDatasetId: plan.datasetId, identityKind: 'synthetic', usage: 'stock',
        orderUuid: id.value, orderNumber: number.value, wholesalerOrderId: wholesaler.value };
      records.push(row); changed = true;
    }
    if (vehicle.usage !== 'stock' && !row.vin17) {
      if (physicalCar) {
        Object.assign(row, structuredClone(Object.fromEntries(VIN_FIELDS.map((key) => [key, physicalCar[key]]))), { usage: vehicle.usage });
        changed = true; continue;
      }
      const attempts = Math.min(limits.maxAttempts, limits.serialSpace);
      const start = ordinal([...entropy, 'serial'], limits.serialSpace);
      let allocated = false;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const serial = String((start + attempt) % limits.serialSpace).padStart(6, '0');
        const candidate = await generateVin({ ...vehicle, serial });
        if (candidate.status !== 'ok') return { status: candidate.status, reason: candidate.reason, collisions };
        if (records.some((record) => record.vin17 === candidate.vin17 || record.vin7 === candidate.vin7)) { collisions += 1; continue; }
        const { status, ...identity } = candidate;
        Object.assign(row, identity, { usage: vehicle.usage, vinAllocationOrigin: { seed: plan.seed, runId: plan.runId,
          originatingDatasetId: plan.datasetId } }); allocated = true; changed = true; break;
      }
      if (!allocated) return exhausted('vin-serial-space', attempts);
    }
  }
  sortRecords(records);
  if (changed) next.revision += 1;
  return { status: 'ok', inventory: seal(next), collisions };
}

export async function readAllocationInventory(path) {
  try {
    let data;
    try { data = JSON.parse(await readFile(path, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return { status: 'ok', inventory: emptyAllocationInventory() };
      return { status: error instanceof SyntaxError ? 'invalid-inventory' : 'source-unavailable' };
    }
    return inventoryValid(data) ? { status: 'ok', inventory: data } : { status: 'invalid-inventory' };
  } catch { return { status: 'source-unavailable' }; }
}

/** Exclusive create plus revision check prevents a stale process from publishing over another writer. */
export async function allocateInventoryFile({ path, expectedRevision, plan }) {
  if (!text(path)) return { status: 'invalid-input' };
  const destination = resolve(path); const lockPath = destination + '.lock';
  let lock; let temporary; let file;
  try {
    try { lock = await open(lockPath, 'wx', 0o600); }
    catch (error) { return { status: error.code === 'EEXIST' ? 'competing-writer' : 'source-unavailable' }; }
    const loaded = await readAllocationInventory(destination);
    if (loaded.status !== 'ok') return loaded;
    const result = await allocateSyntheticIdentities(loaded.inventory, plan, { expectedRevision });
    if (result.status !== 'ok' || result.inventory.contentDigest === loaded.inventory.contentDigest) return result;
    temporary = `${destination}.tmp-${randomUUID()}`;
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(canonicalAllocationContent(result.inventory)); await file.sync(); await file.close(); file = null;
    await rename(temporary, destination); temporary = null;
    return result;
  } catch { return { status: 'source-unavailable' }; }
  finally {
    await file?.close().catch(() => {});
    if (temporary) await unlink(temporary).catch(() => {});
    if (lock) { await lock.close(); await unlink(lockPath); }
  }
}

/** Stock import is one repository transaction; inventory publication is a separate offline stage. */
export async function publishStockOrders({ repository, context, inventory, expectedRunVersion, commandId }) {
  if (!inventoryValid(inventory)) return { status: 'invalid-inventory' };
  if (!repository || !object(context) || !text(commandId) || !Number.isSafeInteger(expectedRunVersion) || expectedRunVersion < 1) return { status: 'invalid-input' };
  const records = inventory.records.filter((row) => row.runId === context.runId && row.usage !== 'current-car');
  if (!records.length) return { status: 'invalid-input', reason: 'no-stock-for-run' };
  return repository.transaction(context, { commandId, inputDigest: inputDigest({ records, expectedRunVersion }) }, async (tx) => {
    const runKey = { table: 'runs', key: { runId: context.runId } };
    const run = await tx.get(runKey);
    if (run.status !== 'ok') return run;
    const published = run.value.versions?.syntheticIdentityInventory;
    if (published && (published.revision > inventory.revision
      || published.revision === inventory.revision && published.contentDigest !== inventory.contentDigest)) {
      return { status: 'conflict', reason: 'inventory-version-conflict', current: {} };
    }
    if (run.value.corpusVersion !== undefined && run.value.corpusVersion !== records[0].corpusVersion) return { status: 'conflict', reason: 'corpus-version-conflict', current: {} };
    for (const row of records) {
      const key = { table: 'stock', key: { runId: context.runId, orderUuid: row.orderUuid } };
      const existing = await tx.get(key);
      if (existing.status === 'ok') {
        if (['configurationId', 'orderNumber', 'wholesalerOrderId', 'corpusVersion'].some((field) => existing.value[field] !== row[field])
          || existing.value.facts?.syntheticIdentity?.configurationHash !== row.configurationHash
          || existing.value.facts?.syntheticIdentity?.snapshotVersion !== row.snapshotVersion) return { status: 'conflict', reason: 'immutable-stock-association', current: {} };
      } else if (existing.status === 'not-found') {
        const written = await tx.insert('stock', { runId: row.runId, orderUuid: row.orderUuid, orderNumber: row.orderNumber,
          wholesalerOrderId: row.wholesalerOrderId, configurationId: row.configurationId, corpusVersion: row.corpusVersion,
          revision: 1, state: 'unreleased', available: false,
          facts: { syntheticIdentity: { vehicleId: row.vehicleId, identityKind: 'synthetic', generatorVersion: row.generatorVersion,
            originatingDatasetId: row.originatingDatasetId, configurationHash: row.configurationHash, snapshotVersion: row.snapshotVersion } } });
        if (written.status !== 'ok') return written;
      } else return existing;
    }
    const updated = await tx.compareAndSwap(runKey, expectedRunVersion,
      { versions: { ...run.value.versions, syntheticIdentityInventory: { revision: inventory.revision, contentDigest: inventory.contentDigest } } });
    return updated.status === 'ok' ? ok({ imported: records.length, runVersion: updated.value.version, inventoryRevision: inventory.revision }) : updated;
  });
}

export function presentSyntheticIdentity(result) {
  if (result?.status !== 'ok' || !validRecord(result.record)) return { status: result?.status === 'ok' ? 'invalid-inventory' : result?.status || 'source-unavailable',
    message: { exhausted: 'The finite synthetic identifier space is exhausted.', collision: 'A synthetic identifier collision was detected.',
      unsupported: 'This vehicle profile or usage is unsupported.', 'source-unavailable': 'The identity source is unavailable.' }[result?.status]
      || 'The synthetic association could not be published. Review its status before continuing.' };
  const row = result.record;
  return { status: 'ok', identityKind: 'synthetic', orderReference: row.orderNumber,
    notice: 'Fictional association to retained configuration facts. This is not a factory build or vehicle authentication.',
    ...(Number.isSafeInteger(result.collisions) && result.collisions > 0
      ? { collisionsResolved: result.collisions, collisionMessage: 'Synthetic identifier collisions were resolved before publication.' } : {}),
    ...(row.vin17 ? { referenceOnly: row.profile.referenceOnly, profileId: row.profile.profileId, confidence: row.confidence,
      sources: structuredClone(row.sources), unknownFields: structuredClone(row.unknownFields), productionDate: row.productionDate,
      registrationDate: row.registrationDate, completeVinDecoded: false,
      ...(row.usage === 'delivered-car' ? { vin7: row.vin7, vin17: row.vin17 } : {}) } : {}) };
}
