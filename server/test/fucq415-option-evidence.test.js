import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scoreOptionEvidence, resetOptionEvidenceCache, optionEvidenceCacheStats } from '../scenarios/employee/option-evidence.js';
import { createEmployeeRecommendationService } from '../gcsp/recommendation/index.js';
import { scorePreferences } from '../scenarios/employee/index.js';
import { PolicyService } from '../gcsp/policy/index.js';
import { stock, fact, preference, context, providerValue, time, essential } from './helpers/employee-recommendation.js';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function pair() {
  return {
    policy: { rule: 'reviewedEquipment.v1', version: 'equipment-v1', importance: 100, halfSaturationWeight: 10,
      sliderStep: 2, unknownModelAnchor: 50, maximumAdjustment: 20,
      options: {
        A: { group: 'comfort', weight: 1, evidence: { comfort: 1 } },
        B: { group: 'comfort', weight: 2, evidence: { comfort: -2 } },
        C: { group: 'sport', weight: 1, evidence: { sportiness: 1 }, requiresActivation: true },
        D: { group: 'interior', weight: 1, evidence: { body: 'estate' } },
        E: { group: 'interior', weight: 1, evidence: { body: 'saloon' } },
        PACK: { group: 'pack', weight: 3, evidence: { comfort: 2, sportiness: 2 }, bundle: true },
        REPLACE: { group: 'replacement', weight: 1, evidence: { comfort: 3 } },
      },
      bundleFamilies: { technology: { groups: ['pack'], members: ['comfort', 'sport'] } },
      disabledBy: { A: ['REPLACE'] } },
    preferences: { sportiness: { type: 'slider' }, comfort: { type: 'slider' },
      body: { type: 'enum', values: ['estate', 'saloon'] } },
  };
}

const selection = (codes, extra = {}) => ({ kind: 'selected-catalogue', complete: true, codes, ...extra });
const mutableCopy = (value) => structuredClone(value);
const evidenceCodes = (result) => result.groups.flatMap((group) => group.codes).sort();

test('cached selected and verified evidence preserve replacement, bundles, enum values and completeness', () => {
  resetOptionEvidenceCache();
  const value = pair();
  const cachedPolicy = freeze(mutableCopy(value.policy));
  const cachedPreferences = freeze(mutableCopy(value.preferences));
  const input = selection(['PACK', 'E', 'C', 'B', 'A', 'D', 'UNKNOWN', 'B'], { activeCodes: ['C', 'C'] });
  const actual = scoreOptionEvidence(input, cachedPolicy, cachedPreferences);
  const expected = scoreOptionEvidence(mutableCopy(input), mutableCopy(value.policy), mutableCopy(value.preferences));
  assert.deepEqual(actual, expected);
  assert.equal(actual.version, 'equipment-v1');
  assert.equal(actual.complete, true);
  assert.deepEqual(actual.enumEvidence.body, ['estate', 'saloon']);
  assert.deepEqual(actual.groups.find((group) => group.group === 'comfort').codes, ['A', 'B']);
  assert.equal(actual.groups.some((group) => group.codes.includes('UNKNOWN')), false);

  const equivalent = scoreOptionEvidence(selection(['D', 'B', 'A', 'C', 'E', 'PACK', 'B', 'UNKNOWN'],
    { activeCodes: ['C'] }), cachedPolicy, cachedPreferences);
  assert.deepEqual(equivalent, actual);
  const replaced = scoreOptionEvidence(selection(['A', 'REPLACE']), cachedPolicy, cachedPreferences);
  assert.deepEqual(replaced, scoreOptionEvidence(selection(['A', 'REPLACE']), mutableCopy(value.policy), mutableCopy(value.preferences)));
  assert.deepEqual(evidenceCodes(replaced), ['REPLACE']);
  const inactive = scoreOptionEvidence(selection(['C']), cachedPolicy, cachedPreferences);
  assert.deepEqual(evidenceCodes(inactive), []);
  const active = scoreOptionEvidence(selection(['C'], { activeCodes: ['C'] }), cachedPolicy, cachedPreferences);
  assert.deepEqual(evidenceCodes(active), ['C']);
  const incomplete = scoreOptionEvidence(selection(['D'], { complete: false }), cachedPolicy, cachedPreferences);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.kind, 'selected-catalogue');
  const verified = scoreOptionEvidence({ ...selection(['D']), kind: 'verified-fitted' }, cachedPolicy, cachedPreferences);
  assert.equal(verified.kind, 'verified-fitted');
  assert.deepEqual(verified, scoreOptionEvidence({ ...selection(['D']), kind: 'verified-fitted' },
    mutableCopy(value.policy), mutableCopy(value.preferences)));
  assert.equal(scoreOptionEvidence(null, cachedPolicy, cachedPreferences), null);
  assert.equal(scoreOptionEvidence({ ...selection(['D']), kind: 'unknown' }, cachedPolicy, cachedPreferences), null);
  assert.equal(scoreOptionEvidence(selection(['D'], { activeCodes: ['C'] }), cachedPolicy, cachedPreferences), null);
  assert.equal(scoreOptionEvidence(selection(['D']), undefined, cachedPreferences), null);
  const stats = optionEvidenceCacheStats();
  assert.equal(stats.validations, 4);
  assert.equal(stats.derivations, 9);
  assert.equal(stats.hits, 1);
});

