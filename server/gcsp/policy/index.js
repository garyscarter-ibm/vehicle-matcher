import { FilePolicyProvider, PolicySourceError, snapshotVersions, validInstant } from './file-provider.js';
import { PostgresPolicyProvider } from './postgres-provider.js';
import { publishPolicyVersion } from './publish.js';
import { adoptReviewedAssumptions } from './adoption.js';
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

export class PolicyService {
  #provider;
  #identity; #clock; #repository;
  #snapshots = new WeakMap(); #pinnedRows = new WeakMap();

  constructor({ provider = new FilePolicyProvider(), identity, clock, repository } = {}) {
    this.#provider = provider;
    this.#identity = identity; this.#clock = clock; this.#repository = repository;
  }

  async #resolve(read) {
    if (!read || !text(read.runId) || !validInstant(read.asOf)
      || (Object.hasOwn(read, 'policyVersion') && !text(read.policyVersion))) {
      return { error: invalid(null, 'invalid-read', 'read', 'Supply runId, ISO asOf and an optional nonempty policyVersion.') };
    }
    let versions;
    try {
      const supplied = await this.#provider.loadVersions(read);
      versions = this.#snapshots.get(supplied);
      if (!versions) {
        versions = snapshotVersions(supplied);
        this.#snapshots.set(supplied, versions);
      }
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
    if (!pinned) return { seed, rows: (table) => seed[table].filter((row) => activeAt(row, at)) };
    // A pinned version's effective rows never change, so each table is filtered once (read-only to callers).
    const cache = this.#pinnedRows.get(seed) ?? new Map(); this.#pinnedRows.set(seed, cache);
    return { seed, rows: (table) => { if (!cache.has(table)) cache.set(table, seed[table].filter((row) => activeAt(row, at))); return cache.get(table); } };
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
    const rows = resolved.rows('pricePlans').filter((entry) => entry.schemeId === context.schemeId);
    const matches = rows.filter((entry) => car && (entry.configurationId !== undefined
      ? Object.hasOwn(car, 'configurationId') && car.configurationId === entry.configurationId
      : Object.hasOwn(car, entry.matchField) && car[entry.matchField] === entry.matchValue));
    if (matches.length > 1) return invalid(resolved.seed.policyVersion, 'ambiguous-price', 'car', 'Multiple effective prices match the supplied car facts.');
    const [row] = matches;
    return row ? ok(resolved.seed.policyVersion, row)
      : outcome('not-found', resolved.seed.policyVersion, { code: 'price-not-found', resourceType: 'price', reasons: [{ field: 'car', reason: 'No exact effective monthly points price.' }] });
  }

  async getEligibility(context, car, read) {
    const resolved = await this.#resolve(read);
    if (resolved.error) return resolved.error;
    const error = this.#context(context, read, resolved);
    if (error) return error;
    const version = resolved.seed.policyVersion;
    const assumptions = resolved.rows('assumptions');
    const field = assumptions.find(({ key }) => key === 'eligibility.rule.matchField');
    const precedence = assumptions.find(({ key }) => key === 'eligibility.rule.precedence');
    if (!field || !text(field.value) || precedence?.value !== 'excludeThenInclude') {
      return invalid(version, 'unsupported-rule-selection', 'eligibility.rule', 'Unsupported or ineffective rule field/precedence selection.');
    }
    const links = resolved.rows('schemeRuleLinks').filter((row) => row.schemeId === context.schemeId);
    const linked = new Set(links.map((link) => link.ruleId));
    const rules = resolved.rows('eligibilityRules').filter((rule) => linked.has(rule.ruleId));
    if (rules.some((rule) => rule.matchField !== field.value || rule.operator !== 'equals')) {
      return invalid(version, 'unsupported-rule-selection', 'eligibility.rule.matchField', 'The selected field does not match the scheme rules.');
    }
    const fact = car && Object.hasOwn(car, field.value) ? car[field.value] : undefined;
    const matches = text(fact) ? rules.filter((rule) => rule.value === fact && rule.gradeIds.includes(context.gradeId)) : [];
    const excluded = matches.some((rule) => rule.effect === 'exclude');
    const eligible = !excluded && matches.some((rule) => rule.effect === 'include');
    const state = excluded ? 'ineligible' : eligible ? 'eligible' : 'needs-confirmation';
    return ok(version, {
      eligible, state, ruleIds: matches.map((rule) => rule.ruleId),
      reasons: [excluded ? 'explicit-exclude' : eligible ? 'explicit-include' : text(fact) ? 'no-applicable-include' : 'missing-model-fact'],
      provenance: { rules: matches, schemeRuleLinks: links.filter((link) => matches.some((rule) => rule.ruleId === link.ruleId)), assumptions: [field, precedence, assumptions.find(({ key }) => key === 'eligibility.context.mapping')] },
    });
  }

  withPublicationPorts({ identity, clock, repository } = {}) {
    return new PolicyService({ provider: this.#provider, identity, clock, repository });
  }

  async adoptReviewedAssumptions(context, input) {
    return adoptReviewedAssumptions({ provider: this.#provider, identity: this.#identity, clock: this.#clock,
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
