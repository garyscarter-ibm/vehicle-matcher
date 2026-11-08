import { PolicyService } from '../../policy/index.js';
import { activateRunPolicy } from '../../policy/activation.js';
import { validInstant } from '../../policy/file-provider.js';
import { inputDigest, ok, result } from '../../repository/core.js';
import { createCanonicalOrderPlanService } from './compose.js';
import { createPolicyOrderPlanCatalog } from './catalog.js';
import { CONTRACT_VERSION, text, integer, compare } from './input.js';
import { readPlanningPolicy } from './policy.js';

const EDITABLE_KEY = 'orderPlan.gregEditableKeys';
const PREVIEW_MESSAGE = 'Preview only. Nothing is saved, published or ordered.';
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const only = (v, keys) => object(v) && Object.keys(v).every((k) => keys.includes(k));
const clean = (v) => JSON.parse(JSON.stringify(v));
const invalid = (code, field, reason, extra = {}) => result('invalid', { code, ...extra, reasons: [{ field, reason }] });
const unavailable = (code = 'order-plan-operations-unavailable') => result('unavailable', { code, retryable: true,
  reason: 'The order plan is unavailable. Try again.' });
const isPlan = (p) => text(p?.planId) && ['feasible', 'infeasible'].includes(p.status);
const latest = (rows, at) => rows.reduce((best, row, i) => (!best || Date.parse(at(row)) >= Date.parse(at(best.row)) ? { row, i } : best), null)?.row ?? null;
const BOUNDS = { 'orderPlan.modelBounds': 'modelId', 'orderPlan.derivativeBounds': 'derivativeId' };

