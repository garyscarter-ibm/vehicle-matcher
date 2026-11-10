export const STOCK_PAYLOAD_SHAPE = 'manual-stock-compact-v1';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = (value) => JSON.stringify(value, (key, item) => (object(item)
  ? Object.fromEntries(Object.keys(item).sort().map((name) => [name, item[name]])) : item));

/** Wire form of the manual stock answer: shared decision versions and repeated cars are sent once. */
export function compactStockPayload(value) {
  const { decisions, cars, versions } = value ?? {};
  if (!Array.isArray(decisions) || !Array.isArray(cars) || !object(versions) || 'payloadShape' in value
    || !decisions.every((row) => object(row) && object(row.versions) && typeof row.orderUuid === 'string')) return value;
  const byId = new Map(decisions.map((row) => [row.orderUuid, row]));
  const same = (car) => object(car) && byId.has(car.orderUuid) && (byId.get(car.orderUuid) === car || canonical(byId.get(car.orderUuid)) === canonical(car));
  if (byId.size !== decisions.length || !cars.every(same)) return value;
  const shared = Object.keys(versions).filter((key) => decisions.length > 0 && decisions.every((row) => key in row.versions
    && canonical(row.versions[key]) === canonical(versions[key])));
  const { cars: _cars, ...rest } = value;
  return { ...rest, payloadShape: STOCK_PAYLOAD_SHAPE, sharedVersionKeys: shared,
    carIds: cars.map((car) => car.orderUuid),
    decisions: decisions.map((row) => ({ ...row,
      versions: Object.fromEntries(Object.entries(row.versions).filter(([key]) => !shared.includes(key))) })) };
}
