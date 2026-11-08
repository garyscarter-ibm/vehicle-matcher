import { inputDigest, ok, result } from '../repository/index.js';

const text = (value) => typeof value === 'string' && value.trim().length > 0;
export const ORDERING_TERMS_KEY = 'ordering.terms.v1';
export const ORDERING_STAGES_KEY = 'ordering.approvalStages.v1';
export const ORDER_REFERENCE_KEY = 'ordering.reference.v1';
export const unavailable = (reason = 'ordering-authority-unavailable') => result('unavailable', {
  reason, retryable: true, view: { state: 'unavailable', action: 'retry' },
});

// There is no active wording or approval policy in this module. Both are dated PolicyService reads.
export class SchemeOrderTerms {
  constructor({ policy } = {}) { this.policy = policy; }
  async read(context, { asOf } = {}) {
    try {
      const read = { runId: context.runId, policyVersion: context.policyVersion, asOf };
      const [terms, stages] = await Promise.all([this.policy.getAssumption(ORDERING_TERMS_KEY, read),
        this.policy.getAssumption(ORDERING_STAGES_KEY, read)]);
      if ([terms, stages].some((row) => row.status !== 'ok' || row.policyVersion !== context.policyVersion)) return unavailable('ordering-policy-unavailable');
      const t = terms.value.value; const s = stages.value.value;
      if (t?.schemaVersion !== 1 || !text(t.termsVersion) || !text(t.wording) || t.fictional !== true
        || !Number.isFinite(Date.parse(t.validUntil)) || Date.parse(t.validUntil) <= Date.parse(asOf)
        || !Array.isArray(t.declarations) || !t.declarations.length
        || t.declarations.some((d) => !text(d.id) || !text(d.label) || !['all', 'replacement', 'new'].includes(d.appliesTo))
        || new Set(t.declarations.map((d) => d.id)).size !== t.declarations.length
        || !Array.isArray(s) || ![['sales-manager approval', 'sent to ordering'], ['HR approval', 'sales-manager approval', 'sent to ordering']]
          .some((allowed) => JSON.stringify(allowed) === JSON.stringify(s))) return unavailable('ordering-policy-invalid');
      const value = { ...structuredClone(t), policyVersion: context.policyVersion, approvalStages: structuredClone(s),
        provenance: { terms: terms.value, stages: stages.value } };
      return ok({ ...value, termsDigest: inputDigest(value) });
    } catch { return unavailable(); }
  }
}

// The order reference format is a dated PolicyService read. A missing or invalid entry fails closed.
export async function readOrderReferenceFormat(policy, context, { asOf } = {}) {
  try {
    const row = await policy.getAssumption(ORDER_REFERENCE_KEY, { runId: context.runId, policyVersion: context.policyVersion, asOf });
    const f = row.value?.value;
    if (row.status !== 'ok' || row.policyVersion !== context.policyVersion || f?.schemaVersion !== 1
      || typeof f.prefix !== 'string' || !/^[A-Za-z0-9-]{0,11}[A-Za-z-]$/.test(f.prefix)
      || !Number.isSafeInteger(f.digits) || f.digits < 1 || f.digits > 12 || !Number.isSafeInteger(f.first) || f.first < 1) return unavailable('order-reference-policy-invalid');
    return ok({ prefix: f.prefix, digits: f.digits, first: f.first });
  } catch { return unavailable('order-reference-policy-unavailable'); }
}
