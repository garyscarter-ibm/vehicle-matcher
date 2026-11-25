import { describe, expect, it } from 'vitest';
import { vehicleImageUrl } from './vehicle-image-url';
describe('vehicle image render URL', () => {
  it('normalizes only exact repository corpus paths and preserves other accepted sources', () => {
    const src = `/assets/gcsp-vehicle-evidence/${'a'.repeat(64)}.webp`;
    expect(vehicleImageUrl(src)).toBe(src.slice(1));
    for (const value of ['https://images.example.test/car.webp', '/images/car.webp', `${src}?variant=1`, '/assets/gcsp-vehicle-evidence/other.webp']) expect(vehicleImageUrl(value)).toBe(value);
    for (const value of [null, '//images.example.test/car.webp', 'javascript:alert(1)', 'http://images.example.test/car.webp']) expect(vehicleImageUrl(value)).toBeNull();
  });
});
