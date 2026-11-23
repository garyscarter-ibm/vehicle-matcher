/** Repository evidence lives under the Angular base; other accepted image URLs keep their meaning. */
export function vehicleImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (/^\/assets\/gcsp-vehicle-evidence\/[0-9a-f]{64}\.webp$/.test(value)) return value.slice(1);
  return /^\/(?!\/)/.test(value) || /^https:\/\//.test(value) ? value : null;
}
