import { inputDigest } from '../../repository/core.js';
import { CONTRACT_VERSION, text, instant, compare } from './input.js';
import { renewalInstant } from './renewal.js';

const tables = ['employees', 'briefs', 'entitlement_slots', 'holds', 'stock', 'decisions', 'offers'];
const unavailable = (code) => ({ status: 'unavailable', code, contractVersion: CONTRACT_VERSION });
const currentBriefs = (rows) => [...rows.reduce((byEmployee, b) => {
  if (b.status === 'confirmed' && (!byEmployee.has(b.employeeId) || byEmployee.get(b.employeeId).briefVersion < b.briefVersion)) byEmployee.set(b.employeeId, b);
  return byEmployee;
}, new Map()).values()].sort((a, b) => compare(a.employeeId, b.employeeId));

// This internal extension uses the same authoritative saved briefs as F99, while
// preserving the joint choices its privacy-banded PUBLIC marginal DTO omits.
// futureChoices must evaluate real future configurations and shared gates. There
// is no fallback to synthetic exact stock or current availability evaluation.
export function createExpressedOrderForecastProvider({ repository, identity, clock, catalog, futureChoices } = {}) {
  return Object.freeze({
    async readForecast(context, read) {
      if (!repository || !identity || !clock || typeof catalog?.readCatalog !== 'function'
        || typeof futureChoices?.evaluateChoices !== 'function') return unavailable('planning-future-choice-evaluator-not-configured');
      const allowed = await identity.requireRole(context, 'greg'); if (allowed.status !== 'ok') return allowed;
      try {
        if (read?.runId !== context.runId || read.policyVersion !== context.policyVersion || !instant(read.asOf) || !instant(read.horizonEnd)) return unavailable('planning-forecast-read-invalid');
        const time = await clock.now(context); if (time.status !== 'ok') return time;
        if (time.value.runId !== context.runId || time.value.now !== read.asOf) return unavailable('planning-forecast-clock-mismatch');
        const load = async () => {
          const values = await Promise.all(tables.map((name) => repository.query(context, name)));
          const error = values.find((v) => v.status !== 'ok');
          return error ? { error } : Object.fromEntries(tables.map((name, i) => [name, values[i].value]));
        };
        const rows = await load(); if (rows.error) return rows.error;
        const choices = await catalog.readCatalog(context, read); if (choices.status !== 'ok') return choices;
        if (choices.value.runId !== context.runId || choices.value.policyVersion !== context.policyVersion || choices.value.asOf !== read.asOf
          || !text(choices.value.version) || !Array.isArray(choices.value.derivatives)) return unavailable('planning-forecast-catalog-mismatch');
        const derivativeIds = new Set(choices.value.derivatives.map((d) => d.derivativeId));
        const entitlements = []; const evaluations = []; const excluded = [];
        for (const brief of currentBriefs(rows.briefs)) {
          const employee = rows.employees.find((e) => e.employeeId === brief.employeeId);
          if (!employee || !employee.roles?.includes('employee') || !text(employee.renewalId) || !text(employee.entitlementSlotId)) return unavailable('planning-forecast-entitlement-missing');
          const slot = rows.entitlement_slots.find((s) => s.entitlementSlotId === employee.entitlementSlotId);
          if (!slot || slot.employeeId !== employee.employeeId || slot.renewalId !== employee.renewalId
            // F99's BriefService persists null when its server context has no
            // renewalId. The exact employee/slot pair above supplies that link;
            // an explicitly recorded renewal must still agree with it.
            || (brief.renewalId != null && brief.renewalId !== employee.renewalId)
            || (brief.entitlementSlotId !== undefined && brief.entitlementSlotId !== slot.entitlementSlotId)) return unavailable('planning-forecast-entitlement-mismatch');
          const renewalAt = renewalInstant(employee); if (!renewalAt) return unavailable('planning-renewal-unconfirmed');
          if (Date.parse(renewalAt) > Date.parse(read.horizonEnd)) { excluded.push({ employeeId: employee.employeeId, reason: 'outside-horizon' }); continue; }
          // Already selected exact stock satisfies the entitlement; it is not a
          // fresh order need. An active hold remains in the cohort and supply.
          const selected = rows.holds.some((h) => h.employeeId === employee.employeeId && h.entitlementSlotId === slot.entitlementSlotId
            && h.renewalId === employee.renewalId && h.state === 'allocated'
            && rows.stock.some((s) => s.orderUuid === h.orderUuid && (s.state === 'allocated' || s.allocated === true)));
          if (selected) { excluded.push({ employeeId: employee.employeeId, reason: 'already-selected' }); continue; }
          const evaluated = await futureChoices.evaluateChoices(context, { read: structuredClone(read), employee: structuredClone(employee),
            brief: structuredClone(brief), catalog: structuredClone(choices.value),
            history: { decisions: structuredClone(rows.decisions), offers: structuredClone(rows.offers), briefs: structuredClone(rows.briefs) } });
          if (evaluated?.status !== 'ok') return evaluated?.status ? evaluated : unavailable('planning-future-choice-evaluation-unavailable');
          const value = evaluated.value;
          if (value?.runId !== context.runId || value.policyVersion !== context.policyVersion || value.employeeId !== employee.employeeId
            || value.briefVersion !== brief.briefVersion || value.catalogVersion !== choices.value.version || !text(value.version)
            || !Array.isArray(value.acceptableDerivativeIds) || !value.acceptableDerivativeIds.every((id) => derivativeIds.has(id))
            || new Set(value.acceptableDerivativeIds).size !== value.acceptableDerivativeIds.length || !Array.isArray(value.gates)
            || value.excludedStockIds !== undefined && (!Array.isArray(value.excludedStockIds) || !value.excludedStockIds.every(text)
              || new Set(value.excludedStockIds).size !== value.excludedStockIds.length)
            || value.requiredBy !== undefined && (!instant(value.requiredBy) || Date.parse(value.requiredBy) > Date.parse(renewalAt))
            || !value.gates.every(text) || !Array.isArray(value.limitations) || !value.limitations.every(text)) return unavailable('planning-future-choice-evaluation-invalid');
          evaluations.push(value);
          entitlements.push({ entitlementId: slot.entitlementSlotId, employeeId: employee.employeeId,
            renewalId: employee.renewalId, entitlementSlotId: slot.entitlementSlotId, companyId: employee.companyId, schemeId: employee.schemeId,
            renewalAt, acceptableDerivativeIds: [...value.acceptableDerivativeIds].sort(compare), gates: [...value.gates].sort(compare) });
          if (value.excludedStockIds !== undefined) entitlements.at(-1).excludedStockIds = [...value.excludedStockIds].sort(compare);
          if (value.requiredBy !== undefined) entitlements.at(-1).requiredBy = value.requiredBy;
        }
        const after = await load(); if (after.error) return after.error;
        const end = await clock.now(context); if (end.status !== 'ok') return end;
        const catalogAfter = await catalog.readCatalog(context, read); if (catalogAfter.status !== 'ok') return catalogAfter;
        if (inputDigest(rows) !== inputDigest(after) || inputDigest(time.value) !== inputDigest(end.value)
          || inputDigest(choices.value) !== inputDigest(catalogAfter.value)) return { status: 'conflict', code: 'planning-forecast-changed', contractVersion: CONTRACT_VERSION };
        const final = await identity.requireRole(context, 'greg'); if (final.status !== 'ok') return final;
        const cohortVersion = inputDigest({ employees: rows.employees, slots: rows.entitlement_slots, selected: excluded });
        return { status: 'ok', contractVersion: CONTRACT_VERSION, value: { runId: context.runId, asOf: read.asOf, policyVersion: context.policyVersion,
          version: inputDigest({ rows, evaluations, catalog: choices.value.version, read }), cohortVersion,
          forecast: { basis: 'expressed-saved-demand', horizonEnd: read.horizonEnd, entitlements,
            limitations: [...new Set(['Saved confirmed briefs only; employees without a saved brief are not inferred.',
              'Deterministic permitted joint choices are not calibrated acceptance probabilities.', ...evaluations.flatMap((e) => e.limitations)])] },
          provenance: { source: 'F99-authoritative-saved-briefs-internal-extension', catalogVersion: choices.value.version,
            evaluationVersions: evaluations.map((v) => v.version), excluded } } };
      } catch { return unavailable('planning-expressed-forecast-unavailable'); }
    },
  });
}
