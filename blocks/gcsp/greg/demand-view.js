// Pure mapping from one Greg demand projection to display data. No DOM, no policy: every figure and label comes from the server.
import {
  BASIS_LABEL, BASIS_NOTE, MODEL_LINE_UNCONFIRMED, formatDemoTime, gateInfo, keyLabel, reasonLabel, requirementText,
  GATE_SEVERITY_LABELS,
} from './demand-copy.js';

/** Thrown by toDashboardView for an unreadable projection; the view shows its "unavailable" state. */
export class DemandViewError extends Error {
  constructor(reason) { super(`Greg demand projection unreadable: ${reason}`); this.name = 'DemandViewError'; this.code = 'malformed-projection'; }
}
const bad = (reason) => { throw new DemandViewError(reason); };
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export const OVERLAP_NOTE = 'Rows can overlap, so do not add them together. An accepted offer can later be selected, and one employee can be blocked by more than one reason.';

function privacyNote(threshold) {
  if (threshold === 1) return 'Zero shows as <1. Every other count is exact.';
  return `Counts below ${threshold} show as <${threshold}, so small groups cannot be picked out.`;
}

// A band carries the server's own fewerThan threshold or label; no count is read from or derived for it.
function countOf(count, where) {
  if (!isObject(count?.count)) return bad(`${where} has no count`);
  const { kind, label } = count.count;
  if (typeof label !== 'string' || !label) return bad(`${where} has no count label`);
  if (kind === 'band') {
    if (Object.hasOwn(count.count, 'value')) return bad(`${where} band carries a value`);
    return Number.isFinite(count.count.fewerThan) ? { label, isBand: true, fewerThan: count.count.fewerThan } : { label, isBand: true };
  }
  if (kind === 'exact') return { label, isBand: false };
  return bad(`${where} has an unknown count kind`);
}
const rows = (list, where, map) => (Array.isArray(list) ? list.map((row, i) => {
  if (!isObject(row)) bad(`${where}[${i}] is not an object`);
  return map(row, `${where}[${i}]`);
}) : bad(`${where} is not a list`));
const keyed = (row, where, label) => {
  if (typeof row.key !== 'string' || !row.key) bad(`${where} has no key`);
  return { key: row.key, label: label(row.key), count: countOf(row, where) };
};
const versions = (list, where) => (Array.isArray(list) ? list : bad(`${where} is not a list`));

/** projection (a readDemand `value`) -> view data, or throws DemandViewError. */
export function toDashboardView(projection) {
  if (!isObject(projection)) return bad('no projection');
  const { demand, offers, stock, privacy } = projection;
  if (!isObject(demand)) bad('no demand');
  if (!isObject(offers)) bad('no offers');
  if (!isObject(stock) || !Array.isArray(stock.byModelLine)) bad('no stock');
  if (!isObject(projection.versions)) bad('no versions');
  if (!Number.isSafeInteger(privacy?.threshold) || privacy.threshold < 1) bad('no privacy threshold');
  const asOfText = formatDemoTime(projection.asOf);
  if (!asOfText) bad('no demo-clock time');
  if (typeof projection.projectionVersion !== 'string' || !projection.projectionVersion) bad('no projection version');

  const briefVersions = versions(projection.versions.brief, 'versions.brief');
  const policyVersions = versions(projection.versions.policy, 'versions.policy');
  const unmet = isObject(demand.unmet) ? demand.unmet : bad('no unmet demand');

  const activeBriefs = { key: 'activeBriefs', label: 'Active briefs', count: countOf(demand.activeBriefs, 'demand.activeBriefs') };
  const unmetTotal = { key: 'unmetTotal', label: 'Briefs with no suitable car', count: countOf(unmet.total, 'demand.unmet.total') };
  const offerCount = (key, label) => ({ key, label, count: countOf(offers[key], `offers.${key}`) });
  const made = offerCount('made', 'Offers made');
  const accepted = offerCount('accepted', 'Accepted');
  const declined = offerCount('declined', 'Declined');
  const expired = offerCount('expired', 'Expired');
  const selected = offerCount('selected', 'Selected');

  const essentials = rows(demand.essentials, 'demand.essentials', (row, where) => {
    const confirmed = row.state === 'confirmed';
    return { key: `${row.field}|${row.operator}|${JSON.stringify(row.value)}|${row.unit}|${row.state}`, field: row.field,
      label: requirementText(row), state: confirmed ? 'confirmed' : 'needs-confirmation',
      stateLabel: confirmed ? 'Confirmed' : 'Needs confirmation', count: countOf(row, where) };
  });
  const byGate = rows(unmet.byGate, 'demand.unmet.byGate', (row, where) => {
    const info = gateInfo(row.key);
    return { ...keyed(row, where, () => info.label), code: info.code, field: info.field, severity: info.severity,
      severityLabel: GATE_SEVERITY_LABELS[info.severity] };
  });
  const stockRows = rows(stock.byModelLine, 'stock.byModelLine', (row, where) => ({
    key: String(row.key), label: row.key === 'unconfirmed' ? MODEL_LINE_UNCONFIRMED : String(row.key),
    released: countOf(row.released, `${where}.released`), held: countOf(row.held, `${where}.held`), allocated: countOf(row.allocated, `${where}.allocated`),
  }));

  const view = {
    meta: {
      asOf: projection.asOf, asOfText, asOfLabel: `${asOfText} (demo clock)`,
      basisLabel: BASIS_LABEL, basisNote: BASIS_NOTE,
      policyVersions: [...policyVersions], briefVersions: [...briefVersions], clockVersion: String(projection.versions.clock ?? ''),
      briefVersionsLabel: briefVersions.length ? briefVersions.join(', ') : 'None yet',
      policyVersionsLabel: policyVersions.length ? policyVersions.join(', ') : 'None',
      projectionVersion: projection.projectionVersion, projectionVersionShort: projection.projectionVersion.slice(0, 8),
      threshold: privacy.threshold, privacyNote: privacyNote(privacy.threshold), overlapNote: OVERLAP_NOTE,
    },
    headline: [activeBriefs, unmetTotal, made, selected],
    demand: {
      activeBriefs, unmetTotal,
      byModelLine: rows(demand.byModelLine, 'demand.byModelLine', (row, where) => keyed(row, where, keyLabel)),
      byBody: rows(demand.byBody, 'demand.byBody', (row, where) => keyed(row, where, keyLabel)),
      byFuel: rows(demand.byFuel, 'demand.byFuel', (row, where) => keyed(row, where, keyLabel)),
      essentials, unmetByGate: byGate,
    },
    offers: {
      made, accepted, declined, expired, selected,
      declinedByReason: rows(offers.declinedByReason, 'offers.declinedByReason', (row, where) => keyed(row, where, reasonLabel)),
    },
    // FUCQ-130: a failed or stale release pull is shown as unavailable, never as zero stock.
    stock: { rows: stockRows, sourceUnavailable: stock.source?.status === 'unavailable', sourceStale: stock.source?.reason === 'stale' },
    // A banded released count cannot show zero, so only an empty stock list means nothing is released, held or allocated.
    flags: { noBriefs: demand.byModelLine.length === 0, noStockReleased: stockRows.length === 0, hasBands: false },
  };
  const all = [...view.headline, ...view.demand.byModelLine, ...view.demand.byBody, ...view.demand.byFuel, ...essentials, ...byGate,
    made, accepted, declined, expired, selected, ...view.offers.declinedByReason,
    ...stockRows.flatMap((row) => [row.released, row.held, row.allocated].map((count) => ({ count })))];
  view.flags.hasBands = all.some((item) => item.count.isBand);
  return view;
}
