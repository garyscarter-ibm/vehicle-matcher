import { describe, expect, it } from 'vitest';
import { accountSnapshot } from './account.test-data';
import { latestOrder, orderVehicle, placedOrderRecord, validOffers, validOrders, validOrdersPage, validOrderSnapshot } from './account.preview';

describe('account offer and order previews', () => {
  it('selects newest source receipt then descending exact stock identity without changing the list', () => {
    const orders = [{ orderUuid: 'z-old', entitlementSlotId: 'slot', source: { receivedAt: '2026-11-01T00:00:00Z' } },
      { orderUuid: 'a-new', entitlementSlotId: 'slot', source: { receivedAt: '2026-11-02T00:00:00Z' } },
      { orderUuid: 'z-new', entitlementSlotId: 'slot', source: { receivedAt: '2026-11-02T00:00:00Z' } }];
    expect(latestOrder(orders)?.orderUuid).toBe('z-new'); expect(orders[0].orderUuid).toBe('z-old');
    expect(latestOrder([{ orderUuid: 'a', entitlementSlotId: 'slot' }, { orderUuid: 'z', entitlementSlotId: 'slot' }])?.orderUuid).toBe('z');
    expect(latestOrder([])).toBeNull();
  });
  it('uses matching durable display only, keeps exact stock identity distinct from VIN and filters unsafe media', () => {
    const snapshot = { selection: { stock: { orderUuid: 'stock', vin: 'VIN', facts: { display: { name: ' BMW i4 ', photo: 'javascript:alert(1)', images: [{ src: '/car.webp' }] } } } } };
    expect(orderVehicle(snapshot, 'stock')).toEqual({ name: 'BMW i4', photo: '/car.webp' });
    expect(orderVehicle(snapshot, 'VIN')).toBeNull(); expect(orderVehicle(snapshot, 'other-stock')).toBeNull();
    expect(orderVehicle({ selection: { stock: { orderUuid: 'stock', model: 'not authoritative display' } } }, 'stock')).toBeNull();
    expect(orderVehicle({ selection: { stock: { orderUuid: 'stock', facts: { display: { name: 'Car', photo: '//elsewhere/car' } } } } }, 'stock')).toEqual({ name: 'Car', photo: undefined });
  });
  it('requires known account slot for a placed history record, preserving supplied order identity without a quote', () => {
    const account = accountSnapshot(); const order = { orderUuid: 'stock', entitlementSlotId: account.slots![0].entitlementSlotId, outcome: 'ordered', source: { orderReference: { value: 'REF-123', system: 'GCSP' }, orderNumber: '123456' } };
    expect(placedOrderRecord(order, null, account)).toMatchObject({ model: 'Your new car', slotId: order.entitlementSlotId, status: 'ordered', orderReference: order.source.orderReference, orderNumber: '123456', media: null });
    expect(placedOrderRecord(order, null, account)).not.toHaveProperty('terms');
    expect(placedOrderRecord({ ...order, entitlementSlotId: 'other-slot' }, null, account)).toBeNull();
  });
  it('validates required shapes while preserving optional authoritative facts', () => {
    expect(validOffers({ offers: [] })).toBe(true); expect(validOffers({ offers: [{ offerId: 'id', runId: 'run', reason: 'supplied' }] })).toBe(true);
    expect(validOffers({ offers: [{ offerId: 'id' }] })).toBe(false); expect(validOffers({ offers: [{ offerId: '..', runId: 'run' }] })).toBe(false); expect(validOrders({ orders: [{ orderUuid: 'id' }] })).toBe(false);
    expect(validOrders({ orders: [{ orderUuid: 'id', entitlementSlotId: 'slot', source: { receivedAt: 'supplied', orderNumber: 123 } }] })).toBe(false);
    expect(validOrderSnapshot({ selection: { stock: { orderUuid: 'id', facts: { display: { name: 123 } } } } })).toBe(false);
    expect(validOrderSnapshot({ selection: { stock: { orderUuid: 'id', facts: { display: { name: 'Car', extra: 'evidence' } } } } })).toBe(true);
  });
  it('accepts Java flat selection facts and only coherent optional legacy display evidence', () => {
    const flat = { status: 'acknowledged', selection: { orderUuid: 'order', orderNumber: null, configurationId: 'config', receivedAt: null } };
    expect(validOrderSnapshot(flat)).toBe(true); expect(orderVehicle(flat, 'order')).toBeNull();
    const stock = { orderUuid: 'order', facts: { display: { name: 'Supplied car', photo: '/car.webp' } } };
    const hybrid = { selection: { orderUuid: 'order', stock } };
    expect(validOrderSnapshot(hybrid)).toBe(true); expect(orderVehicle(hybrid, 'order')).toEqual({ name: 'Supplied car', photo: '/car.webp' });
    expect(orderVehicle(hybrid, 'config')).toBeNull();
    const mismatch = { selection: { orderUuid: 'different', stock } };
    expect(validOrderSnapshot(mismatch)).toBe(false); expect(orderVehicle(mismatch, 'order')).toBeNull();
    for (const selection of [{}, { orderUuid: null }, { orderUuid: 'order', stock: {} }, { orderUuid: 'order', orderNumber: 123 }]) {
      expect(validOrderSnapshot({ selection })).toBe(false);
    }
  });
  it('requires explicit page completion and exact failure counts while accepting nullable optional evidence', () => {
    const page = { orders: [], failed: [], failedCount: 0, nextAfter: null };
    expect(validOrdersPage(page)).toBe(true); expect(validOrdersPage({ ...page, nextAfter: 'cursor', asOf: null })).toBe(true);
    expect(validOrdersPage({ ...page, failed: [{ orderUuid: 'id', status: 'unavailable', code: 'selection-source-invalid' }], failedCount: 30 })).toBe(true);
    for (const invalid of [{ orders: [] }, { ...page, nextAfter: undefined }, { ...page, nextAfter: '' }, { ...page, nextAfter: 'x'.repeat(201) },
      { ...page, failedCount: 1.5 }, { ...page, failedCount: -1 }, { ...page, failed: [{}] },
      { ...page, failed: [{ orderUuid: 'id', status: 'unavailable', code: 'bad' }] }]) expect(validOrdersPage(invalid)).toBe(false);
  });
});
