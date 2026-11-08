import { readFile } from 'node:fs/promises';

const DEFAULT_FILE = new URL('./seed-v1.json', import.meta.url);
const TABLES = ['schemeRuleLinks', 'eligibilityRules', 'pricePlans', 'allowances', 'assumptions'];
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export class PolicySourceError extends Error {
  constructor(code) {
    super(code === 'source-invalid' ? 'Policy source is invalid.' : 'Policy source is unavailable.');
    this.code = code;
  }
}

export function validInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const day = value.slice(0, 10);
  return validDay(day) && Number.isFinite(Date.parse(value)) && Number(value.slice(11, 13)) < 24
    && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}

function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function requireSource(condition) {
  if (!condition) throw new PolicySourceError('source-invalid');
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function unique(values) {
  return new Set(values).size === values.length;
}

function dates(row) {
  requireSource(validInstant(row.effectiveFrom));
  requireSource(row.effectiveTo === undefined || (validInstant(row.effectiveTo)
    && Date.parse(row.effectiveTo) > Date.parse(row.effectiveFrom)));
}

function nonoverlapping(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const id = key(row);
    const previous = groups.get(id) || [];
    const start = Date.parse(row.effectiveFrom);
    const end = row.effectiveTo === undefined ? Infinity : Date.parse(row.effectiveTo);
    requireSource(previous.every(([otherStart, otherEnd]) => start >= otherEnd || end <= otherStart));
    previous.push([start, end]);
    groups.set(id, previous);
  }
}

export function snapshotVersions(input) {
  let versions;
  try { versions = structuredClone(input); } catch { throw new PolicySourceError('source-invalid'); }
  requireSource(Array.isArray(versions) && versions.length > 0);
  requireSource(unique(versions.map((version) => version?.policyVersion)));
  requireSource(unique(versions.map((version) => Date.parse(version?.effectiveFrom))));
  for (const seed of versions) {
    requireSource(object(seed) && seed.schemaVersion === 1 && text(seed.policyVersion) && text(seed.source));
    dates(seed);
    for (const table of TABLES) {
      requireSource(Array.isArray(seed[table]));
      requireSource(unique(seed[table].map((row) => row?.key)));
      for (const row of seed[table]) {
        requireSource(object(row) && text(row.key) && Object.hasOwn(row, 'value') && row.value !== undefined
          && text(row.unit) && ['assumed', 'verified', 'observed aggregate'].includes(row.status) && text(row.basis)
          && text(row.source) && validDay(row.sourceDate) && row.policyVersion === seed.policyVersion);
        dates(row);
      }
    }
    const mapping = seed.assumptions.find(({ key }) => key === 'eligibility.context.mapping')?.value;
    requireSource(Array.isArray(mapping) && mapping.length > 0);
    requireSource(unique(mapping.map((row) => row?.schemeId)));
    for (const row of mapping) {
      requireSource(object(row) && text(row.schemeId) && text(row.companyId) && text(row.sourceMatrix)
        && Array.isArray(row.gradeIds) && row.gradeIds.length > 0 && row.gradeIds.every(text) && unique(row.gradeIds));
    }
    const knownScheme = (schemeId) => mapping.find((row) => row.schemeId === schemeId);
    requireSource(unique(seed.eligibilityRules.map((row) => row.ruleId)));
    requireSource(unique(seed.schemeRuleLinks.map((row) => row.linkId)));
    requireSource(unique(seed.pricePlans.map((row) => `${row.pricePlanId}|${row.priceEntryId}`)));
    requireSource(unique(seed.allowances.map((row) => row.allowanceId)));
    for (const rule of seed.eligibilityRules) {
      requireSource(text(rule.ruleId) && ['include', 'exclude'].includes(rule.effect) && text(rule.matchField)
        && rule.operator === 'equals' && text(rule.value) && Array.isArray(rule.gradeIds)
        && rule.gradeIds.length > 0 && rule.gradeIds.every(text) && unique(rule.gradeIds));
    }
    for (const link of seed.schemeRuleLinks) {
      const rule = seed.eligibilityRules.find((row) => row.ruleId === link.ruleId);
      const scheme = knownScheme(link.schemeId);
      requireSource(text(link.linkId) && link.value === link.ruleId && rule && scheme
        && rule.gradeIds.every((grade) => scheme.gradeIds.includes(grade))
        && link.source === rule.source && link.sourceDate === rule.sourceDate && link.status === rule.status);
    }
    requireSource(seed.eligibilityRules.every((rule) => seed.schemeRuleLinks.some((link) => link.ruleId === rule.ruleId)));
    nonoverlapping(seed.schemeRuleLinks, (row) => JSON.stringify([row.schemeId, row.ruleId]));
    for (const price of seed.pricePlans) {
      requireSource(text(price.pricePlanId) && text(price.priceEntryId) && knownScheme(price.schemeId)
        && ((text(price.configurationId) && price.matchField === undefined && price.matchValue === undefined)
          || (price.configurationId === undefined && text(price.matchField) && text(price.matchValue)))
        && Number.isFinite(price.monthlyPoints)
        && price.monthlyPoints >= 0 && price.value === price.monthlyPoints && price.unit === 'points/month');
    }
    for (const allowance of seed.allowances) {
      const scheme = knownScheme(allowance.schemeId);
      requireSource(text(allowance.allowanceId) && scheme && scheme.companyId === allowance.companyId
        && scheme.gradeIds.includes(allowance.gradeId) && Number.isFinite(allowance.monthlyPoints)
        && allowance.monthlyPoints >= 0 && allowance.value === allowance.monthlyPoints && allowance.unit === 'points/month');
    }
    nonoverlapping(seed.pricePlans, (row) => JSON.stringify([row.schemeId, row.configurationId, row.matchField, row.matchValue]));
    nonoverlapping(seed.allowances, (row) => `${row.companyId}|${row.schemeId}|${row.gradeId}`);
  }
  return freeze(versions);
}

function rejectDuplicateJsonKeys(json) {
  const stack = [];
  for (const token of json.match(/"(?:\\.|[^"\\])*"|[{}\[\],:]/g) || []) {
    if (token === '{' || token === '[') stack.push(token === '{' ? { keys: new Set(), key: true } : null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && stack.at(-1)) stack.at(-1).key = true;
    else if (token.startsWith('"') && stack.at(-1)?.key) {
      const frame = stack.at(-1);
      const key = JSON.parse(token);
      requireSource(!frame.keys.has(key));
      frame.keys.add(key);
      frame.key = false;
    }
  }
}

export class FilePolicyProvider {
  #paths;
  #snapshot;

  constructor({ filePath = DEFAULT_FILE, retainedFilePaths = [] } = {}) {
    this.#paths = [filePath, ...retainedFilePaths];
  }

  async loadVersions() {
    if (this.#snapshot) return this.#snapshot;
    const seeds = [];
    for (const path of this.#paths) {
      let contents;
      try { contents = await readFile(path, 'utf8'); } catch { throw new PolicySourceError('source-unavailable'); }
      try {
        const seed = JSON.parse(contents);
        rejectDuplicateJsonKeys(contents);
        seeds.push(seed);
      } catch { throw new PolicySourceError('source-invalid'); }
    }
    this.#snapshot = snapshotVersions(seeds);
    return this.#snapshot;
  }
}
