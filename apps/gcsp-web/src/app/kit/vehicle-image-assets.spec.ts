import { describe, expect, it } from 'vitest';
import { isDisplayImage } from './vehicle-image-assets';

describe('source display image lookup', () => {
  it.each([
    ['/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp', 'representative-configuration', true],
    ['/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp', 'representative-model', true],
    ['/api/gcsp/vehicle-images/bmw-display-07c269dd7f55fad0a56b.webp', 'representative-model', true],
    ['/assets/gcsp-vehicle-evidence/01af2978ba13fd99e11d6477eb706e0648f67d5602bc72e8e20217908b235748.webp', 'representative-model', true],
    ['/assets/gcsp-vehicle-evidence/01af2978ba13fd99e11d6477eb706e0648f67d5602bc72e8e20217908b235748.webp', 'representative-configuration', false],
    ['/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp', 'exact', false],
    ['/assets/gcsp-vehicle-evidence/000cfa6bd4d71e51611f32283003aacf383c9c9d12f1a29f25b600a98d496490.webp?size=2', 'representative-model', false],
    ['/api/gcsp/vehicle-images/bmw-display-07c269dd7f55fad0a56b.webp#crop', 'representative-model', false],
    ['/assets/gcsp-vehicle-evidence/unknown.webp', 'representative-model', false],
    ['/assets/brand-hero/bmw.jpg', 'representative', false],
    ['https://images.example/car.webp', 'representative-model', false],
    ['data:image/gif;base64,example', 'representative-model', false],
    [null, 'representative-model', false],
    ['/api/gcsp/vehicle-images/bmw-display-07c269dd7f55fad0a56b.webp', undefined, false],
    ['/api/gcsp/vehicle-images/bmw-display-07c269dd7f55fad0a56b.webp', '', false],
  ] as const)('accepts only exact registered src and fidelity: %s %s -> %s', (src, fidelity, want) => {
    expect(isDisplayImage(src, fidelity)).toBe(want);
  });
});
