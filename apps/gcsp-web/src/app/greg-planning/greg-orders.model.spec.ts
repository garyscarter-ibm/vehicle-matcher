import { describe, expect, it } from 'vitest';
import { parseGregOrders } from './greg-orders.model';
import { ordersFixture } from './greg-orders.fixtures';
describe('actual production tracking projection', () => {
  it('keeps request versions and confirmed, outstanding and released quantities separate', () => {
    const projection = parseGregOrders(ordersFixture(), true);
    expect(projection?.requests[0]).toMatchObject({ version: 6, quantity: 3, confirmedQuantity: 1, outstandingQuantity: 2, releasedQuantity: 0 });
    expect(projection?.choices[0]).toEqual({ model: '3 Series Saloon', derivative: '320i' });
    expect(projection?.versions).toMatchObject({ policy: 'p1', stock: 's1' });
  });
  it('accepts Presenter inspection without Greg version pins but rejects missing request versions', () => {
    const { versions, ...production } = ordersFixture();
    expect(parseGregOrders(production)?.requests).toHaveLength(1);
    expect(parseGregOrders(production, true)).toBeNull();
    expect(parseGregOrders({ ...ordersFixture(), requests: [{ ...ordersFixture().requests[0], version: 0 }] })).toBeNull();
  });
});
