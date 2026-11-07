import { ok, result } from '../repository/index.js';
import { validInstant } from '../policy/file-provider.js';

export const STOCK_PULL_VERSION = '1.0.0';
export const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512;
export const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const invalid = (field, reason) => result('invalid', { code: 'invalid-stock-pull', reasons: [{ field, reason }] });
export const unavailable = () => result('unavailable', { reason: 'Stock source is unavailable.', retryable: true });
export const STOCK_FIELDS = Object.freeze(['orderUuid', 'orderNumber', 'configurationId', 'wholesalerOrderId',
  'revision', 'account', 'visibility', 'agModelCode', 'vgModelCode', 'facts', 'corpusVersion', 'availability']);
const noVin = (value) => !object(value) && !Array.isArray(value) || Object.entries(value)
  .every(([key, child]) => !['vin', 'vin7', 'vin17'].includes(key.toLowerCase()) && noVin(child));
export const validCar = (car) => object(car) && Object.keys(car).every((key) => STOCK_FIELDS.includes(key))
  && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(car.orderUuid)
  && typeof car.orderNumber === 'string' && /^\d{7}$/.test(car.orderNumber) && text(car.configurationId)
  && (car.wholesalerOrderId === undefined || Number.isInteger(car.wholesalerOrderId)
    && car.wholesalerOrderId >= 10000000 && car.wholesalerOrderId <= 99999999)
  && (car.revision === undefined || Number.isSafeInteger(car.revision) && car.revision > 0)
  && (car.availability === undefined || object(car.availability)
    && Object.keys(car.availability).every((key) => key === 'availableUntil')
    && validInstant(car.availability.availableUntil)) && noVin(car);
export function validatePull(outcome, request) {
  if (!outcome || outcome.status !== 'ok') return outcome?.status === 'unavailable' ? unavailable() : invalid('provider', 'Expected a complete stock-list outcome.');
  const value = outcome.value;
  if (!object(value) || Object.keys(value).some((key) => !['schemaVersion', 'runId', 'observedAt', 'source', 'tranche', 'stock'].includes(key))
    || value.schemaVersion !== STOCK_PULL_VERSION || value.runId !== request.runId
    || value.observedAt !== request.asOf || !object(value.source)
    || Object.keys(value.source).some((key) => !['providerId', 'version', 'label', 'mode'].includes(key))
    || !['providerId', 'version', 'label'].every((key) => text(value.source[key]))
    || !['synthetic', 'dated-snapshot', 'authorised-live'].includes(value.source.mode)
    || !Array.isArray(value.stock) || !value.stock.every(validCar)
    || new Set(value.stock.map((row) => row.orderUuid)).size !== value.stock.length
    || new Set(value.stock.map((row) => row.orderNumber)).size !== value.stock.length) return invalid('stock', 'Malformed, duplicated or wrong-run stock snapshot.');
  const tranche = value.tranche;
  if (tranche !== null && (!object(tranche)
    || Object.keys(tranche).some((key) => !['trancheId', 'windowId', 'availableAt', 'supplyId', 'orderUuids'].includes(key))
    || !text(tranche.trancheId) || !text(tranche.windowId)
    || !validInstant(tranche.availableAt) || Date.parse(tranche.availableAt) > Date.parse(request.asOf)
    || !(tranche.supplyId === null || text(tranche.supplyId)) || !Array.isArray(tranche.orderUuids)
    || !tranche.orderUuids.length || new Set(tranche.orderUuids).size !== tranche.orderUuids.length
    || tranche.orderUuids.some((id) => !value.stock.some((car) => car.orderUuid === id)))) return invalid('tranche', 'Expected a released exact-car tranche at the current time.');
  return ok(structuredClone(value));
}
