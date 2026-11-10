const ORDER = ['brief', 'facts', 'policy', 'stock', 'snapshot', 'terms', 'clock', 'availability'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Rebuilds the full stock answer from the compact wire form; returns null when it cannot. */
export function expandStockPayload(value) {
  if (!object(value) || value.payloadShape !== 'manual-stock-compact-v1') return value;
  const { payloadShape: _shape, sharedVersionKeys: shared, carIds, ...rest } = value;
  if (!Array.isArray(shared) || !Array.isArray(carIds) || !Array.isArray(rest.decisions) || !object(rest.versions)) return null;
  if (!shared.every((key) => key in rest.versions)) return null;
  const decisions = [];
  for (const row of rest.decisions) {
    if (!object(row) || !object(row.versions)) return null;
    const merged = { ...row.versions };
    for (const key of shared) merged[key] = rest.versions[key];
    const rank = (key) => (ORDER.includes(key) ? ORDER.indexOf(key) : ORDER.length);
    decisions.push({ ...row, versions: Object.fromEntries(Object.entries(merged).sort(([a], [b]) => rank(a) - rank(b))) });
  }
  const byId = new Map(decisions.map((row) => [row.orderUuid, row]));
  const cars = carIds.map((id) => byId.get(id));
  return cars.includes(undefined) ? null : { ...rest, decisions, cars };
}
