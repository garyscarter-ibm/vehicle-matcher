import { inputDigest } from '../../repository/core.js';
import { CONTRACT_VERSION, instant } from './input.js';
import { readPlanningPolicy } from './policy.js';
import { planOrder } from './solver.js';
import { createExpressedOrderForecastProvider } from './forecast.js';

const unavailable = (code) => ({ status: 'unavailable', code, contractVersion: CONTRACT_VERSION });

// Forecast and catalog are trusted in-process ports. There is deliberately no
// fallback from F99's privacy-banded public marginal projection.
export function createOrderPlanService({ policy, identity, clock, forecast, supply, catalog, repository, futureChoices } = {}) {
  const demandProvider = forecast ?? createExpressedOrderForecastProvider({ repository, identity, clock, catalog, futureChoices });
  return Object.freeze({
    async readPlan(context, request = {}) {
      if (!identity || !clock || !policy || typeof demandProvider?.readForecast !== 'function'
        || typeof supply?.readSupply !== 'function' || typeof catalog?.readCatalog !== 'function') return unavailable('planning-producers-not-configured');
      const allowed = await identity.requireRole(context, 'greg'); if (allowed.status !== 'ok') return allowed;
      if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some((k) => k !== 'currentDraft')) return { status: 'invalid', code: 'invalid-plan-request', contractVersion: CONTRACT_VERSION };
      try {
        const time = await clock.now(context); if (time.status !== 'ok') return time;
        if (time.value?.runId !== context.runId || !instant(time.value.now)) return unavailable('planning-clock-invalid');
        const read = { runId: context.runId, asOf: time.value.now, policyVersion: context.policyVersion };
        const rules = await readPlanningPolicy(policy, read); if (rules.status !== 'ok') return rules;
        const horizon = new Date(Date.parse(read.asOf) + rules.value.horizonDays * 86400000);
        if (!Number.isFinite(horizon.getTime())) return unavailable('planning-horizon-invalid');
        read.horizonEnd = horizon.toISOString();
        const load = () => Promise.all([demandProvider.readForecast(context, read), supply.readSupply(context, read), catalog.readCatalog(context, read)]);
        const first = await load(); const failure = first.find((r) => r?.status !== 'ok'); if (failure) return failure;
        const [demand, availability, choices] = first.map((r) => r.value);
        if (demand.runId !== context.runId || availability.runId !== context.runId || choices.runId !== context.runId
          || demand.asOf !== read.asOf || availability.asOf !== read.asOf || choices.asOf !== read.asOf
          || demand.policyVersion !== read.policyVersion || choices.policyVersion !== read.policyVersion
          || availability.versions.catalog !== choices.version || choices.currency !== rules.value.currency) return unavailable('planning-producer-version-mismatch');
        const { leadTimeDays, provenance, ...constraints } = rules.value;
        const stock = availability.stock.map((s) => {
          const entitled = demand.forecast.entitlements;
          if (!s.visibility || !Array.isArray(s.visibility.companyIds) || !Array.isArray(s.visibility.schemeIds)
            || !(s.visibility.employeeIds === null || Array.isArray(s.visibility.employeeIds))
            || entitled.some((e) => !e.companyId || !e.schemeId)) throw new TypeError('Exact stock visibility must be resolved from the trusted cohort.');
          return { stockId: s.stockId, derivativeId: s.derivativeId, availableAt: s.availableAt,
            heldForEntitlementId: s.heldForEntitlementSlotId === null ? null
              : entitled.find((e) => e.entitlementSlotId === s.heldForEntitlementSlotId)?.entitlementId ?? `outside-cohort:${s.heldForEntitlementSlotId}`,
            permittedEntitlementIds: entitled.filter((e) => s.visibility.companyIds.includes(e.companyId)
              && s.visibility.schemeIds.includes(e.schemeId) && (s.visibility.employeeIds === null || s.visibility.employeeIds.includes(e.employeeId))).map((e) => e.entitlementId) };
        });
        const resolved = { runId: context.runId, asOf: read.asOf, versions: { forecast: demand.version, cohort: demand.cohortVersion,
          policy: rules.policyVersion, stock: availability.versions.stock, supply: availability.versions.supply, catalog: choices.version, clock: time.value.clockVersion },
        forecast: demand.forecast, catalog: choices.derivatives.map((d) => ({ derivativeId: d.derivativeId, modelId: d.modelId,
          unitCostMinor: d.unitCostMinor, leadTimeDays })), constraints, stock, inbound: availability.inbound,
        ...(Object.hasOwn(request, 'currentDraft') ? { currentDraft: request.currentDraft } : {}) };
        const plan = planOrder(resolved);
        const second = await load(); const later = second.find((r) => r?.status !== 'ok'); if (later) return later;
        const end = await clock.now(context); if (end.status !== 'ok') return end;
        if (inputDigest(first) !== inputDigest(second) || inputDigest(time.value) !== inputDigest(end.value)) return { status: 'conflict', code: 'planning-inputs-changed', contractVersion: CONTRACT_VERSION };
        const final = await identity.requireRole(context, 'greg'); if (final.status !== 'ok') return final;
        return { ...plan, policyProvenance: provenance, supplyActivity: { requests: availability.requests ?? [], responses: availability.responses ?? [] } };
      } catch { return unavailable('planning-source-unavailable'); }
    },
  });
}
