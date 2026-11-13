import { AsyncLocalStorage } from 'node:async_hooks';
import { FilePolicyProvider, PolicySourceError, snapshotVersions, validInstant } from './file-provider.js';
import { PostgresPolicyProvider } from './postgres-provider.js';
import { publishPolicyVersion } from './publish.js';
import { adoptReviewedAssumptions, refreshEmployeeExperience } from './adoption.js';
import { cloneJson } from '../repository/core.js';

export { FilePolicyProvider } from './file-provider.js';
export { PostgresPolicyProvider } from './postgres-provider.js';
export { MemoryPolicyProvider, createMemoryPolicyStore } from './memory-provider.js';
const CONTRACT_VERSION = '1.0.0';
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const activeAt = (row, instant) => Date.parse(row.effectiveFrom) <= instant
  && (row.effectiveTo === undefined || instant < Date.parse(row.effectiveTo));
const outcome = (status, policyVersion, fields) => ({ status, ...cloneJson(fields), contractVersion: CONTRACT_VERSION, policyVersion });
const invalid = (policyVersion, code, field, reason) => outcome('invalid', policyVersion, { code, reasons: [{ field, reason }] });
const ok = (version, value) => outcome('ok', version, { value });

function compileEligibility(resolved) {
  const assumptions = new Map(resolved.rows('assumptions').map((row) => [row.key, row]));
  const field = assumptions.get('eligibility.rule.matchField');
  const precedence = assumptions.get('eligibility.rule.precedence');
  const mapping = assumptions.get('eligibility.context.mapping');
  const schemes = new Map(); const linksByRule = new Map();
  const links = resolved.rows('schemeRuleLinks');
  for (const link of links) {
    if (!schemes.has(link.schemeId)) schemes.set(link.schemeId, { grades: new Map(), unsupported: false });
    if (!linksByRule.has(link.ruleId)) linksByRule.set(link.ruleId, []);
    linksByRule.get(link.ruleId).push(link);
  }
  const cellsByLink = new Map();
  // Rule order and link order are independent provenance contracts.
  for (const rule of resolved.rows('eligibilityRules')) {
    for (const link of linksByRule.get(rule.ruleId) ?? []) {
      const scheme = schemes.get(link.schemeId);
      const cells = []; cellsByLink.set(link, cells);
      if (rule.matchField !== field?.value || rule.operator !== 'equals') scheme.unsupported = true;
      for (const grade of rule.gradeIds) {
        if (!scheme.grades.has(grade)) scheme.grades.set(grade, new Map());
        const models = scheme.grades.get(grade);
        if (!models.has(rule.value)) models.set(rule.value, { rules: [], links: [], excluded: false, included: false });
        const cell = models.get(rule.value);
        cell.rules.push(rule);
        cell.excluded ||= rule.effect === 'exclude'; cell.included ||= rule.effect === 'include';
        cells.push(cell);
      }
    }
  }
  for (const link of links) {
    for (const cell of cellsByLink.get(link) ?? []) cell.links.push(link);
  }
  return { field, precedence, mapping, schemes };
}

function compilePrices(resolved) {
  const schemes = new Map();
  for (const row of resolved.rows('pricePlans')) {
    if (!schemes.has(row.schemeId)) schemes.set(row.schemeId, new Map());
    const fields = schemes.get(row.schemeId);
    const field = row.configurationId !== undefined ? 'configurationId' : row.matchField;
    const value = row.configurationId !== undefined ? row.configurationId : row.matchValue;
    if (!fields.has(field)) fields.set(field, new Map());
    const values = fields.get(field);
    const cell = values.get(value) ?? { row, count: 0 };
    cell.count += 1; values.set(value, cell);
  }
  return schemes;
}

export class PolicyService {
  #provider;
  #identity; #clock; #repository;
  #snapshots = new WeakMap(); #pinnedRows = new WeakMap();
  #eligibilityIndexes = new WeakMap(); #priceIndexes = new WeakMap();
  #readScopes = new AsyncLocalStorage();

