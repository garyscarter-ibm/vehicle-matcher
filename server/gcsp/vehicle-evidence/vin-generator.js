import { createVinProfileRegistry } from './vin-profiles.js';

export const VIN_GENERATOR_VERSION = 'synthetic-identities.sha256-v1';
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
const VALUES = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };

export function calculateVinCheckDigit(vin) {
  if (typeof vin !== 'string' || !/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) {
    throw new TypeError('Expected 17 uppercase permitted VIN characters');
  }
  const sum = [...vin].reduce((total, char, index) => total + (VALUES[char] ?? Number(char)) * WEIGHTS[index], 0);
  const remainder = sum % 11;
  return { sum, remainder, character: remainder === 10 ? 'X' : String(remainder) };
}

/** Constructs one candidate only after the registry establishes the exact profile and usage. */
export async function generateVin(request, { registry = createVinProfileRegistry() } = {}) {
  if (!request || typeof request !== 'object') return { status: 'invalid-input' };
  const { configuration, serial, profileId, usage, referenceOnly, registryVersion } = request;
  const resolved = await registry.resolve(configuration, { profileId, usage, referenceOnly, registryVersion });
  if (resolved.status !== 'ok') return { status: resolved.status, mismatchedFields: resolved.mismatchedFields || [] };
  const { profile } = resolved;
  if (request.profileVersion !== undefined && request.profileVersion !== profile.profileVersion) return { status: 'version-conflict' };
  const { format } = profile;
  if (profile.status !== 'enabled' || format.position9.convention !== 'calculated-modulo-11'
    || format.position10.convention !== 'US-model-year') return { status: 'unsupported' };
  if (format.serial.shape !== 'NNNNNN' || typeof serial !== 'string' || !/^[0-9]{6}$/.test(serial)) {
    return { status: 'invalid-input', reason: 'serial-shape' };
  }
  const candidate = `${format.wmi}${format.descriptor.value}0${format.position10.value}${configuration.plant}${serial}`;
  const { character } = calculateVinCheckDigit(candidate);
  const vin17 = candidate.slice(0, 8) + character + candidate.slice(9);
  return { status: 'ok', identityKind: 'synthetic', generatorVersion: VIN_GENERATOR_VERSION,
    vin17, vin7: vin17.slice(-7), serial, profile: { profileId: profile.profileId, profileVersion: profile.profileVersion,
      registryVersion: resolved.registryVersion, referenceOnly: profile.referenceOnly },
    sourceKind: resolved.sourceKind, sources: resolved.sources, confidence: profile.evidence.confidence,
    unknownFields: profile.evidence.unresolvedFacts, completeVinDecoded: false,
    modelYear: configuration.modelYear, productionEra: configuration.productionEra,
    productionDate: configuration.productionDate, registrationDate: null };
}
