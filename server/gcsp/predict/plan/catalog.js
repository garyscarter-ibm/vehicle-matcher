import { CONTRACT_VERSION, SOLVER_LIMITS, text, integer, instant } from './input.js';

export const CATALOG_KEY = 'orderPlan.catalog.v1';
const fail = (status, code) => ({ status, code, contractVersion: CONTRACT_VERSION });
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const unique = (values) => new Set(values).size === values.length;
const scalar = (v) => ['string', 'number', 'boolean'].includes(typeof v) && (typeof v !== 'number' || Number.isFinite(v));
const compactFact = (f) => object(f) && (f.value === null || scalar(f.value) || Array.isArray(f.value) && f.value.every(scalar))
  && (f.unit === null || text(f.unit)) && (typeof f.value !== 'number' || text(f.unit));

function valid(entry) {
  const v = entry.value;
  if (!object(v) || !text(v.version) || !/^[A-Z]{3}$/.test(v.currency ?? '') || !text(v.assurance) || !instant(entry.effectiveFrom)
    || !Array.isArray(v.derivatives) || !v.derivatives.length || v.derivatives.length > SOLVER_LIMITS.derivatives
    || !Array.isArray(v.configurations) || !v.configurations.length || v.configurations.length > 256) return false;
  const ids = v.configurations.map((c) => c?.configurationId);
  if (!unique(v.derivatives.map((d) => d?.derivativeId)) || !unique(ids)) return false;
  const derivativeOk = v.derivatives.every((d) => object(d) && text(d.derivativeId) && text(d.modelId) && integer(d.unitCostMinor)
    && text(d.production?.model) && text(d.production.derivative) && Array.isArray(d.configurationIds) && d.configurationIds.length > 0
    && d.configurationIds.every(text) && unique(d.configurationIds)
    && d.configurationIds.every((id) => v.configurations.some((c) => c.configurationId === id && c.derivativeId === d.derivativeId)));
  return derivativeOk && v.configurations.every((c) => object(c) && text(c.configurationId) && text(c.version) && text(c.display?.name)
    && v.derivatives.some((d) => d.derivativeId === c.derivativeId && d.configurationIds.includes(c.configurationId))
    && object(c.facts) && Object.keys(c.facts).length > 0 && Object.values(c.facts).every(compactFact));
}

// Reads the one canonical catalogue entry. Compact policy facts become full facts
// whose provenance names the policy key and is observed when the entry took effect.
export function createPolicyOrderPlanCatalog({ policy } = {}) {
  return Object.freeze({
    async readCatalog(context, read) {
      if (typeof policy?.getAssumption !== 'function' || !text(context?.runId) || read?.runId !== context.runId
        || !text(read.policyVersion) || !instant(read.asOf)) return fail('unavailable', 'planning-catalog-not-configured');
      let row;
      try { row = await policy.getAssumption(CATALOG_KEY, read); } catch { return fail('unavailable', 'planning-catalog-unavailable'); }
      if (row?.status !== 'ok' || row.value?.key !== CATALOG_KEY) return fail('unavailable', 'planning-catalog-unavailable');
      if (row.policyVersion !== read.policyVersion || row.value.policyVersion !== read.policyVersion) return fail('unavailable', 'planning-catalog-policy-mismatch');
      if (!valid(row.value) || Date.parse(row.value.effectiveFrom) > Date.parse(read.asOf)) return fail('invalid', 'planning-catalog-invalid');
      const entry = structuredClone(row.value); const catalog = entry.value;
      const version = `${read.policyVersion}:${catalog.version}`;
      const provenance = (configuration, f) => ({ sourceRef: `policy:${CATALOG_KEY}`, version: configuration.version,
        observedAt: entry.effectiveFrom, assurance: f.value === null ? 'unknown' : catalog.assurance });
      return { status: 'ok', contractVersion: CONTRACT_VERSION, value: { runId: context.runId, asOf: read.asOf, policyVersion: read.policyVersion,
        version, currency: catalog.currency,
        derivatives: catalog.derivatives.map((d) => ({ derivativeId: d.derivativeId, modelId: d.modelId, unitCostMinor: d.unitCostMinor,
          production: d.production, configurationIds: d.configurationIds })),
        configurations: catalog.configurations.map((c) => ({ configurationId: c.configurationId, derivativeId: c.derivativeId, version: c.version,
          display: c.display, facts: Object.fromEntries(Object.entries(c.facts).map(([key, f]) => [key, { status: f.value === null ? 'unknown' : 'known',
            value: f.value, unit: f.unit, provenance: provenance(c, f) }])) })) } };
    },
  });
}
