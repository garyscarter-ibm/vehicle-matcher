import { PolicyService } from '../../policy/index.js';
import { activateRunPolicy } from '../../policy/activation.js';
import { validInstant } from '../../policy/file-provider.js';
import { inputDigest, ok, result, OCCUPYING_STATES } from '../../repository/index.js';
import { createGregDemandService } from '../index.js';
import { evaluateFit } from './fit.js';

const RECOMMENDATION = 'employee.recommendation.v1';
const TABLES = ['briefs', 'employees', 'stock', 'holds', 'offers', 'decisions', 'quotes'];
const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const only = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Reflect.ownKeys(value).every((key) => keys.includes(key));
const invalid = (code, field, reason) => result('invalid', { code, accepted: false, reasons: [{ field, reason }] });
const unavailable = () => result('unavailable', { code: 'publish-source-unavailable', retryable: true,
  reason: 'The policy controls are unavailable.' });
const effective = (row, now) => Date.parse(row.effectiveFrom) <= Date.parse(now)
  && (row.effectiveTo === undefined || Date.parse(now) < Date.parse(row.effectiveTo));
const provenance = (row) => Object.fromEntries(['source', 'sourceDate', 'basis', 'status', 'unit'].map((key) => [key, row[key]]));
const fields = (seed, now) => {
  const calibration = seed.assumptions.find((row) => row.key === RECOMMENDATION && effective(row, now));
  if (!calibration) throw Error('Missing recommendation policy');
  const keys = Object.keys(calibration.value.preferences);
  const adoptionRequired = calibration.value.preferenceWeights === undefined;
  const weights = adoptionRequired ? Object.fromEntries(keys.map((key) => [key, 1])) : calibration.value.preferenceWeights;
  if (!only(weights, keys) || Object.keys(weights).length !== keys.length
    || keys.some((key) => !Number.isSafeInteger(weights[key]) || weights[key] < 0)) throw Error('Invalid weights');
  return [...seed.pricePlans.filter((row) => effective(row, now)).map((row) => ({ id: `price:${row.key}`,
    kind: 'price', key: row.key, value: row.monthlyPoints, ...provenance(row), schemeId: row.schemeId,
    ...(row.configurationId ? { configurationId: row.configurationId } : { matchField: row.matchField, matchValue: row.matchValue }), step: 1, minimum: 0 })),
  ...keys.map((key) => ({ id: `weight:${key}`, kind: 'weight', key, value: weights[key],
    ...provenance(calibration), unit: 'relative-weight', step: 1, minimum: 0, adoptionRequired }))];
};
function changesFor(seed, now, input, publishing) {
  if (!only(input, publishing ? ['expectedActiveVersion', 'changes', 'commandId', 'policyVersion', 'effectiveFrom']
    : ['expectedActiveVersion', 'changes']) || !text(input.expectedActiveVersion)
    || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 100
    || publishing && (!text(input.commandId) || !text(input.policyVersion)
      || !validInstant(input.effectiveFrom) || Date.parse(input.effectiveFrom) > Date.parse(now))) {
    return { error: invalid('invalid-change-set', 'changeSet', 'Supply the active version and 1 to 100 editable changes; new publication takes effect at the current demo time; retries retain that instant.') };
  }
  const editTime = publishing ? input.effectiveFrom : now;
  const editable = fields(seed, editTime); const seen = new Set(); const patches = new Map(); const differences = [];
  for (const change of input.changes) {
    const field = editable.find((entry) => entry.id === change?.id);
    if (!only(change, ['id', 'value']) || !field || seen.has(change.id)
      || !Number.isSafeInteger(change.value) || change.value < 0) return { error: invalid('invalid-editable-field', 'changes',
      'Use each published price or recommendation weight once, with a nonnegative safe integer.') };
    seen.add(change.id);
    if (change.value === field.value) continue;
    differences.push({ id: field.id, before: field.value, after: change.value, unit: field.unit });
    if (field.kind === 'price') patches.set(field.key, { table: 'pricePlans', key: field.key,
      patch: { monthlyPoints: change.value, value: change.value } });
    else {
      if (!patches.has(RECOMMENDATION)) patches.set(RECOMMENDATION, { table: 'assumptions', key: RECOMMENDATION,
        patch: { value: structuredClone(seed.assumptions.find((row) => row.key === RECOMMENDATION).value) } });
      const next = patches.get(RECOMMENDATION).patch.value;
      next.preferenceWeights ??= Object.fromEntries(Object.keys(next.preferences).map((key) => [key, 1]));
      next.preferenceWeights[field.key] = change.value;
    }
  }
  if (!differences.length) return { error: invalid('no-policy-change', 'changes', 'Change at least one published value.') };
  for (const change of patches.values()) {
    Object.assign(change.patch, { source: 'greg-policy-publish', sourceDate: new Date(editTime).toISOString().slice(0, 10), status: 'assumed',
      basis: 'Greg adjusted this synthetic points or preference-weight assumption for the demo.' });
  }
  return { changes: [...patches.values()], differences };
}
const heldSummary = (rows, now, version) => {
  const pending = ['decision-pending', 'selection-pending', 'release-pending'];
  const unexpired = (row) => row.expiresAt === undefined || validInstant(row.expiresAt) && Date.parse(row.expiresAt) > Date.parse(now);
  const active = rows.offers.filter((offer) => {
    if (!['active', ...pending].includes(offer.state) || offer.policyVersion === version) return false;
    const hold = rows.holds.find((row) => row.holdId === offer.holdId && row.quoteId === offer.quoteId
      && row.policyVersion === offer.policyVersion && row.orderUuid === offer.orderUuid && row.employeeId === offer.employeeId
      && OCCUPYING_STATES.includes(row.state));
    const quote = rows.quotes.find((row) => row.quoteId === offer.quoteId && row.policyVersion === offer.policyVersion
      && row.orderUuid === offer.orderUuid && row.employeeId === offer.employeeId);
    if (!hold || !quote) return false;
    return pending.includes(offer.state) || hold.state !== 'active' || unexpired(offer) && unexpired(hold);
  });
  return { count: active.length, unit: 'offers', message: `${active.length} held offers keep their earlier terms.` };
};