test('policy versions and same-version policy and preference content receive separate admissions', () => {
  resetOptionEvidenceCache();
  const original = pair();
  const changedPolicy = pair(); changedPolicy.policy.options.D.weight = 3;
  const changedPreferences = pair(); changedPreferences.preferences.body.values.push('coupe');
  const changedVersion = pair(); changedVersion.policy.version = 'equipment-v2';
  const inputs = [original, changedPolicy, changedPreferences, changedVersion].map((value) => ({
    policy: freeze(value.policy), preferences: freeze(value.preferences),
  }));
  const outputs = inputs.map((value) => scoreOptionEvidence(selection(['D']), value.policy, value.preferences));
  assert.equal(outputs[0].totalWeight, 1);
  assert.equal(outputs[1].totalWeight, 3);
  assert.deepEqual(outputs[0], outputs[2]);
  assert.equal(outputs[3].version, 'equipment-v2');
  assert.deepEqual({ ...outputs[3], version: 'equipment-v1' }, outputs[0]);
  assert.equal(optionEvidenceCacheStats().validations, 4);
  assert.equal(optionEvidenceCacheStats().derivations, 4);
  assert.equal(optionEvidenceCacheStats().hits, 0);
});

test('shallow-frozen roots with mutable descendants stay uncached and revalidate edits', () => {
  resetOptionEvidenceCache();
  const value = pair();
  Object.freeze(value.policy);
  Object.freeze(value.preferences);
  const before = scoreOptionEvidence(selection(['A']), value.policy, value.preferences);
  value.policy.options.A.evidence.comfort = 3;
  const afterPolicyEdit = scoreOptionEvidence(selection(['A']), value.policy, value.preferences);
  assert.notEqual(before.adjustment.comfort, afterPolicyEdit.adjustment.comfort);
  value.preferences.body.values[0] = 'coupe';
  assert.throws(() => scoreOptionEvidence(selection(['D']), value.policy, value.preferences), /Invalid recommendation option/);
  const stats = optionEvidenceCacheStats();
  assert.equal(stats.validations, 3);
  assert.equal(stats.hits, 0);
  assert.equal(stats.admissionSize, 0);
});

test('frozen accessors, custom prototypes and non-JSON graph values never enter either cache', () => {
  resetOptionEvidenceCache();
  const variants = [
    (value) => Object.defineProperty(value.policy, 'version', { enumerable: true, get: () => 'equipment-v1' }),
    (value) => { value.policy = Object.assign(Object.create({ custom: true }), value.policy); },
    (value) => { value.policy.extra = undefined; },
    (value) => { value.policy.extra = Infinity; },
    (value) => { value.policy.extra = 1n; },
    (value) => { value.policy.extra = Symbol('extra'); },
    (value) => Object.defineProperty(value.policy, 'hidden', { value: true }),
    (value) => { value.policy.extra = Array(1); },
  ];
  for (const alter of variants) {
    const value = pair(); alter(value); freeze(value.policy); freeze(value.preferences);
    const first = scoreOptionEvidence(selection(['A']), value.policy, value.preferences);
    const again = scoreOptionEvidence(selection(['A']), value.policy, value.preferences);
    assert.deepEqual(again, first);
  }
  const stats = optionEvidenceCacheStats();
  assert.equal(stats.validations, variants.length * 2);
  assert.equal(stats.hits, 0);
  assert.equal(stats.admissionSize, 0);
});

test('primitive preference inputs retain the uncached numeric evidence behavior', () => {
  resetOptionEvidenceCache();
  const value = pair(); delete value.policy.options.D; delete value.policy.options.E;
  for (const preferences of [1, true, 'preferences']) {
    const expected = scoreOptionEvidence(selection(['A']), mutableCopy(value.policy), preferences);
    const actual = scoreOptionEvidence(selection(['A']), freeze(mutableCopy(value.policy)), preferences);
    assert.deepEqual(actual, expected);
    assert.deepEqual(actual.adjustment, {});
  }
  assert.equal(optionEvidenceCacheStats().validations, 6);
  assert.equal(optionEvidenceCacheStats().admissionSize, 0);
});

