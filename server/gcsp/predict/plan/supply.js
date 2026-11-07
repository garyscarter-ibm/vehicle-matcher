import { inputDigest, OCCUPYING_STATES } from '../../repository/core.js';
import { CONTRACT_VERSION, text, integer, instant, compare } from './input.js';

const unavailable = (code) => ({ status: 'unavailable', code, contractVersion: CONTRACT_VERSION });
const names = ['stock', 'holds', 'future_order_requests', 'confirmed_supply', 'event_receipts'];
const same = (a, b) => inputDigest(a) === inputDigest(b);

// F104 records pin: 6f57a05c538fa34361ba8594f152440ece851ed4.
// This does not apportion request-wide readTracking release totals between acks.
export function resolveSupplyRecords({ runId, asOf, catalogVersion, catalog, rows }) {
  try {
    if (!text(runId) || !instant(asOf) || !text(catalogVersion) || !Array.isArray(catalog) || !catalog.length
      || names.some((name) => !Array.isArray(rows?.[name]) || rows[name].some((r) => r.runId !== runId))) return unavailable('planning-supply-input-invalid');
    const configurationMap = new Map(); const productionMap = new Map();
    for (const d of catalog) {
      if (!text(d.derivativeId) || !text(d.modelId) || !Array.isArray(d.configurationIds)
        || !d.configurationIds.every(text) || !text(d.production?.model) || !text(d.production?.derivative)) return unavailable('planning-catalog-mapping-missing');
      const key = inputDigest([d.production.model, d.production.derivative]);
      if (productionMap.has(key)) return unavailable('planning-catalog-mapping-ambiguous');
      productionMap.set(key, d);
      for (const configuration of d.configurationIds) {
        if (configurationMap.has(configuration)) return unavailable('planning-catalog-mapping-ambiguous');
        configurationMap.set(configuration, d);
      }
    }
    const unique = (name, key) => new Set(rows[name].map((r) => r[key])).size === rows[name].length && rows[name].every((r) => text(r[key]));
    if (!unique('stock', 'orderUuid') || !unique('holds', 'holdId') || !unique('future_order_requests', 'requestId')
      || !unique('confirmed_supply', 'supplyId')) return unavailable('planning-supply-duplicate-identity');
    const stock = [];
    for (const row of rows.stock) {
      if (row.state === 'allocated' || row.allocated === true) continue;
      if (!['released', 'held'].includes(row.state)) continue;
      const derivative = configurationMap.get(row.configurationId);
      const availableAt = row.release?.releasedAt ?? row.release?.availability?.availableFrom;
      if (!derivative || !instant(availableAt) || Date.parse(availableAt) > Date.parse(asOf)) return unavailable('planning-exact-stock-mapping-missing');
      const holds = rows.holds.filter((h) => h.orderUuid === row.orderUuid && OCCUPYING_STATES.includes(h.state));
      const held = row.state === 'held' || row.held === true || holds.length > 0;
      if (held && (holds.length !== 1 || !text(holds[0].entitlementSlotId) || !instant(holds[0].expiresAt)
        || Date.parse(holds[0].expiresAt) <= Date.parse(asOf))) return unavailable('planning-held-stock-unresolved');
      if (!held && row.available !== true) continue;
      if (!Array.isArray(row.visibility?.companyIds) || !row.visibility.companyIds.every(text)
        || !Array.isArray(row.visibility?.schemeIds) || !row.visibility.schemeIds.every(text)
        || !(row.visibility.employeeIds === null || Array.isArray(row.visibility.employeeIds) && row.visibility.employeeIds.every(text))) return unavailable('planning-stock-visibility-missing');
      stock.push({ stockId: row.orderUuid, derivativeId: derivative.derivativeId, availableAt,
        heldForEntitlementSlotId: held ? holds[0].entitlementSlotId : null, visibility: structuredClone(row.visibility) });
    }
    const inbound = []; const releasedIds = new Map(); const byRequest = new Map(); const releases = [];
    for (const supply of rows.confirmed_supply) {
      const request = rows.future_order_requests.find((r) => r.requestId === supply.requestId);
      const derivative = request && productionMap.get(inputDigest([request.model, request.derivative]));
      if (!request || !derivative || supply.state !== 'confirmed' || !integer(supply.quantity) || supply.quantity < 1
        || !instant(supply.confirmedAt) || !instant(supply.expectedAt) || Date.parse(supply.confirmedAt) > Date.parse(asOf)
        || Date.parse(supply.expectedAt) < Date.parse(supply.confirmedAt) || !text(supply.policyVersion) || !text(supply.sourceVersion)
        || !text(supply.providerReference) || !supply.provenance) return unavailable('planning-confirmed-supply-invalid');
      byRequest.set(request.requestId, (byRequest.get(request.requestId) ?? 0) + supply.quantity);
      const released = new Set();
      for (const receipt of rows.event_receipts.filter((r) => r.consumerId === 'stock-release' && r.state === 'completed'
        && r.eventType === 'stock-released' && r.outcome?.status === 'ok' && r.outcome.value?.supplyId === supply.supplyId)) {
        const value = receipt.outcome.value;
        if (value.runId !== runId || value.kind !== 'stock-released' || value.trancheId !== receipt.eventId
          || !Array.isArray(value.orderUuids) || !value.orderUuids.every(text) || new Set(value.orderUuids).size !== value.orderUuids.length
          || !instant(value.releasedAt) || Date.parse(value.releasedAt) > Date.parse(asOf)) return unavailable('planning-release-provenance-invalid');
        if (value.orderUuids.length) releases.push({ kind: 'released', requestId: request.requestId, supplyId: supply.supplyId,
          quantity: value.orderUuids.length, at: value.releasedAt });
        for (const id of value.orderUuids) {
          const exact = rows.stock.find((s) => s.orderUuid === id);
          if (!exact || exact.release?.supplyId !== supply.supplyId || exact.release?.trancheId !== value.trancheId
            || exact.release?.releasedAt !== value.releasedAt || exact.release?.sourceVersion !== value.source?.version
            || exact.release?.policyVersion !== value.policyVersion || !['released', 'held', 'allocated'].includes(exact.state)
            || configurationMap.get(exact.configurationId)?.derivativeId !== derivative.derivativeId
            || releasedIds.has(id)) return unavailable('planning-release-provenance-invalid');
          released.add(id); releasedIds.set(id, supply.supplyId);
        }
      }
      if (released.size > supply.quantity) return unavailable('planning-release-quantity-invalid');
      inbound.push({ supplyId: supply.supplyId, derivativeId: derivative.derivativeId, state: 'confirmed', quantity: supply.quantity,
        releasedQuantity: released.size, expectedAt: supply.expectedAt,
        provenance: { requestId: request.requestId, confirmedAt: supply.confirmedAt, policyVersion: supply.policyVersion,
          sourceVersion: supply.sourceVersion, providerReference: supply.providerReference, provider: supply.provenance } });
    }
    for (const [requestId, confirmed] of byRequest) {
      const request = rows.future_order_requests.find((r) => r.requestId === requestId);
      if (!integer(request.quantity) || confirmed > request.quantity) return unavailable('planning-confirmed-quantity-invalid');
    }
    // A supply-linked physical unit without its actual release receipt cannot be
    // counted in stock while leaving the acknowledgement unreduced.
    if (rows.stock.some((s) => text(s.release?.supplyId) && rows.confirmed_supply.some((a) => a.supplyId === s.release.supplyId)
      && ['released', 'held', 'allocated'].includes(s.state) && !releasedIds.has(s.orderUuid))) return unavailable('planning-release-receipt-missing');
    stock.sort((a, b) => compare(a.stockId, b.stockId)); inbound.sort((a, b) => compare(a.supplyId, b.supplyId));
    // Requests are labelled intent only and never counted as supply; responses are the audit trail of replies.
    const requests = []; const delays = [];
    for (const row of rows.future_order_requests) {
      const derivative = productionMap.get(inputDigest([row.model, row.derivative]));
      if (!derivative || !integer(row.quantity)) return unavailable('planning-catalog-mapping-missing');
      requests.push({ requestId: row.requestId, commandId: row.commandId ?? null, derivativeId: derivative.derivativeId,
        quantity: row.quantity, state: row.state ?? null, requestedAt: row.requestedAt ?? null });
      for (const h of row.history ?? []) if (h?.state === 'delayed' && instant(h.at) && Date.parse(h.at) <= Date.parse(asOf)) {
        delays.push({ kind: 'delayed', requestId: row.requestId, at: h.at, delayUntil: h.until ?? h.delayUntil ?? null, reason: h.reason ?? null });
      }
    }
    const total = new Map(); const confirmations = [];
    for (const a of [...rows.confirmed_supply].sort((x, y) => Date.parse(x.confirmedAt) - Date.parse(y.confirmedAt) || compare(x.supplyId, y.supplyId))) {
      const sum = (total.get(a.requestId) ?? 0) + a.quantity; total.set(a.requestId, sum);
      const wanted = rows.future_order_requests.find((r) => r.requestId === a.requestId).quantity;
      confirmations.push({ kind: sum < wanted ? 'partly-confirmed' : 'confirmed', requestId: a.requestId, supplyId: a.supplyId,
        quantity: a.quantity, at: a.confirmedAt });
    }
    const idOf = (r) => `${r.requestId}|${r.kind}|${r.supplyId ?? ''}`;
    const responses = [...confirmations, ...delays, ...releases]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || compare(idOf(a), idOf(b)));
    requests.sort((a, b) => compare(a.requestId, b.requestId));
    return { status: 'ok', contractVersion: CONTRACT_VERSION, value: { runId, asOf, stock, inbound, requests, responses,
      versions: { stock: inputDigest({ stock: rows.stock, holds: rows.holds }), supply: inputDigest({ requests: rows.future_order_requests,
        confirmations: rows.confirmed_supply, receipts: rows.event_receipts }), catalog: catalogVersion } } };
  } catch { return unavailable('planning-supply-input-invalid'); }
}

