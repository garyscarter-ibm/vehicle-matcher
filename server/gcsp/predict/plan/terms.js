import { createEmployeeTerms } from '../../../vehicles/index.js';
import { CONTRACT_VERSION, text, instant } from './input.js';

const unavailable = (code) => ({ status: 'unavailable', code, contractVersion: CONTRACT_VERSION });
// Same assurance label as the synthetic points and allowance rows it quotes.
const ASSURANCE = 'synthetic-scenario';

// Future terms are the canonical monthly points and allowance for one employee and
// configuration, valid from the read to the planning horizon. Any non-ok read fails closed.
export function createPolicyFutureTermsProvider({ policy } = {}) {
  return Object.freeze({
    async readFutureTerms(context, request) {
      if (typeof policy?.getPointsCost !== 'function' || typeof policy.getAllowance !== 'function') return unavailable('planning-future-terms-not-configured');
      const { read, employee, brief, catalogVersion, configuration } = request ?? {};
      if (read?.runId !== context?.runId || !text(read.policyVersion) || !instant(read.asOf) || !instant(read.horizonEnd)
        || !employee || !brief || !text(catalogVersion) || !text(configuration?.configurationId) || !configuration.facts) return unavailable('planning-future-terms-input-invalid');
      try {
        const employeeContext = { ...context, ...Object.fromEntries(['employeeId', 'companyId', 'schemeId', 'gradeId', 'entitlementSlotId'].map((k) => [k, employee[k]])), roles: ['employee'] };
        const car = { ...Object.fromEntries(Object.entries(configuration.facts).filter(([, f]) => f.status === 'known').map(([k, f]) => [k, f.value])),
          configurationId: configuration.configurationId };
        const [points, allowance] = await Promise.all([policy.getPointsCost(employeeContext, car, read), policy.getAllowance(employeeContext, read)]);
        if (points.status !== 'ok' || allowance.status !== 'ok' || points.policyVersion !== read.policyVersion || allowance.policyVersion !== read.policyVersion) return unavailable('planning-future-terms-unavailable');
        const id = `${read.policyVersion}:${configuration.configurationId}`;
        return { status: 'ok', value: { runId: context.runId, asOf: read.asOf, policyVersion: read.policyVersion, employeeId: employee.employeeId,
          renewalId: employee.renewalId, briefVersion: brief.briefVersion, catalogVersion, configurationId: configuration.configurationId,
          version: `future-terms:${id}`,
          terms: createEmployeeTerms({ termsVersion: `future-terms:${id}`, points: { value: points.value.monthlyPoints, unit: 'points' },
            allowanceInputs: { allowance: { value: allowance.value.monthlyPoints, unit: 'points' } }, contribution: null,
            validFrom: read.asOf, validUntil: read.horizonEnd,
            provenance: { sourceRef: `policy:${points.value.pricePlanId}`, version: read.policyVersion, observedAt: read.asOf, assurance: ASSURANCE } }) } };
      } catch { return unavailable('planning-future-terms-unavailable'); }
    },
  });
}
