import { readFile } from 'node:fs/promises';
import { canonicalBmwVinGuideRequest } from './bmw-vin-guide-adapter.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/bmw-vin-guide-synthetic.v1.json', import.meta.url), 'utf8'));
const SCENARIOS = new Set(['available', 'no-guide', 'partial', 'unavailable']);

/** Explicit, local-only fixture input. The caller supplies an existing labelled synthetic VIN association.
 * This is content input, not a VIN classifier/generator, publication registry or provider for arbitrary identities.
 */
export function createSyntheticBmwVinGuideProvider({ vin, scenario = 'available' } = {}) {
  const binding = canonicalBmwVinGuideRequest({ vin, locale: fixture.locale });
  if (!binding || !SCENARIOS.has(scenario)) throw new TypeError('Supply a synthetic fixture VIN and supported scenario.');
  return Object.freeze({ id: 'bmw-vin-guide-synthetic', version: '1', sourceKind: 'synthetic',
    async resolve(request) {
      if (request.vin !== binding.vin) return { status: 'no-guide', observedDate: fixture.observedDate };
      if (request.locale !== fixture.locale) return { status: 'unsupported-locale', observedDate: fixture.observedDate };
      if (scenario === 'unavailable') return { status: 'source-unavailable' };
      if (scenario === 'no-guide') return { status: 'no-guide', observedDate: fixture.observedDate };
      const content = structuredClone(fixture);
      if (scenario === 'partial') { content.guide.links = []; content.illustration = { status: 'unavailable' }; }
      return { status: scenario, observedDate: content.observedDate, guide: content.guide, illustration: content.illustration,
        completeness: scenario === 'partial' ? { handbook: 'partial', sections: 'partial', links: 'unknown' } : content.completeness };
    } });
}
