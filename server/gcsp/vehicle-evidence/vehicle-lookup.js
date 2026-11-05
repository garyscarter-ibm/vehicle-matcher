import { inputDigest } from '../repository/core.js';
import { vehicleEvidenceDetails, vehicleEvidenceFailure, validVehicleEvidenceSource } from './vehicle-details-contract.js';

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 4096;
const canonicalConfiguration = (id) => {
  if (typeof id !== 'string' || id.length > 8192 || id.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(id)) return null;
  const decoded = Buffer.from(id, 'base64').toString('utf8');
  if (Buffer.from(decoded, 'utf8').toString('base64') !== id || !/^[A-Z0-9]{2,16}:[A-Z0-9]{2,16}(?:,[A-Z0-9]{2,16})*$/.test(decoded)) return null;
  const [model, selected] = decoded.split(':'); const codes = selected.split(',');
  return codes.length <= 256 && new Set(codes).size === codes.length && `${model}:${[...codes].sort().join(',')}` === decoded ? id : null;
};

/** Format only: no arbitrary unknown VIN is assigned a market, checksum or year profile. */
export function canonicalVehicleIdentifier(kind, id) {
  if (kind === 'configuration') return canonicalConfiguration(id);
  if (kind === 'stock') return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) ? id : null;
  if (kind !== 'vin' || typeof id !== 'string' || id.length > 4096) return null;
  const vin = id.trim().replace(/[a-z]/g, (character) => character.toUpperCase());
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}
const allowedExpected = ['configurationId', 'market', 'bodyType', 'profileId', 'snapshotVersion'];
const requestValid = (r) => object(r) && Object.keys(r).every((key) => ['kind', 'id', 'expected'].includes(key))
  && (r.expected === undefined || object(r.expected) && Object.entries(r.expected).every(([key, value]) => allowedExpected.includes(key) && text(value)));
const trustedContext = (c) => object(c) && ['runId', 'environmentId', 'principalId'].every((key) => text(c[key]))
  && Array.isArray(c.roles) && c.roles.every(text);
const accepted = (r) => ['ok', 'complete', 'partial'].includes(r?.status);
const sourceFailure = (outcome, kind) => vehicleEvidenceFailure(
  ['invalid-input', 'not-found', 'unsupported', 'identity-mismatch'].includes(outcome?.status) ? outcome.status : 'source-unavailable', kind);
const expectedMatches = (r, source) => !r.expected || Object.entries(r.expected).every(([key, value]) => value === ({
  configurationId: source.record.configurationId, market: source.record.configuration.market,
  bodyType: source.record.configuration.body, profileId: source.vehicle?.profile?.profileId,
  snapshotVersion: source.record.snapshotVersion,
})[key]);
const bindingMatches = (identity, record) => identity.configurationId === record.configurationId
  && identity.snapshotVersion === record.snapshotVersion && identity.configurationHash === inputDigest(record.configuration);

/** Read-only same-process port. Its dependencies have no live-provider or publication route. */
export function createVehicleEvidenceLookup({ registry, repository } = {}) {
  async function resolve(request, { context } = {}) {
    const kind = request?.kind;
    if (!requestValid(request)) return vehicleEvidenceFailure('invalid-input', kind);
    const id = canonicalVehicleIdentifier(kind, request.id);
    if (!id) return vehicleEvidenceFailure('invalid-input', kind);
    const canonical = { ...request, id };
    try {
      if (!registry) return vehicleEvidenceFailure('source-unavailable', kind);
      let stock = null; let source;
      if (kind === 'stock') {
        if (!repository?.read || !repository?.currentRun || !trustedContext(context)) return vehicleEvidenceFailure('source-unavailable', kind);
        const current = await repository.currentRun(context.environmentId);
        if (current?.status !== 'ok') return vehicleEvidenceFailure('source-unavailable', kind);
        if (current.value?.runId !== context.runId) return vehicleEvidenceFailure('identity-mismatch', kind);
        const found = await repository.read(context, { table: 'stock', key: { runId: context.runId, orderUuid: id } });
        if (found?.status !== 'ok') return sourceFailure(found, kind);
        stock = found.value;
        const association = stock?.facts?.syntheticIdentity;
        if (!object(stock) || stock.orderUuid !== id || stock.runId !== context.runId
          || !text(stock.configurationId) || !/^\d{7}$/.test(stock.orderNumber)
          || association?.identityKind !== 'synthetic' || !text(association.vehicleId)
          || !text(association.originatingDatasetId)) return vehicleEvidenceFailure('identity-mismatch', kind);
        source = await registry.getConfiguration(stock.configurationId);
        // A known stock row whose referenced configuration is absent has a broken association, not an unknown order UUID.
        if (source?.status === 'not-found') return vehicleEvidenceFailure('identity-mismatch', kind);
        if (!accepted(source)) return sourceFailure(source, kind);
        if (!validVehicleEvidenceSource(source)) return vehicleEvidenceFailure('source-unavailable', kind);
        if (!bindingMatches({ ...association, configurationId: stock.configurationId }, source.record)) return vehicleEvidenceFailure('identity-mismatch', kind);
        // Reset may race a read. Never return a previous run's stock as the new run's stock.
        const stillCurrent = await repository.currentRun(context.environmentId);
        if (stillCurrent?.status !== 'ok') return vehicleEvidenceFailure('source-unavailable', kind);
        if (stillCurrent.value?.runId !== context.runId) return vehicleEvidenceFailure('identity-mismatch', kind);
      } else {
        source = await (kind === 'vin' ? registry.getVin(id) : registry.getConfiguration(id));
        if (!accepted(source)) return sourceFailure(source, kind);
        if (!validVehicleEvidenceSource(source)) return vehicleEvidenceFailure('source-unavailable', kind);
        if (kind === 'configuration' && source.record.configurationId !== id) return vehicleEvidenceFailure('identity-mismatch', kind);
        if (kind === 'vin' && (!object(source.vehicle) || source.vehicle.vin17 !== id
          || source.vehicle.identityKind !== 'synthetic' || !['current-car', 'delivered-car'].includes(source.vehicle.usage)
          || !bindingMatches(source.vehicle, source.record))) return vehicleEvidenceFailure('identity-mismatch', kind);
      }
      if (!expectedMatches(canonical, source)) return vehicleEvidenceFailure('identity-mismatch', kind);
      if (source.record.catalogue?.status === 'unsupported') return vehicleEvidenceFailure('unsupported', kind);
      if (source.record.catalogue?.status === 'identity-mismatch') return vehicleEvidenceFailure('identity-mismatch', kind);
      return vehicleEvidenceDetails(canonical, source, stock);
    } catch {
      return vehicleEvidenceFailure('source-unavailable', kind);
    }
  }
  return Object.freeze({ resolve });
}