export function createGregPublishService({ repository, policy, clock, identity } = {}) {
  async function load(context) {
    if (!repository || !policy || !clock || !identity) return { error: unavailable() };
    const allowed = await identity.requireRole(context, 'greg'); if (allowed.status !== 'ok') return { error: allowed };
    const time = await clock.now(context); if (time.status !== 'ok') return { error: time };
    if (time.value?.runId !== context.runId || !validInstant(time.value.now)) return { error: unavailable() };
    const snapshot = await policy.getPolicySnapshot({ runId: context.runId, asOf: time.value.now });
    if (snapshot.status !== 'ok') return { error: snapshot };
    return { seed: snapshot.value, time };
  }
  async function rowsFor(context) {
    const responses = await Promise.all(TABLES.map((table) => repository.query(context, table)));
    const error = responses.find((response) => response.status !== 'ok');
    return error ? { error } : Object.fromEntries(TABLES.map((table, i) => [table, responses[i].value]));
  }
  async function stable(context, time, rows) {
    const after = await rowsFor(context); if (after.error) return after.error;
    const end = await clock.now(context); if (end.status !== 'ok') return end;
    const active = await policy.getActiveVersion({ runId: context.runId, asOf: time.value.now });
    if (inputDigest(rows) !== inputDigest(after) || time.value.clockVersion !== end.value.clockVersion) return result('conflict', {
      code: 'preview-inputs-changed', reason: 'Inputs changed. Refresh the policy controls.' });
    return active;
  }
  return {
    async readPolicy(context) {
      try {
        const loaded = await load(context); if (loaded.error) return loaded.error;
        const { seed, time } = loaded; const rows = await rowsFor(context); if (rows.error) return rows.error;
        const final = await stable(context, time, rows); if (final.status !== 'ok') return final;
        if (final.policyVersion !== seed.policyVersion) return result('stale-version', { action: 'refresh' });
        const allowed = await identity.requireRole(context, 'greg'); if (allowed.status !== 'ok') return allowed;
        return ok({ state: 'draft', activeVersion: seed.policyVersion, effectiveFrom: seed.effectiveFrom,
          asOf: time.value.now, clockVersion: time.value.clockVersion, fields: fields(seed, time.value.now),
          weightsAdoptionRequired: seed.assumptions.find((row) => row.key === RECOMMENDATION).value.preferenceWeights === undefined,
          heldOffers: heldSummary(rows, time.value.now, null), historyMessage: 'Published versions preserve existing quotes and offers.' });
      } catch { return unavailable(); }
    },
    async preview(context, input) {
      try {
        const loaded = await load(context); if (loaded.error) return loaded.error;
        const { seed, time } = loaded;
        const prepared = changesFor(seed, time.value.now, input, false); if (prepared.error) return prepared.error;
        if (input.expectedActiveVersion !== seed.policyVersion) return result('stale-version', {
          currentVersion: seed.policyVersion, expectedVersion: input.expectedActiveVersion, action: 'refresh' });
        const rows = await rowsFor(context); if (rows.error) return rows.error;
        const draft = structuredClone(seed);
        draft.policyVersion = `preview-${inputDigest({ activeVersion: seed.policyVersion, changes: prepared.differences }).slice(0, 24)}`;
        for (const table of ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions']) {
          for (const row of draft[table]) row.policyVersion = draft.policyVersion;
        }
        for (const change of prepared.changes) Object.assign(draft[change.table].find((row) => row.key === change.key), change.patch);
        const draftPolicy = new PolicyService({ provider: { async loadVersions() { return [draft]; } } });
        // Internal pins are server-created; every guard revalidates the original trusted context.
        const trusted = { async requireRole() { return identity.requireRole(context, 'greg'); } };
        const fixedClock = { async now() { return clock.now(context); } };
        const evaluate = async (selectedPolicy, policyVersion) => {
          const internal = { ...context, policyVersion };
          const demand = await createGregDemandService({ repository, policy: selectedPolicy, clock: fixedClock, identity: trusted }).readDemand(internal);
          if (demand.status !== 'ok') return demand;
          const fit = await evaluateFit({ rows, context: internal, policy: selectedPolicy, time,
            threshold: demand.value.privacy.threshold });
          return fit.status === 'ok' ? ok({ demand: demand.value, fit: fit.value }) : fit;
        };
        const active = await evaluate(policy, seed.policyVersion); if (active.status !== 'ok') return active;
        const proposed = await evaluate(draftPolicy, draft.policyVersion); if (proposed.status !== 'ok') return proposed;
        const final = await stable(context, time, rows); if (final.status !== 'ok') return final;
        if (final.policyVersion !== seed.policyVersion) return result('stale-version', { action: 'refresh' });
        const allowed = await identity.requireRole(context, 'greg'); if (allowed.status !== 'ok') return allowed;
        return ok({ state: 'preview-ready', preview: true, activeVersion: seed.policyVersion, draftVersion: draft.policyVersion, asOf: time.value.now,
          clockVersion: time.value.clockVersion, differences: prepared.differences, active: active.value, draft: proposed.value,
          heldOffers: heldSummary(rows, time.value.now, null) });
      } catch { return unavailable(); }
    },
    async publish(context, input) {
      try {
        const loaded = await load(context); if (loaded.error) return loaded.error;
        const { time } = loaded;
        const base = text(input?.expectedActiveVersion) ? await policy.getPolicySnapshot({ runId: context.runId,
          asOf: time.value.now, policyVersion: input.expectedActiveVersion }) : null;
        if (base?.status !== 'ok') return invalid('invalid-active-version', 'expectedActiveVersion', 'Supply a retained active version.');
        const prepared = changesFor(base.value, time.value.now, input, true); if (prepared.error) return prepared.error;
        const published = await policy.publishPolicyVersion(context, { ...input, effectiveFrom: input.effectiveFrom,
          changes: prepared.changes });
        if (published.status !== 'ok') return published;
        const activated = await activateRunPolicy({ repository, policy }, context);
        let rows;
        try { rows = await rowsFor(context); } catch { rows = { error: unavailable() }; }
        return ok({ ...published.value, state: 'published', activationRequired: activated.status !== 'ok',
          activation: activated.status === 'ok' ? { status: 'active', policyVersion: activated.value.policyVersion,
            asOf: activated.value.asOf, publishedVersionActive: activated.value.policyVersion === published.value.policyVersion }
            : { status: 'pending', policyVersion: published.value.policyVersion, retryable: true,
              reason: 'Publication was saved. Retry to activate the run.', outcome: activated.status },
          heldOffers: rows.error ? { count: null, unit: 'offers', message: 'Refresh to see active offers keeping their earlier terms.' }
            : heldSummary(rows, time.value.now, published.value.policyVersion) });
      } catch { return unavailable(); }
    },
  };
}