export function createOrderPlanSupplyProvider({ repository, identity, clock, catalog } = {}) {
  return Object.freeze({
    async readSupply(context, read) {
      if (!repository || !identity || !clock || typeof catalog?.readCatalog !== 'function') return unavailable('planning-supply-not-configured');
      const allowed = await identity.requireRole(context, 'greg'); if (allowed.status !== 'ok') return allowed;
      try {
        const time = await clock.now(context); if (time.status !== 'ok') return time;
        if (time.value.runId !== context.runId || time.value.now !== read.asOf || read.policyVersion !== context.policyVersion) return unavailable('planning-supply-read-mismatch');
        const load = async () => {
          const results = await Promise.all(names.map((name) => repository.query(context, name)));
          const error = results.find((r) => r.status !== 'ok');
          return error ? { error } : Object.fromEntries(names.map((name, i) => [name, results[i].value]));
        };
        const choices = await catalog.readCatalog(context, read); if (choices.status !== 'ok') return choices;
        const rows = await load(); if (rows.error) return rows.error;
        const out = resolveSupplyRecords({ runId: context.runId, asOf: read.asOf, catalogVersion: choices.value.version, catalog: choices.value.derivatives, rows });
        if (out.status !== 'ok') return out;
        const after = await load(); if (after.error) return after.error;
        const end = await clock.now(context); if (end.status !== 'ok') return end;
        if (!same(rows, after) || !same(time.value, end.value)) return { status: 'conflict', code: 'planning-supply-changed', contractVersion: CONTRACT_VERSION };
        const final = await identity.requireRole(context, 'greg'); if (final.status !== 'ok') return final;
        return out;
      } catch { return unavailable('planning-supply-unavailable'); }
    },
  });
}