test('malformed mutable policies can be corrected without stale admissions', () => {
  resetOptionEvidenceCache();
  const value = pair(); value.policy.options.A.weight = 9;
  assert.throws(() => scoreOptionEvidence(selection(['A']), value.policy, value.preferences), /Invalid recommendation option/);
  value.policy.options.A.weight = 2;
  const result = scoreOptionEvidence(selection(['A']), value.policy, value.preferences);
  assert.equal(result.totalWeight, 2);
  assert.equal(optionEvidenceCacheStats().validations, 2);
  assert.equal(optionEvidenceCacheStats().derivations, 1);
});

test('both cached paths return detached nested evidence and reset invalidates weak and bounded state', () => {
  resetOptionEvidenceCache();
  const value = pair(); const policy = freeze(value.policy); const preferences = freeze(value.preferences);
  const input = selection(['D', 'E']);
  const first = scoreOptionEvidence(input, policy, preferences);
  first.groups[0].codes.push('CORRUPTED'); first.enumEvidence.body[0] = 'corrupted';
  const second = scoreOptionEvidence(input, policy, preferences);
  assert.deepEqual(second.groups[0].codes, ['D', 'E']);
  assert.deepEqual(second.enumEvidence.body, ['estate', 'saloon']);
  second.groups[0].evidence.body = 100;
  const third = scoreOptionEvidence(input, policy, preferences);
  assert.deepEqual(third.groups[0].evidence, {});
  resetOptionEvidenceCache();
  assert.deepEqual(optionEvidenceCacheStats(), { validations: 0, derivations: 0, hits: 0, evictions: 0,
    admissionEvictions: 0, size: 0, admissionSize: 0, limits: { results: 256, admissions: 8 } });
  scoreOptionEvidence(input, policy, preferences);
  assert.equal(optionEvidenceCacheStats().validations, 1);
  assert.equal(optionEvidenceCacheStats().derivations, 1);
});

test('result LRU evicts the 257th distinct signature and recomputes after eviction and reset', () => {
  resetOptionEvidenceCache();
  const value = pair(); const policy = freeze(value.policy); const preferences = freeze(value.preferences);
  const signatures = Array.from({ length: 257 }, (_, index) => selection([`X${String(index).padStart(3, '0')}`]));
  for (const input of signatures) scoreOptionEvidence(input, policy, preferences);
  assert.deepEqual({ ...optionEvidenceCacheStats(), limits: undefined }, {
    validations: 1, derivations: 257, hits: 0, evictions: 1, admissionEvictions: 0,
    size: 256, admissionSize: 1, limits: undefined,
  });
  scoreOptionEvidence(signatures[0], policy, preferences);
  assert.equal(optionEvidenceCacheStats().derivations, 258);
  assert.equal(optionEvidenceCacheStats().evictions, 2);
  scoreOptionEvidence(signatures[256], policy, preferences);
  assert.equal(optionEvidenceCacheStats().hits, 1);
  resetOptionEvidenceCache();
  scoreOptionEvidence(signatures[0], policy, preferences);
  assert.equal(optionEvidenceCacheStats().validations, 1);
  assert.equal(optionEvidenceCacheStats().derivations, 1);
});

test('admission LRU stays bounded and revalidates content after its entry is evicted', () => {
  resetOptionEvidenceCache();
  const inputs = Array.from({ length: 9 }, (_, index) => {
    const value = pair(); value.policy.halfSaturationWeight = index + 10;
    return { policy: freeze(value.policy), preferences: freeze(value.preferences) };
  });
  for (const value of inputs) scoreOptionEvidence(selection(['A']), value.policy, value.preferences);
  assert.equal(optionEvidenceCacheStats().admissionSize, 8);
  assert.equal(optionEvidenceCacheStats().admissionEvictions, 1);
  scoreOptionEvidence(selection(['A']), inputs[0].policy, inputs[0].preferences);
  assert.equal(optionEvidenceCacheStats().validations, 10);
  assert.equal(optionEvidenceCacheStats().admissionSize, 8);
});

