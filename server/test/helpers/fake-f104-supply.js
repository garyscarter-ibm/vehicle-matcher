// In-memory stand-in for FUCQ-104 (not merged on this base): its submit port and record shapes,
// a production reply driver and a readSupply port built on the real resolveSupplyRecords.
import { createPolicyOrderPlanCatalog, resolveSupplyRecords } from '../../gcsp/predict/plan/index.js';
import { inputDigest, ok, result } from '../../gcsp/repository/index.js';

const FIELDS = ['commandId', 'model', 'derivative', 'quantity', 'expectedPolicyVersion', 'expectedStockVersion', 'plan'];
const DAY = 86400000;

/** `f` is the planning fixture (policy, clock, employee). Rows are plain arrays so tests can inspect them. */
export function createFakeF104Supply(f, { leadTimeDays = 56 } = {}) {
  const rows = { future_order_requests: [], confirmed_supply: [], stock: [], holds: [], event_receipts: [] };
  const catalog = createPolicyOrderPlanCatalog({ policy: f.policy });
  const idempotent = new Map(); let tranche = 0; let supplies = 0;
  const now = async (context) => (await f.clock.now(context)).value.now;
  const stamp = (context, row) => ({ runId: context.runId, ...row });
  const find = (requestId) => rows.future_order_requests.find((r) => r.requestId === requestId);

  return {
    rows,
    get requestCount() { return rows.future_order_requests.length; },

    async submit(context, input) {
      const keys = Object.keys(input ?? {});
      if (!keys.every((k) => FIELDS.includes(k)) || FIELDS.slice(0, 6).some((k) => input[k] === undefined)) return result('invalid', { code: 'invalid-supply-command' });
      const digest = inputDigest(input); const prior = idempotent.get(input.commandId);
      if (prior) return prior.digest === digest ? prior.outcome : result('conflict', { reason: 'idempotency-input-changed', current: {} });
      const requestId = `request-${inputDigest([context.runId, context.principalId, input.commandId]).slice(0, 32)}`;
      const row = stamp(context, { requestId, commandId: input.commandId, model: input.model, derivative: input.derivative, quantity: input.quantity,
        state: 'requested', requestedAt: await now(context), requestedBy: context.principalId, policyVersion: input.expectedPolicyVersion,
        stockVersion: input.expectedStockVersion, providerReference: `ref-${requestId}`, provenance: { mode: 'synthetic' },
        history: [], plan: structuredClone(input.plan) });
      rows.future_order_requests.push(row);
      const outcome = ok({ request: structuredClone(row) }); idempotent.set(input.commandId, { digest, outcome });
      return structuredClone(outcome);
    },

    async confirm(context, requestId, quantity) {
      const request = find(requestId); const at = await now(context);
      const done = rows.confirmed_supply.filter((s) => s.requestId === requestId).reduce((n, s) => n + s.quantity, 0);
      const supplyId = `supply-${++supplies}`;
      rows.confirmed_supply.push(stamp(context, { supplyId, requestId, commandId: `confirm-${supplies}`, quantity, state: 'confirmed',
        confirmedAt: at, expectedAt: new Date(Date.parse(at) + leadTimeDays * DAY).toISOString(), policyVersion: request.policyVersion,
        sourceVersion: 'production-v1', providerReference: `ack-${supplies}`, provenance: { mode: 'synthetic' } }));
      request.state = done + quantity >= request.quantity ? 'confirmed' : 'partly-confirmed';
      request.history.push({ state: 'confirmed', at, supplyId, quantity });
      return supplyId;
    },

    async delay(context, requestId, until, reason) {
      const request = find(requestId); request.state = 'delayed';
      request.history.push({ state: 'delayed', at: await now(context), until, reason });
    },

    /** Releases `n` units of a confirmed supply as visible stock plus the completed release receipt. */
    async release(context, supplyId, n = 1) {
      const supply = rows.confirmed_supply.find((s) => s.supplyId === supplyId); const request = find(supply.requestId);
      const read = { runId: context.runId, asOf: await now(context), policyVersion: context.policyVersion };
      const choices = (await catalog.readCatalog(context, read)).value;
      const derivative = choices.derivatives.find((d) => d.production.model === request.model && d.production.derivative === request.derivative);
      const trancheId = `tranche-${++tranche}`; const orderUuids = [];
      for (let i = 0; i < n; i += 1) {
        const orderUuid = `${trancheId}-unit-${i + 1}`; orderUuids.push(orderUuid);
        rows.stock.push(stamp(context, { orderUuid, configurationId: derivative.configurationIds[0], state: 'released', available: true,
          visibility: { companyIds: [f.employee.companyId], schemeIds: [f.employee.schemeId], employeeIds: null },
          release: { supplyId, trancheId, releasedAt: read.asOf, policyVersion: supply.policyVersion, sourceVersion: 'release-source-v1' } }));
      }
      rows.event_receipts.push(stamp(context, { consumerId: 'stock-release', eventId: trancheId, eventType: 'stock-released', state: 'completed',
        outcome: { status: 'ok', value: { runId: context.runId, kind: 'stock-released', supplyId, trancheId, orderUuids, releasedAt: read.asOf,
          source: { version: 'release-source-v1' }, policyVersion: supply.policyVersion } } }));
      return orderUuids;
    },

    async readSupply(context, read) {
      const choices = await catalog.readCatalog(context, read); if (choices.status !== 'ok') return choices;
      return resolveSupplyRecords({ runId: context.runId, asOf: read.asOf, catalogVersion: choices.value.version,
        catalog: choices.value.derivatives, rows: structuredClone(rows) });
    },
  };
}
