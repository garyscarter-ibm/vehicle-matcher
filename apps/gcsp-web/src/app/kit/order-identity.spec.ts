import { describe, expect, it } from 'vitest';
import { orderIdentityRows, orderReferenceOf } from './order-identity';

describe('source order identity rows', () => {
  it('keeps the supplied reference and car order number distinct and in source order', () => {
    expect(orderIdentityRows('GCSP-000123', '0123456')).toEqual([
      { label: 'Order reference', value: 'GCSP-000123' }, { label: 'Car order number', value: '0123456' },
    ]);
    expect(orderReferenceOf('aB-012')).toBe('aB-012');
  });

  it.each([null, undefined, '', ' GCSP-123', 'GCSP_123', 'a'.repeat(33), 123])('omits a missing or malformed reference without inventing one: %s', reference => {
    expect(orderIdentityRows(reference, '0123456')).toEqual([{ label: 'Car order number', value: '0123456' }]);
  });

  it('retains a missing car number as missing rather than substituting its reference', () => {
    expect(orderIdentityRows('GCSP-000123', null)).toEqual([
      { label: 'Order reference', value: 'GCSP-000123' }, { label: 'Car order number', value: null },
    ]);
    expect(orderIdentityRows(null, undefined)).toEqual([{ label: 'Car order number', value: null }]);
  });
});