// Greg's order-plan operations: preview, keep, publish, submit and replan. Each call is run-scoped
// through the trusted context and starts and ends with the Greg role check.
export function createOrderPlanOperations({ repository, policy, identity, clock, supply, requests } = {}) {
  const wired = () => repository && policy && identity && clock;
  const guard = (context) => (wired() ? identity.requireRole(context, 'greg') : unavailable('order-plan-operations-not-configured'));

  async function start(context) {
    if (!object(context) || !text(context.runId)) return invalid('invalid-context', 'context', 'A trusted run context is required.');
    const allowed = await guard(context); if (allowed.status !== 'ok') return allowed;
    const time = await clock.now(context); if (time.status !== 'ok') return time;
    if (time.value?.runId !== context.runId || !validInstant(time.value.now)) return unavailable();
    const read = { runId: context.runId, asOf: time.value.now, policyVersion: context.policyVersion };
    const rules = await readPlanningPolicy(policy, read); if (rules.status !== 'ok') return rules;
    const editable = await policy.getAssumption(EDITABLE_KEY, read);
    if (editable.status !== 'ok' || !Array.isArray(editable.value?.value) || !editable.value.value.every(text)) return unavailable('editable-keys-unavailable');
    return ok({ now: time.value.now, read, rules: rules.value, editable: editable.value.value });
  }
  const finish = async (context, value) => {
    const allowed = await guard(context); return allowed.status === 'ok' ? ok(value) : allowed;
  };

  // Validates Greg's edits against the policy-marked editable keys and the active id sets.
  function checkChanges(base, changes) {
    if (!Array.isArray(changes) || !changes.length || changes.length > base.editable.length
      || !changes.every((c) => only(c, ['key', 'value']) && text(c.key) && Object.hasOwn(c, 'value'))
      || new Set(changes.map((c) => c.key)).size !== changes.length) return invalid('invalid-changes', 'changes', 'Supply each editable key once with its new value.');
    const refused = changes.map((c) => c.key).filter((k) => !base.editable.includes(k));
    if (refused.length) return invalid('policy-key-not-editable', 'changes', `Greg cannot edit: ${refused.join(', ')}.`, { keys: refused });
    const out = [];
    for (const { key, value } of changes) {
      if (key === 'orderPlan.budgetMinor') {
        if (!integer(value)) return invalid('invalid-change-value', key, 'Use a nonnegative whole number of currency minor units.');
        out.push({ key, value }); continue;
      }
      const id = BOUNDS[key];
      const active = base.rules[key === 'orderPlan.modelBounds' ? 'modelBounds' : 'derivativeBounds'];
      if (!id) return invalid('policy-key-unsupported', key, 'This key has no editor yet.', { keys: [key] });
      if (!Array.isArray(value) || value.length !== active.length || !value.every((b) => only(b, [id, 'min', 'max']) && text(b[id])
        && integer(b.min) && integer(b.max) && b.min <= b.max)
        || new Set(value.map((b) => b[id])).size !== value.length || !active.every((a) => value.some((b) => b[id] === a[id]))) {
        return invalid('invalid-change-value', key, `Give every ${id} a whole-number minimum not above its maximum.`);
      }
      out.push({ key, value: value.map((b) => ({ [id]: b[id], min: b.min, max: b.max })).sort((a, b) => compare(a[id], b[id])) });
    }
    return ok(out.sort((a, b) => compare(a.key, b.key)));
  }

  // Active plan, or the plan under a disposable draft policy. Nothing is written.
  async function planFor(context, base, changes) {
    if (!changes) return createCanonicalOrderPlanService({ repository, policy, identity, clock, supply }).readPlan(context);
    const snapshot = await policy.getPolicySnapshot({ runId: context.runId, asOf: base.now, policyVersion: base.read.policyVersion });
    if (snapshot.status !== 'ok') return snapshot;
    const draft = structuredClone(snapshot.value);
    draft.policyVersion = `preview-${inputDigest({ activeVersion: base.read.policyVersion, changes }).slice(0, 24)}`;
    for (const table of ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions']) for (const row of draft[table]) row.policyVersion = draft.policyVersion;
    for (const { key, value } of changes) Object.assign(draft.assumptions.find((a) => a.key === key), { value, source: 'greg-order-plan-constraints',
      sourceDate: base.now.slice(0, 10), status: 'assumed', basis: 'Greg edited this synthetic order-plan constraint.' });
    const draftPolicy = new PolicyService({ provider: { async loadVersions() { return [draft]; } } });
    // Internal pins are server-created; guards re-check the original trusted context.
    const trusted = { requireRole: () => identity.requireRole(context, 'greg') };
    const fixedClock = { now: () => clock.now(context) };
    const active = base.read.policyVersion;
    const draftSupply = supply && { async readSupply(_internal, read) {
      const out = await supply.readSupply(context, { ...read, policyVersion: active });
      if (out.status !== 'ok') return out;
      const catalog = out.value.versions?.catalog;
      if (!text(catalog) || !catalog.startsWith(`${active}:`)) return unavailable('planning-supply-catalog-version-invalid');
      return { ...out, value: { ...out.value, versions: { ...out.value.versions, catalog: `${draft.policyVersion}:${catalog.slice(active.length + 1)}` } } };
    } };
    return createCanonicalOrderPlanService({ repository, policy: draftPolicy, identity: trusted, clock: fixedClock, supply: draftSupply })
      .readPlan({ ...context, policyVersion: draft.policyVersion });
  }

  async function snapshots(context, kind) {
    const rows = await repository.query(context, 'plan_snapshots'); if (rows.status !== 'ok') return rows;
    return ok(rows.value.filter((r) => r.provenance?.kind === kind));
  }

  async function replanFor(context, plan) {
    const found = await snapshots(context, 'submission'); if (found.status !== 'ok') return found;
    const submission = latest(found.value, (r) => r.provenance.submittedAt);
    if (!submission) return ok({ status: 'no-submission' });
    const lineIds = new Set(submission.output.lines.map((l) => l.commandId));
    const mine = plan.supplyActivity.requests.filter((r) => lineIds.has(r.commandId));
    const ids = new Set(mine.map((r) => r.requestId));
    const responses = plan.supplyActivity.responses.filter((r) => ids.has(r.requestId) && Date.parse(r.at) >= Date.parse(submission.provenance.submittedAt));
    const head = { submittedPlanId: submission.output.plan.planId, submittedAt: submission.provenance.submittedAt, currentPlanId: plan.planId,
      requests: mine, responses };
    return ok(responses.length ? { status: 'replanned', ...head, after: responses.at(-1) } : { status: 'unchanged-since-submission', ...head });
  }

  return Object.freeze({
    async readPlan(context, input = {}) {
      try {
        if (!only(input, [])) return invalid('invalid-request', 'input', 'Reading the plan takes no fields.');
        const base = await start(context); if (base.status !== 'ok') return base;
        const plan = await planFor(context, base.value); if (!isPlan(plan)) return plan;
        const replan = await replanFor(context, plan); if (replan.status !== 'ok') return replan;
        return finish(context, { mode: 'current', preview: false, plan, replan: replan.value });
      } catch { return unavailable(); }
    },

    async previewPlan(context, input) {
      try {
        if (!only(input, ['changes'])) return invalid('invalid-request', 'input', 'Supply changes only.');
        const base = await start(context); if (base.status !== 'ok') return base;
        const changes = checkChanges(base.value, input.changes); if (changes.status !== 'ok') return changes;
        const activePlan = await planFor(context, base.value); if (!isPlan(activePlan)) return activePlan;
        const plan = await planFor(context, base.value, changes.value); if (!isPlan(plan)) return plan;
        return finish(context, { mode: 'preview', preview: true, writes: 'none', message: PREVIEW_MESSAGE,
          activePolicyVersion: base.value.read.policyVersion, draftPolicyVersion: plan.versions.policy, changes: changes.value, plan, activePlan });
      } catch { return unavailable(); }
    },

    async saveConstraintDraft(context, input) {
      try {
        if (!only(input, ['commandId', 'changes']) || !text(input.commandId)) return invalid('invalid-request', 'input', 'Supply commandId and changes only.');
        const base = await start(context); if (base.status !== 'ok') return base;
        const changes = checkChanges(base.value, input.changes); if (changes.status !== 'ok') return changes;
        const basePolicyVersion = base.value.read.policyVersion;
        const planId = `constraint-draft-${inputDigest([context.runId, context.principalId, input.commandId]).slice(0, 32)}`;
        const digest = inputDigest({ commandId: input.commandId, changes: changes.value, basePolicyVersion });
        const saved = await repository.transaction(context, { commandId: `plan:draft:${context.principalId}:${input.commandId}`, inputDigest: digest },
          (tx) => tx.insert('plan_snapshots', { runId: context.runId, planId, forecastId: null, inputVersion: digest,
            constraintVersion: inputDigest(changes.value), policyVersion: basePolicyVersion, output: { changes: changes.value },
            provenance: { kind: 'constraint-draft', savedBy: context.principalId, savedAt: base.value.now, commandId: input.commandId, basePolicyVersion } }));
        if (saved.status !== 'ok') return saved;
        return finish(context, { draftId: saved.value.planId, changes: saved.value.output.changes, savedAt: saved.value.provenance.savedAt,
          basePolicyVersion, message: 'Draft saved. Nothing is published or ordered.' });
      } catch { return unavailable(); }
    },

    async readConstraintDraft(context) {
      try {
        const base = await start(context); if (base.status !== 'ok') return base;
        const found = await snapshots(context, 'constraint-draft'); if (found.status !== 'ok') return found;
        const draft = latest(found.value.filter((r) => r.provenance.savedBy === context.principalId), (r) => r.provenance.savedAt);
        return finish(context, { draft: draft && { draftId: draft.planId, changes: draft.output.changes, savedAt: draft.provenance.savedAt,
          basePolicyVersion: draft.provenance.basePolicyVersion } });
      } catch { return unavailable(); }
    },

    async publishConstraints(context, input) {
      try {
        if (!only(input, ['commandId', 'changes', 'expectedActiveVersion', 'effectiveFrom']) || !text(input.commandId)
          || !text(input.expectedActiveVersion) || (input.effectiveFrom !== undefined && !validInstant(input.effectiveFrom))) {
          return invalid('invalid-request', 'input', 'Supply commandId, changes, expectedActiveVersion and an optional ISO effectiveFrom.');
        }
        const base = await start(context); if (base.status !== 'ok') return base;
        const changes = checkChanges(base.value, input.changes); if (changes.status !== 'ok') return changes;
        const patches = changes.value.map(({ key, value }) => ({ table: 'assumptions', key, patch: { value, source: 'greg-order-plan-constraints',
          sourceDate: base.value.now.slice(0, 10), status: 'assumed', basis: 'Greg published this synthetic order-plan constraint for the demo.' } }));
        const published = await policy.publishPolicyVersion(context, { commandId: input.commandId, expectedActiveVersion: input.expectedActiveVersion,
          policyVersion: `greg-constraints-${inputDigest({ base: input.expectedActiveVersion, changes: changes.value }).slice(0, 16)}`,
          effectiveFrom: input.effectiveFrom ?? base.value.now, changes: patches });
        if (published.status !== 'ok') return published;
        const activated = await activateRunPolicy({ repository, policy }, context);
        return finish(context, { ...published.value, state: 'published', changes: changes.value,
          activation: activated.status === 'ok' ? { status: 'active', policyVersion: activated.value.policyVersion }
            : { status: 'pending', policyVersion: published.value.policyVersion, retryable: true, outcome: activated.status } });
      } catch { return unavailable(); }
    },

    async submitPlan(context, input) {
      try {
        if (!only(input, ['commandId', 'planId', 'versions', 'changes']) || !text(input.commandId) || !text(input.planId)
          || !object(input.versions) || !Object.values(input.versions).every(text)) return invalid('invalid-request', 'input', 'Supply commandId, planId, versions and optional changes.');
        const base = await start(context); if (base.status !== 'ok') return base;
        if (typeof requests?.submit !== 'function') return result('unavailable', { code: 'supply-requests-not-configured',
          reason: 'Requests to Production are not configured.', retryable: false });
        let changes;
        if (input.changes !== undefined) { changes = checkChanges(base.value, input.changes); if (changes.status !== 'ok') return changes; }
        const digest = inputDigest({ commandId: input.commandId, planId: input.planId, versions: input.versions, changes: changes?.value ?? null });
        const submissionId = `submission-${inputDigest([context.runId, context.principalId, input.commandId]).slice(0, 32)}`;
        const prior = await repository.read(context, { table: 'plan_snapshots', key: { runId: context.runId, planId: submissionId } });
        if (prior.status !== 'not-found') {
          if (prior.status !== 'ok') return prior;
          if (prior.value.inputVersion !== digest) return result('conflict', { code: 'idempotency-input-changed', reason: 'This command ID was used with different input.', current: {} });
          return send(context, prior.value, submissionId);
        }
        const current = await planFor(context, base.value, changes?.value); if (!isPlan(current)) return current;
        const changed = [...new Set([...Object.keys(input.versions), ...Object.keys(current.versions)])].sort(compare)
          .filter((k) => input.versions[k] !== current.versions[k]);
        if (input.planId !== current.planId) changed.push('plan');
        if (changed.length) return result('conflict', { code: 'replan-needed', reason: 'Inputs changed since the preview. Replan before submitting.',
          changedInputs: changed, current: { planId: current.planId, versions: current.versions } });
        const wanted = current.quantities.filter((q) => q.quantity > 0);
        if (current.status !== 'feasible' || !wanted.length) return invalid(current.status !== 'feasible' ? 'plan-not-feasible' : 'plan-has-no-order', 'planId',
          current.status !== 'feasible' ? 'This plan cannot be met inside the limits. Change the limits and replan.' : 'This plan orders no vehicles.');
        const catalog = await createPolicyOrderPlanCatalog({ policy }).readCatalog(context, { runId: context.runId, asOf: current.asOf, policyVersion: context.policyVersion });
        if (catalog.status !== 'ok') return catalog;
        const stock = await repository.query(context, 'stock'); if (stock.status !== 'ok') return stock;
        const stockVersion = inputDigest(stock.value);
        const lines = [];
        for (const q of wanted) {
          const production = catalog.value.derivatives.find((d) => d.derivativeId === q.derivativeId)?.production;
          if (!production) return unavailable('planning-catalog-mapping-missing');
          lines.push({ derivativeId: q.derivativeId, commandId: `${input.commandId}:${q.derivativeId}`, model: production.model, derivative: production.derivative, quantity: q.quantity,
            expectedPolicyVersion: context.policyVersion, expectedStockVersion: stockVersion,
            plan: { planId: current.planId, submissionId, versions: { plan: current.planId, forecast: current.versions.forecast, model: 'expressed-saved-demand',
              policy: current.versions.policy, basePolicy: context.policyVersion, cohort: current.versions.cohort, stock: current.versions.stock,
              supply: current.versions.supply, catalog: current.versions.catalog, clock: current.versions.clock } } });
        }
        // The intent is stored before any request leaves, so a retry resumes the same lines.
        const saved = await repository.transaction(context, { commandId: `plan:submit:${context.principalId}:${input.commandId}`, inputDigest: digest },
          (tx) => tx.insert('plan_snapshots', { runId: context.runId, planId: submissionId, forecastId: current.versions.forecast, inputVersion: digest,
            constraintVersion: inputDigest(changes?.value ?? []), policyVersion: current.versions.policy,
            output: clean({ plan: current, lines }),
            provenance: { kind: 'submission', submittedBy: context.principalId, submittedAt: base.value.now, commandId: input.commandId, basePolicyVersion: context.policyVersion } }));
        if (saved.status !== 'ok') return saved;
        return send(context, saved.value, submissionId);
      } catch { return unavailable(); }
    },
  });

  // The only request path: FUCQ-104's idempotent submission, one line per derivative.
  async function send(context, snapshot, submissionId) {
    const outcomes = [];
    for (const { derivativeId, ...line } of snapshot.output.lines) {
      const out = await requests.submit(context, structuredClone(line));
      if (out?.status !== 'ok') return result(out?.status ?? 'unavailable', { ...(out ?? {}), code: out?.code ?? 'submission-incomplete', submissionId,
        requests: outcomes, reason: 'Some requests were not accepted. Retry with the same command ID to continue without duplicates.', contractVersion: CONTRACT_VERSION });
      outcomes.push({ derivativeId, commandId: line.commandId, quantity: line.quantity, status: 'ok', request: out.value.request });
    }
    return finish(context, { submissionId, planId: snapshot.output.plan.planId, requests: outcomes,
      message: 'Requested. Production has not confirmed any of this yet.' });
  }
}
