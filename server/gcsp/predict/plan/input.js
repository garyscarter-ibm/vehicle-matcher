import { inputDigest } from '../../repository/core.js';
import { validInstant } from '../../policy/file-provider.js';

export const CONTRACT_VERSION = '1.0.0';
export const SOLVER_LIMITS = Object.freeze({ derivatives: 12, entitlements: 128, supplyLots: 256, candidatePlans: 50000, matchingSteps: 2000000 });
export const integer = (v) => Number.isSafeInteger(v) && v >= 0;
export const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 512;
export const instant = validInstant;
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = (values) => new Set(values).size === values.length;
const day = 86400000;

export function resolveInput(input) {
  const reasons = [];
  const reject = (field, reason) => reasons.push({ field, reason });
  try { inputDigest(input); } catch { return { reasons: [{ field: 'input', reason: 'Supply finite JSON data.' }] }; }
  if (!object(input)) return { reasons: [{ field: 'input', reason: 'Supply an input object.' }] };
  if (!text(input.runId) || !instant(input.asOf)) reject('runId/asOf', 'Supply a run and ISO planning instant.');
  if (!object(input.versions) || ['forecast', 'policy', 'stock', 'supply', 'cohort', 'catalog'].some((k) => !text(input.versions[k]))) reject('versions', 'Pin forecast, policy, stock, supply, cohort and catalog.');
  const forecast = input.forecast;
  if (!object(forecast) || !text(forecast.basis) || !instant(forecast.horizonEnd)
    || !Array.isArray(forecast.entitlements) || !Array.isArray(forecast.limitations) || !forecast.limitations.every(text)) reject('forecast', 'Supply a versioned joint entitlement forecast, horizon and limitations.');
  const catalog = input.catalog;
  if (!Array.isArray(catalog) || !catalog.length || catalog.some((d) => !object(d) || !text(d.derivativeId) || !text(d.modelId)
    || !integer(d.unitCostMinor) || !integer(d.leadTimeDays)
    || !Number.isFinite(new Date(Date.parse(input.asOf) + d.leadTimeDays * day).getTime())) || !unique(catalog.map((d) => d?.derivativeId))) reject('catalog', 'Supply unique derivatives, model, integer cost and finite resolved lead time.');
  const policy = input.constraints;
  if (!object(policy) || !integer(policy.horizonDays) || !integer(policy.budgetMinor) || !/^[A-Z]{3}$/.test(policy.currency ?? '')
    || !object(policy.objectiveWeights) || ['coverage', 'unallocatedStock', 'costMinor'].some((k) => !integer(policy.objectiveWeights[k]))
    || !['coverage', 'unallocatedStock', 'costMinor'].some((k) => policy.objectiveWeights[k] > 0)) reject('constraints', 'Supply explicit horizon, budget, currency and nonnegative integer objective weights.');
  if (reasons.length) return { reasons };
  if (Date.parse(forecast.horizonEnd) !== Date.parse(input.asOf) + policy.horizonDays * day) reject('forecast.horizonEnd', 'Forecast and policy horizon must agree exactly.');
  const derivatives = new Set(catalog.map((d) => d.derivativeId));
  const models = new Set(catalog.map((d) => d.modelId));
  for (const [field, id, required] of [['derivativeBounds', 'derivativeId', derivatives], ['modelBounds', 'modelId', models]]) {
    const rows = policy[field];
    if (!Array.isArray(rows) || rows.length !== required.size || rows.some((b) => !object(b) || !required.has(b[id]) || !integer(b.min) || !integer(b.max))
      || !unique(rows.map((b) => b?.[id]))) reject(`constraints.${field}`, 'Supply one explicit integer minimum and maximum for every catalog identity.');
  }
  const entitlements = forecast.entitlements;
  if (entitlements.some((e) => !object(e) || ['entitlementId', 'employeeId', 'renewalId', 'entitlementSlotId'].some((k) => !text(e[k]))
    || !instant(e.renewalAt) || Date.parse(e.renewalAt) > Date.parse(forecast.horizonEnd)
    || e.requiredBy !== undefined && (!instant(e.requiredBy) || Date.parse(e.requiredBy) > Date.parse(e.renewalAt))
    || !Array.isArray(e.acceptableDerivativeIds) || !e.acceptableDerivativeIds.every((id) => derivatives.has(id)) || !unique(e.acceptableDerivativeIds)
    || !Array.isArray(e.gates) || !e.gates.every(text)
    || e.excludedStockIds !== undefined && (!Array.isArray(e.excludedStockIds) || !e.excludedStockIds.every(text) || !unique(e.excludedStockIds)))
    || !unique(entitlements.map((e) => e?.entitlementId)) || !unique(entitlements.map((e) => e?.employeeId))
    || !unique(entitlements.map((e) => e?.entitlementSlotId))) reject('forecast.entitlements', 'Each employee occurs once, with unique entitlement/slot, exact renewal date and joint permitted choices.');
  for (const [name, id] of [['stock', 'stockId'], ['inbound', 'supplyId']]) {
    const rows = input[name];
    if (!Array.isArray(rows) || !unique(rows.map((r) => r?.[id])) || rows.some((r) => !object(r) || !text(r[id]) || !derivatives.has(r.derivativeId)
      || (name === 'stock' ? !instant(r.availableAt) || Date.parse(r.availableAt) > Date.parse(input.asOf) || !(r.heldForEntitlementId === null || text(r.heldForEntitlementId))
        || (r.permittedEntitlementIds !== undefined && r.permittedEntitlementIds !== null
          && (!Array.isArray(r.permittedEntitlementIds) || !r.permittedEntitlementIds.every(text) || !unique(r.permittedEntitlementIds)))
        : r.state !== 'confirmed' || !integer(r.quantity) || r.quantity === 0 || !integer(r.releasedQuantity) || r.releasedQuantity > r.quantity || !instant(r.expectedAt)))) reject(name, 'Supply exact unique released/held units or confirmed unreleased quantities and dates.');
  }
  if (reasons.length) return { reasons };
  const value = structuredClone(input);
  value.catalog.sort((a, b) => compare(a.derivativeId, b.derivativeId));
  value.forecast.entitlements.sort((a, b) => compare(a.requiredBy ?? a.renewalAt, b.requiredBy ?? b.renewalAt) || compare(a.entitlementId, b.entitlementId));
  for (const e of value.forecast.entitlements) { e.acceptableDerivativeIds.sort(compare); e.excludedStockIds?.sort(compare); }
  value.stock.sort((a, b) => compare(a.stockId, b.stockId));
  value.inbound.sort((a, b) => compare(a.supplyId, b.supplyId));
  value.constraints.modelBounds.sort((a, b) => compare(a.modelId, b.modelId));
  value.constraints.derivativeBounds.sort((a, b) => compare(a.derivativeId, b.derivativeId));
  // Reject unsafe arithmetic before comparing or ranking integer plans.
  const maxSpend = value.catalog.reduce((n, d) => n + d.unitCostMinor * policy.derivativeBounds.find((b) => b.derivativeId === d.derivativeId).max, 0);
  const maxUnits = value.stock.length + value.inbound.reduce((n, s) => n + s.quantity, 0) + policy.derivativeBounds.reduce((n, b) => n + b.max, 0);
  if (![maxSpend, maxUnits, maxSpend * policy.objectiveWeights.costMinor + maxUnits * policy.objectiveWeights.unallocatedStock
    + entitlements.length * policy.objectiveWeights.coverage].every(Number.isSafeInteger)) return { reasons: [{ field: 'constraints', reason: 'Plan arithmetic exceeds exact integer precision.' }] };
  return { value };
}