  constructor({ provider = new FilePolicyProvider(), identity, clock, repository } = {}) {
    this.#provider = provider;
    this.#identity = identity; this.#clock = clock; this.#repository = repository;
  }

  // A scope shares immutable pins only; active-version discovery always reaches the provider.
  withReadScope(work) {
    return this.#readScopes.getStore() ? work() : this.#readScopes.run(new Map(), work);
  }

  async #loadVersions(read) {
    const supplied = await this.#provider.loadVersions(read);
    let versions = this.#snapshots.get(supplied);
    if (!versions) {
      versions = snapshotVersions(supplied);
      this.#snapshots.set(supplied, versions);
    }
    return versions;
  }

  async #resolve(read) {
    if (!read || !text(read.runId) || !validInstant(read.asOf)
      || (Object.hasOwn(read, 'policyVersion') && !text(read.policyVersion))) {
      return { error: invalid(null, 'invalid-read', 'read', 'Supply runId, ISO asOf and an optional nonempty policyVersion.') };
    }
    let versions;
    try {
      const scope = Object.hasOwn(read, 'policyVersion') && this.#readScopes.getStore();
      const key = scope && JSON.stringify([read.runId, read.policyVersion]);
      if (scope && !scope.has(key)) scope.set(key, this.#loadVersions(read));
      const loading = scope ? scope.get(key) : this.#loadVersions(read);
      versions = await loading;
      // A missing pin may be published later, so only found immutable versions retain reuse.
      if (scope && scope.get(key) === loading && !versions.some((version) => version.policyVersion === read.policyVersion)) scope.delete(key);
    } catch (error) {
      return { error: outcome(error instanceof PolicySourceError && error.code === 'source-invalid' ? 'invalid' : 'unavailable', null, {
        code: error instanceof PolicySourceError ? error.code : 'source-unavailable',
        ...(error instanceof PolicySourceError && error.code === 'source-invalid' ? {} : {
          reason: 'The policy source is unavailable.', retryable: true,
        }),
        reasons: [{ field: 'source', reason: 'The policy source could not be loaded and validated.' }],
      }) };
    }
    const pinned = Object.hasOwn(read, 'policyVersion');
    const instant = Date.parse(read.asOf);
    const seed = pinned ? versions.find((version) => version.policyVersion === read.policyVersion)
      : versions.filter((version) => activeAt(version, instant)).sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom))[0];
    if (!seed) return { error: outcome('not-found', null, { code: 'policy-version-not-found', resourceType: 'policy-version', reasons: [{ field: 'policyVersion', reason: 'No matching retained policy version.' }] }) };
    // A pin preserves the rows effective when that immutable version began, including after their expiry.
    const at = pinned ? Date.parse(seed.effectiveFrom) : instant;
    if (!pinned) return { seed, at, rows: (table) => seed[table].filter((row) => activeAt(row, at)) };
    // A pinned version's effective rows never change, so each table is filtered once (read-only to callers).
    const cache = this.#pinnedRows.get(seed) ?? new Map(); this.#pinnedRows.set(seed, cache);
    return { seed, at, rows: (table) => { if (!cache.has(table)) cache.set(table, seed[table].filter((row) => activeAt(row, at))); return cache.get(table); } };
  }

  #context(context, read, resolved) {
    const version = resolved.seed.policyVersion;
    if (!context || typeof context !== 'object' || Array.isArray(context)) return invalid(version, 'invalid-context', 'context', 'Supply a company, scheme and grade.');
    if (Object.hasOwn(context, 'runId') && context.runId !== read.runId) return invalid(version, 'run-mismatch', 'runId', 'Context and policy read must use the same run.');
    const mapping = resolved.rows('assumptions').find(({ key }) => key === 'eligibility.context.mapping');
    if (!mapping) return invalid(version, 'policy-configuration-unavailable', 'eligibility.context.mapping', 'The context mapping is not effective.');
    const scheme = mapping.value.find((row) => row.schemeId === context.schemeId);
    if (!scheme) return invalid(version, 'unknown-scheme', 'schemeId', 'Unknown scheme.');
    if (scheme.companyId !== context.companyId) return invalid(version, 'unknown-company', 'companyId', 'Company is not mapped to this scheme.');
    if (!scheme.gradeIds.includes(context.gradeId)) return invalid(version, 'unknown-grade', 'gradeId', 'Grade is not mapped to this scheme.');
    return null;
  }

  // Trusted server composition only; never serialize this seed through an HTTP route.
  async getPolicySnapshot(read) {
    const resolved = await this.#resolve(read);
    if (resolved.error) return resolved.error;
    const snapshot = ok(resolved.seed.policyVersion, resolved.seed);
    const freeze = (value) => {
      if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
      return value;
    };
    return freeze(snapshot);
  }

  async getActiveVersion(read) {
    const resolved = await this.#resolve(read);
    if (resolved.error) return resolved.error;
    const { policyVersion, effectiveFrom, effectiveTo, source } = resolved.seed;
    return ok(policyVersion, { policyVersion, effectiveFrom, ...(effectiveTo === undefined ? {} : { effectiveTo }), source });
  }

  async getAssumption(key, read) {
    const resolved = await this.#resolve(read);
    if (resolved.error) return resolved.error;
    const row = resolved.rows('assumptions').find((entry) => entry.key === key);
    return row ? ok(resolved.seed.policyVersion, row)
      : invalid(resolved.seed.policyVersion, 'unknown-assumption', 'key', 'Unknown or ineffective assumption key.');
  }

  async getAllowance(context, read) {
    const resolved = await this.#resolve(read);
    if (resolved.error) return resolved.error;
    const error = this.#context(context, read, resolved);
    if (error) return error;
    const row = resolved.rows('allowances').find((entry) => entry.companyId === context.companyId
      && entry.schemeId === context.schemeId && entry.gradeId === context.gradeId);
    return row ? ok(resolved.seed.policyVersion, row)
      : outcome('not-found', resolved.seed.policyVersion, { code: 'allowance-not-found', resourceType: 'allowance', reasons: [{ field: 'allowance', reason: 'No effective allowance for this context.' }] });
  }

  async getPointsCost(context, car, read) {
    const resolved = await this.#resolve(read);
    if (resolved.error) return resolved.error;
    const error = this.#context(context, read, resolved);
    if (error) return error;
    const fields = this.#priceIndex(resolved).get(context.schemeId);
    let row; let count = 0;
    if (car && fields) {
      for (const [field, values] of fields) {
        const match = Object.hasOwn(car, field) ? values.get(car[field]) : undefined;
        if (match) { row = match.row; count += match.count; }
      }
    }
    if (count > 1) return invalid(resolved.seed.policyVersion, 'ambiguous-price', 'car', 'Multiple effective prices match the supplied car facts.');
    return row ? ok(resolved.seed.policyVersion, row)
      : outcome('not-found', resolved.seed.policyVersion, { code: 'price-not-found', resourceType: 'price', reasons: [{ field: 'car', reason: 'No exact effective monthly points price.' }] });
  }

  async getEligibility(context, car, read) {
    const resolved = await this.#resolve(read);
    if (resolved.error) return resolved.error;
    const error = this.#context(context, read, resolved);
    if (error) return error;
    const version = resolved.seed.policyVersion;
    const compiled = this.#eligibilityIndex(resolved);
    const { field, precedence, mapping } = compiled;
    if (!field || !text(field.value) || precedence?.value !== 'excludeThenInclude') {
      return invalid(version, 'unsupported-rule-selection', 'eligibility.rule', 'Unsupported or ineffective rule field/precedence selection.');
    }
    const scheme = compiled.schemes.get(context.schemeId);
    if (scheme?.unsupported) {
      return invalid(version, 'unsupported-rule-selection', 'eligibility.rule.matchField', 'The selected field does not match the scheme rules.');
    }
    const fact = car && Object.hasOwn(car, field.value) ? car[field.value] : undefined;
    const match = text(fact) ? scheme?.grades.get(context.gradeId)?.get(fact) : undefined;
    const matches = match?.rules ?? [];
    const excluded = match?.excluded ?? false;
    const eligible = !excluded && (match?.included ?? false);
    const state = excluded ? 'ineligible' : eligible ? 'eligible' : 'needs-confirmation';
    return ok(version, {
      eligible, state, ruleIds: matches.map((rule) => rule.ruleId),
      reasons: [excluded ? 'explicit-exclude' : eligible ? 'explicit-include' : text(fact) ? 'no-applicable-include' : 'missing-model-fact'],
      provenance: { rules: matches, schemeRuleLinks: match?.links ?? [], assumptions: [field, precedence, mapping] },
    });
  }

  #priceIndex(resolved) {
    const { seed, at } = resolved;
    let cache = this.#priceIndexes.get(seed);
    if (!cache) {
      const boundaries = new Set();
      for (const row of seed.pricePlans) {
        boundaries.add(Date.parse(row.effectiveFrom));
        if (row.effectiveTo !== undefined) boundaries.add(Date.parse(row.effectiveTo));
      }
      cache = { boundaries: [...boundaries].sort((a, b) => a - b), intervals: new Map() };
      this.#priceIndexes.set(seed, cache);
    }
    let low = 0; let high = cache.boundaries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (cache.boundaries[mid] <= at) low = mid + 1; else high = mid;
    }
    if (!cache.intervals.has(low)) cache.intervals.set(low, compilePrices(resolved));
    return cache.intervals.get(low);
  }

  #eligibilityIndex(resolved) {
    const { seed, at } = resolved;
    let cache = this.#eligibilityIndexes.get(seed);
    if (!cache) {
      // Finite row boundaries bound the cache and preserve unpinned asOf changes within a version.
      const boundaries = new Set();
      for (const table of ['assumptions', 'schemeRuleLinks', 'eligibilityRules']) {
        for (const row of seed[table]) {
          boundaries.add(Date.parse(row.effectiveFrom));
          if (row.effectiveTo !== undefined) boundaries.add(Date.parse(row.effectiveTo));
        }
      }
      cache = { boundaries: [...boundaries].sort((a, b) => a - b), intervals: new Map() };
      this.#eligibilityIndexes.set(seed, cache);
    }
    let low = 0; let high = cache.boundaries.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (cache.boundaries[mid] <= at) low = mid + 1; else high = mid;
    }
    if (!cache.intervals.has(low)) cache.intervals.set(low, compileEligibility(resolved));
    return cache.intervals.get(low);
  }

  withPublicationPorts({ identity, clock, repository } = {}) {
    const facade = new PolicyService({ provider: this.#provider, identity, clock, repository });
    facade.#readScopes = this.#readScopes;
    return facade;
  }

  async adoptReviewedAssumptions(context, input) {
    return adoptReviewedAssumptions({ provider: this.#provider, identity: this.#identity, clock: this.#clock,
      repository: this.#repository, policy: this }, context, input);
  }

  async refreshEmployeeExperience(context, input) {
    return refreshEmployeeExperience({ provider: this.#provider, identity: this.#identity, clock: this.#clock,
      repository: this.#repository, policy: this }, context, input);
  }

  async publishPolicyVersion(context, changeSet) {
    return publishPolicyVersion({ provider: this.#provider, identity: this.#identity, clock: this.#clock }, context, changeSet);
  }

  async close() { return this.#provider?.close?.() ?? ok(null, { closed: true }); }
}

export function createPolicyService({ provider, identity, clock, repository, ...options } = {}) {
  const explicitFile = Object.hasOwn(options, 'filePath') || Object.hasOwn(options, 'retainedFilePaths');
  const configured = Object.hasOwn(options, 'connectionString') || Object.hasOwn(options, 'pool') || Object.hasOwn(process.env, 'GCSP_DATABASE_URL');
  const selected = provider === undefined ? configured && !explicitFile ? new PostgresPolicyProvider(options) : new FilePolicyProvider(options) : provider;
  return new PolicyService({ provider: selected, identity, clock, repository });
}