test('recommendation reuses detached policy reads while preserving selection certainty and employee preferences', async () => {
  resetOptionEvidenceCache();
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const policy = new PolicyService({ provider: { async loadVersions() { return [seed]; } } });
  const option = (codes, complete = true) => ({ kind: 'selected-catalogue', complete, codes });
  const cars = [
    stock(101, { optionSelection: fact(option(['S0459'])) }, 'same-configuration'),
    stock(102, { optionSelection: fact(option(['S04HA'])) }, 'same-configuration'),
    stock(103, { optionSelection: fact(null) }, 'same-configuration'),
    stock(104, { optionSelection: fact(option(['S0459'])) }, 'distinct-configuration'),
    stock(105, { optionSelection: fact(option(['S0459'], false)) }, 'incomplete-configuration'),
  ];
  const service = createEmployeeRecommendationService({
    provider: { async resolve(subject) {
      const value = structuredClone(providerValue(cars)); value.employeeId = subject.employeeId;
      return { status: 'ok', value };
    } }, policy, time,
  });
  const request = (desired) => ({ schemaVersion: 1, briefVersion: 1,
    preferences: { comfort: preference(desired) }, essentials: { seats: essential(5) } });
  const first = await service.recommend(context, request(100));
  assert.equal(first.status, 'ok', JSON.stringify(first));
  const rows = first.value.decisions;
  const component = (row) => row.components.find((entry) => entry.field === 'comfort');
  assert.deepEqual(component(rows[0]).optionEvidence.groups.flatMap((group) => group.codes), ['S0459']);
  assert.deepEqual(component(rows[1]).optionEvidence.groups.flatMap((group) => group.codes), ['S04HA']);
  assert.equal(Object.hasOwn(component(rows[2]), 'optionEvidence'), false);
  assert.equal(new Set(rows.slice(0, 3).map((row) => row.configurationId)).size, 1);
  assert.deepEqual(component(rows[3]).optionEvidence, component(rows[0]).optionEvidence);
  assert.equal(rows[0].components.some((entry) => entry.field === 'wellSpecified'), true);
  assert.equal(rows[4].components.some((entry) => entry.field === 'wellSpecified'), false);
  assert.deepEqual(component(rows[4]).optionEvidence, component(rows[0]).optionEvidence);
  const afterFirst = optionEvidenceCacheStats();
  assert.equal(afterFirst.validations, 1);
  assert.equal(afterFirst.derivations, 3);
  assert.equal(afterFirst.hits, 1);

  const otherEmployee = { ...context, employeeId: 'employee-other' };
  const second = await service.recommend(otherEmployee, request(0));
  assert.equal(second.status, 'ok', JSON.stringify(second));
  assert.equal(component(second.value.decisions[0]).desired, 0);
  assert.equal(component(first.value.decisions[0]).desired, 100);
  assert.notEqual(first.value.decisions[0].score, second.value.decisions[0].score);
  assert.equal(optionEvidenceCacheStats().validations, 1);
  assert.equal(optionEvidenceCacheStats().derivations, 3);
  assert.equal(optionEvidenceCacheStats().hits, 5);

  cars[0] = stock(101, { optionSelection: fact(option(['S0459']), null, 'derived') }, 'same-configuration');
  const changedCertainty = await service.recommend({ ...context, employeeId: 'employee-third' }, request(100));
  assert.equal(changedCertainty.status, 'ok', JSON.stringify(changedCertainty));
  assert.equal(Object.hasOwn(component(changedCertainty.value.decisions[0]), 'optionEvidence'), false);
  assert.equal(optionEvidenceCacheStats().validations, 1);
  assert.equal(optionEvidenceCacheStats().derivations, 3);
  assert.equal(optionEvidenceCacheStats().hits, 8);
});

test('immutable and mutable paths preserve complete scoring, explanations and unknowns', async () => {
  resetOptionEvidenceCache();
  const seed = JSON.parse(await readFile(new URL('../gcsp/policy/seed-v1.json', import.meta.url), 'utf8'));
  const config = seed.assumptions.find((row) => row.key === 'employee.recommendation.v1').value;
  const immutable = freeze(mutableCopy(config));
  const brief = { preferences: { comfort: preference(100), sportiness: preference(30) } };
  const employeeFacts = providerValue([]).employeeFacts;
  for (const complete of [true, false]) {
    for (const assurance of ['synthetic-scenario', 'derived']) {
      const snapshot = stock(200, { optionSelection: fact(selection(['S0459']), null, assurance),
        zeroTo62: fact(null, 's') }).snapshot;
      const input = structuredClone(snapshot);
      input.facts.optionSelection.value.complete = complete;
      const expected = scorePreferences(input, brief, employeeFacts, mutableCopy(config), { minimum: 0, maximum: 100 });
      const actual = scorePreferences(input, brief, employeeFacts, immutable, { minimum: 0, maximum: 100 });
      assert.deepEqual(actual, expected);
      assert.deepEqual(scorePreferences(input, brief, employeeFacts, immutable, { minimum: 0, maximum: 100 }), expected);
    }
  }
});
