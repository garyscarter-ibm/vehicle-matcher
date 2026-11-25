import { describe, expect, it } from 'vitest';
import { reasonText } from './brief.copy';

describe('shared source employee reason copy', () => {
  it.each([
    ['2026-07-14', 'Available by Tuesday 14 July 2026.'],
    ['2026-07-14T23:30:00.000Z', 'Available by Wednesday 15 July 2026.'],
    ['2026-07-14T23:30:00', 'Available by your required date.'],
    ['2026-02-30', 'Available by your required date.'],
  ])('uses the Node calendar/UK-instant date shape for %s', (requiredBy, wanted) => {
    expect(reasonText({ code: 'required-by-met', requiredBy }, 'reasons')).toBe(wanted);
  });
  it('uses source body labels before composing a matched preference sentence', () => {
    expect(reasonText({ code: 'preference-fit', field: 'body', desired: 'large-estate', score: 100 }, 'reasons'))
      .toBe('Large Estate, the body style you prefer.');
  });
});
