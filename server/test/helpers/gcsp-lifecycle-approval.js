import { inputDigest } from '../../gcsp/repository/index.js';

// Injected FUCQ-71-shaped rows (ed20ca2 manual-order/index.js:127-131, :218-221). They prove consumer mechanics only;
// a real producer integration needs FUCQ-71's own service writing these rows.
const HR = ['HR approval', 'sales-manager approval', 'sent to ordering'];
let counter = 0;
function operation(context, { sourceType = 'cart', stages = HR, state, renewalId } = {}) {
  counter += 1;
  const orderUuid = `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
  const operationId = `selection:${inputDigest([context.runId, context.employeeId, counter])}`;
  const selection = { schemaVersion: 1, receivedAt: '2026-11-05T09:00:00.000Z', source: { type: sourceType, holdId: `hold-${counter}` },
    quote: { quoteId: `quote-${counter}` }, stock: { orderUuid, orderNumber: String(1000000 + counter), configurationId: `config-${counter}` },
    terms: { termsVersion: 'fictional-order-terms-v1', termsDigest: 'f'.repeat(64), policyVersion: context.policyVersion, approvalStages: stages } };
  const confirmed = { status: 'confirmed', operationId, runId: context.runId, orderUuid, configurationId: selection.stock.configurationId,
    orderNumber: selection.stock.orderNumber, orderStatus: stages[0], fictional: true };
  return { renewalId, row: { runId: context.runId, operationId, operationType: 'selection-order', idempotencyKey: operationId, inputDigest: inputDigest(selection),
    state, lastKnownState: state === 'completed' ? 'acknowledged' : 'allocation-pending', attempts: state === 'completed' ? 1 : 0,
    payload: { context: { ...context }, orderUuid, selection }, ...(state === 'completed' ? { outcome: confirmed } : {}) } };
}
async function write(repository, context, options) {
  const { row, renewalId } = operation(context, options);
  const stored = await repository.transaction(context, { commandId: `fixture:${row.operationId}`, inputDigest: row.inputDigest }, async (tx) => {
    const inserted = await tx.insert('pending_operations', row); if (inserted.status !== 'ok' || !renewalId) return inserted;
    const ref = { table: 'employees', key: { runId: context.runId, employeeId: context.employeeId } };
    const employee = await tx.get(ref); if (employee.status !== 'ok') return employee;
    return tx.compareAndSwap(ref, employee.value.version, { renewalId });
  });
  if (stored.status !== 'ok') throw new Error(JSON.stringify(stored));
  return { orderUuid: row.payload.orderUuid, operationId: row.operationId };
}
export const acknowledgedSelection = (repository, context, options = {}) => write(repository, context, { ...options, state: 'completed' });
export const pendingSelection = (repository, context, options = {}) => write(repository, context, { ...options, state: 'pending' });

// Real producer: FUCQ-71's ManualOrderService and synthetic-ordering:v1 adapter write the selection-order row.
// Stock, quote and hold are seeded as in gcsp-manual-order.test.js; the source converter is test-supplied there too.
import { ok } from '../../gcsp/repository/index.js';
import { ManualOrderService } from '../../gcsp/manual-order/index.js';
import { createSyntheticOrderingAdapter } from '../../gcsp/adapters/synthetic-ordering.js';
import { stock, fact } from './employee-recommendation.js';
const cmd = (commandId, value = {}) => ({ commandId, inputDigest: inputDigest(value) });
// One ManualOrderService per run, registered on the clock before any tick, with per-car converters.
export async function createRealProducer({ repository, policy, clock, identity }) {
  const converters = {}; const cars = {};
  const converter = (type) => ({ async prepare(context, source) { return ok(cars[source.holdId].prepared); },
    async allocate(c, input) {
      const car = Object.values(cars).find((x) => x.operationHold === input.holdId) ?? cars[input.holdId];
      return repository.transaction(c, cmd(`real-allocate:${input.commandId}`), async (tx) => {
        for (const [table, key] of [['holds', { holdId: car.hold }], ['claims', { claimId: car.claim }], ['stock', { orderUuid: car.orderUuid }],
          ['entitlement_slots', { entitlementSlotId: c.entitlementSlotId }]]) {
          const ref = { table, key: { runId: c.runId, ...key } };
          const current = await tx.get(ref);
          const changed = await tx.compareAndSwap(ref, current.value.version, { state: 'allocated', ...(table === 'stock' ? { available: false, allocated: true } : {}) });
          if (changed.status !== 'ok') return changed;
        }
        return ok({ state: 'allocated' });
      });
    } });
  for (const type of ['cart', 'buddy-offer']) converters[type] = converter(type);
  const service = new ManualOrderService({ repository, identity, clock, policy, converters, adapter: createSyntheticOrderingAdapter({ repository }) });
  const registered = await service.registerClockHandler(); if (registered.status !== 'ok') throw new Error(JSON.stringify(registered));
  async function submit(context, { id, type = 'cart' }) {
    const car = stock(id, { insuranceGroup: fact(25, 'insurance-group') });
    const hold = `hold-${id}`; const quote = `quote-${id}`; const claim = `claim-${id}`; const now = (await clock.now(context)).value.now;
    cars[hold] = { hold, claim, orderUuid: car.orderUuid, prepared: { draft: { draftVersion: 1, choices: { mode: 'new',
      contact: { email: 'chooser@example.invalid' }, driverId: 'fictional-driver' } }, employee: { fictional: true }, driver: { fictional: true } } };
    const seeded = await repository.transaction(context, cmd(`real-seed-${id}`), async (tx) => {
      const inserted = await tx.insert('stock', { runId: context.runId, orderUuid: car.orderUuid, orderNumber: String(id).padStart(7, '0'),
        configurationId: car.configurationId, facts: car.snapshot, state: 'available', available: true });
      if (inserted.status !== 'ok') return inserted;
      const q = await tx.insert('quotes', { runId: context.runId, quoteId: quote, orderUuid: car.orderUuid, employeeId: context.employeeId,
        entitlementSlotId: context.entitlementSlotId, configurationId: car.configurationId, facts: car.snapshot, terms: { fictional: true },
        draftVersion: 1, policyVersion: context.policyVersion, quotedAt: now, validUntil: '2026-12-01T00:00:00.000Z' });
      if (q.status !== 'ok') return q;
      const slot = await tx.get({ table: 'entitlement_slots', key: { runId: context.runId, entitlementSlotId: context.entitlementSlotId } });
      return tx.conditionalClaim({ orderUuid: car.orderUuid, holdId: hold, claimId: claim, type, employeeId: context.employeeId,
        entitlementSlotId: context.entitlementSlotId, phase: 'order-review', quoteId: quote, state: 'active',
        expiresAt: new Date(Date.parse(now) + 600000).toISOString(), policyVersion: context.policyVersion,
        expectedStockVersion: 1, expectedSlotVersion: slot.value.version });
    });
    if (seeded.status !== 'ok') throw new Error(JSON.stringify(seeded));
    const terms = await service.readTerms(context); if (terms.status !== 'ok') return terms;
    const submitted = await service.submit(context, { commandId: `submit-${id}`, source: { type, holdId: hold, expectedHoldVersion: 1, expectedDraftVersion: 1 },
      expectedQuoteId: quote, expectedStockVersion: 2, termsDigest: terms.value.termsDigest, declarations: { terms: true, driver: true } });
    return { submitted, orderUuid: car.orderUuid };
  }
  return { service, submit };
}
