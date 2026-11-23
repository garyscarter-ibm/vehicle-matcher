import { VEHICLE_IMAGE_ASSETS, VEHICLE_IMAGE_ROUTES } from '../activity/activity-image-registry';

// Reuse the one frozen data projection; Activity's overrides/alt/kind policy is separate.
const allowed = new Map<string, readonly string[]>(VEHICLE_IMAGE_ASSETS);
const routes = new Map<string, readonly string[]>(VEHICLE_IMAGE_ROUTES);

export function isDisplayImage(src: unknown, fidelity: unknown): boolean {
  return typeof src === 'string' && typeof fidelity === 'string'
    && (allowed.get(src) ?? routes.get(src))?.includes(fidelity) === true;
}
