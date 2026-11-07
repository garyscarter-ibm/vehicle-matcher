/** Target configuration identity only; source dates, request seeds and accessories are separate. */
export class CollectionError extends Error {
  constructor(code, message) { super(message); this.name = 'CollectionError'; this.code = code; }
}
export const requireValue = (condition, code, message) => {
  if (!condition) throw new CollectionError(code, message);
};
const ASSUMPTIONS = ['stock.configuration.modelCodeField', 'stock.configuration.codeSeparator',
  'stock.configuration.includePaintAndUpholstery', 'stock.configuration.encoding'];

export function normaliseCode(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9]{2,16}$/.test(value.trim()), 'invalid-code', 'A bounded alphanumeric source code is required.');
  return value.trim().toUpperCase();
}

/** Aliases must be explicitly supplied by the selected source, never guessed by padding. */
export function normaliseCodes(values, aliases = {}) {
  requireValue(Array.isArray(values) && values.length <= 512 && aliases && typeof aliases === 'object' && !Array.isArray(aliases),
    'invalid-factory-selection', 'Supply a bounded source selection and explicit alias map.');
  const mapping = new Map();
  for (const [from, to] of Object.entries(aliases)) {
    const code = normaliseCode(from); const target = normaliseCode(to);
    requireValue(!mapping.has(code) || mapping.get(code) === target, 'invalid-alias', 'Conflicting source aliases.');
    mapping.set(code, target);
  }
  const resolve = (value) => {
    let code = normaliseCode(value); const seen = new Set();
    while (mapping.has(code) && mapping.get(code) !== code) {
      requireValue(!seen.has(code), 'invalid-alias', 'Cyclic source aliases.');
      seen.add(code); code = mapping.get(code);
    }
    return code;
  };
  return [...new Set(values.map(resolve))].sort();
}

/** Reads the same canonical PolicyService assumptions consumed by F54's publisher. */
export async function createConfigurationKey({ policyService, policyRead } = {}) {
  requireValue(typeof policyService?.getAssumption === 'function' && policyRead && typeof policyRead === 'object',
    'signature-policy-unavailable', 'Inject PolicyService and an explicit dated policy read.');
  const rows = await Promise.all(ASSUMPTIONS.map((key) => policyService.getAssumption(key, policyRead)));
  requireValue(rows.every((row) => row?.status === 'ok') && new Set(rows.map((row) => row.policyVersion)).size === 1,
    'signature-policy-unavailable', 'Resolve a coherent retained signature policy.');
  const [modelField, separator, includeAll, encoding] = rows.map((row) => row.value?.value);
  requireValue(modelField === 'vgModelCode' && separator === ',' && includeAll === true && encoding === 'base64-padded',
    'unsupported-signature-policy', 'The collector requires the agreed VG model, complete factory codes and target Base64 rule.');
  const signaturePolicyVersion = rows[0].policyVersion;
  const key = (identity) => {
    const model = normaliseCode(identity?.[modelField]);
    const codes = normaliseCodes(identity?.factoryOptionCodes, identity?.aliases);
    requireValue(codes.length > 0 && codes.length <= 256, 'invalid-factory-selection', 'A complete nonempty factory selection is required.');
    requireValue(codes.every((code) => !code.startsWith('SE')), 'accessory-in-factory-selection', 'Dealer accessories belong in the separate typed accessory set.');
    const decodedIdentity = `${model}:${codes.join(separator)}`;
    const canonicalIdentity = { vgModelCode: model, factoryOptionCodes: codes };
    if (identity.agModelCode !== undefined) canonicalIdentity.agModelCode = normaliseCode(identity.agModelCode);
    return { configurationId: Buffer.from(decodedIdentity).toString('base64'), decodedIdentity, canonicalIdentity, signaturePolicyVersion };
  };
  key.policyVersion = signaturePolicyVersion;
  return key;
}
