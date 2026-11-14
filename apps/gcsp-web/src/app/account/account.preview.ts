import { AccountProjection, ContractView, EvidenceRecord } from './account.types';

export interface AccountOffer extends EvidenceRecord { readonly offerId: string; readonly runId: string; readonly state?: string }
export interface AccountOffers extends EvidenceRecord { readonly offers: readonly AccountOffer[] }
export interface AccountOrder extends EvidenceRecord {
  readonly orderUuid: string; readonly entitlementSlotId: string; readonly outcome?: string; readonly currentStage?: string;
  readonly source?: EvidenceRecord & { readonly receivedAt?: string; readonly orderReference?: unknown; readonly orderNumber?: string };
}
export interface AccountOrders extends EvidenceRecord { readonly orders: readonly AccountOrder[] }
export interface AccountOrderSnapshot extends EvidenceRecord {
  readonly selection?: EvidenceRecord & { readonly stock?: EvidenceRecord & { readonly orderUuid: string; readonly facts?: EvidenceRecord & { readonly display?: EvidenceRecord } } };
}
export interface OrderVehicle { readonly name: string; readonly photo?: string }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const optionalText = (value: unknown): boolean => value == null || typeof value === 'string';
export function validOffers(value: unknown): value is AccountOffers {
  return object(value) && Array.isArray(value['offers']) && value['offers'].every((row) => object(row) && text(row['offerId']) && !['.', '..'].includes(row['offerId']) && text(row['runId']) && optionalText(row['state']));
}
export function validOffer(value: unknown): value is EvidenceRecord & { readonly state: string } { return object(value) && text(value['state']); }
export function validOrders(value: unknown): value is AccountOrders {
  return object(value) && Array.isArray(value['orders']) && value['orders'].every((row) => object(row) && text(row['orderUuid']) && text(row['entitlementSlotId'])
    && optionalText(row['outcome']) && optionalText(row['currentStage']) && (row['source'] == null || object(row['source'])
      && optionalText(row['source']['receivedAt']) && optionalText(row['source']['orderNumber'])
      && (row['source']['orderReference'] == null || typeof row['source']['orderReference'] === 'string' || object(row['source']['orderReference']))));
}
export function validOrderSnapshot(value: unknown): value is AccountOrderSnapshot {
  if (!object(value) || !object(value['selection']) || !object(value['selection']['stock'])) return false;
  const stock = value['selection']['stock'];
  if (!text(stock['orderUuid']) || stock['facts'] != null && !object(stock['facts'])) return false;
  const display = object(stock['facts']) ? stock['facts']['display'] : null;
  return display == null || object(display) && optionalText(display['name']) && optionalText(display['photo'])
    && (display['images'] == null || Array.isArray(display['images']) && display['images'].every((image) => object(image) && optionalText(image['src'])));
}
export function latestOrder(orders: readonly AccountOrder[]): AccountOrder | null {
  const stamp = (row: AccountOrder): number => { const time = Date.parse(row.source?.receivedAt ?? ''); return Number.isFinite(time) ? time : -Infinity; };
  return [...orders].sort((a, b) => stamp(b) - stamp(a) || (a.orderUuid === b.orderUuid ? 0 : a.orderUuid < b.orderUuid ? 1 : -1))[0] ?? null;
}
export function orderVehicle(snapshot: AccountOrderSnapshot | null, orderUuid: string): OrderVehicle | null {
  const stock = snapshot?.selection?.stock;
  const display = stock?.orderUuid === orderUuid ? stock.facts?.display : null;
  const name = typeof display?.['name'] === 'string' ? display['name'].trim() : '';
  if (!name) return null;
  const safe = (value: unknown): string | undefined => typeof value === 'string' && /^(https:\/\/|\/(?!\/))/.test(value) ? value : undefined;
  const images = display?.['images']; const first = Array.isArray(images) && object(images[0]) ? images[0]['src'] : undefined;
  return { name, photo: safe(display?.['photo']) ?? safe(first) };
}
export function placedOrderRecord(order: AccountOrder | null, vehicle: OrderVehicle | null, account: AccountProjection | null): ContractView | null {
  if (!order || !account?.slots?.some((slot) => slot.entitlementSlotId === order.entitlementSlotId) || !account.account?.schemeId) return null;
  return { contractId: `order:${order.orderUuid}`, schemeId: account.account.schemeId, slotId: order.entitlementSlotId,
    model: vehicle?.name ?? 'Your new car', status: order.outcome, orderReference: order.source?.orderReference, orderNumber: order.source?.orderNumber,
    driver: null, daysRemaining: null, action: null, media: null, facts: [] };
}
