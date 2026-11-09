import { createHash } from 'node:crypto';
import { loadComparisonPolicy, generateComparisonInputs } from '../../comparison/generator.js';
import { validInstant } from '../../policy/file-provider.js';
import { freezeVehicleData } from '../../../vehicles/index.js';
import { evaluateEssentials, scorePreferences } from '../../../scenarios/employee/index.js';
import { projectBriefIntent, SYNTHETIC_DECLINE_TYPE, unknown, validateLearningRecord } from './schema.js';
import { inputDigest } from '../../repository/index.js';

export const LEARNING_GENERATOR_VERSION = 'learning-records.sha256.v1';
export const LEARNING_KEYS = Object.freeze(['learning.cohortSize', 'learning.cycles', 'learning.cycleSpacingDays',
  'learning.maximumGeneratedRecords', 'learning.maximumChoiceEntries', 'learning.noChoiceRate', 'learning.response.v1']);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 512;
const exact = (v, fields) => object(v) && Object.keys(v).length === fields.length && fields.every((field) => Object.hasOwn(v, field));
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const probability = (v) => Number.isFinite(v) && v >= 0 && v <= 1;
const known = (value) => ({ status: 'known', value });
const event = (state = 'unknown', at = null) => ({ state, at });
const iso = (v) => new Date(v).toISOString();
const key = (context, configurationId) => JSON.stringify([context.companyId, context.schemeId, context.gradeId, configurationId]);
const values = (snapshot) => Object.fromEntries(Object.entries(snapshot.assumptions).map(([k, row]) => [k, row.value]));
export class LearningInputError extends Error {
  constructor(code, field) { super(`Learning input ${code}: ${field}.`); this.name = 'LearningInputError'; this.code = code; this.field = field; }
}
const requireInput = (valid, field, code = 'invalid-policy') => { if (!valid) throw new LearningInputError(code, field); };
const draw = (seed, ...path) => parseInt(createHash('sha256').update(JSON.stringify([LEARNING_GENERATOR_VERSION, seed, ...path])).digest('hex').slice(0, 8), 16) / 0x100000000;
const reference = (seed, ...path) => inputDigest([LEARNING_GENERATOR_VERSION, seed, ...path]);

function bounds(snapshot) {
  requireInput(exact(snapshot?.assumptions, LEARNING_KEYS) && Object.values(snapshot.assumptions).every(object), 'snapshot', 'policy-unavailable');
  const v = values(snapshot);
  requireInput(LEARNING_KEYS.slice(0, 5).every((k) => positive(v[k])), 'learning.bounds');
  const records = v['learning.cohortSize'] * v['learning.cycles'];
  requireInput(Number.isSafeInteger(records) && records <= v['learning.maximumGeneratedRecords'], 'learning.maximumGeneratedRecords', 'record-bound');
  const ratio = snapshot.comparison?.assumptions?.['comparison.carsPerEmployee']?.value;
  requireInput(Number.isFinite(ratio) && ratio >= 0, 'comparison.carsPerEmployee');
  const stock = Math.round(v['learning.cohortSize'] * ratio);
  requireInput(Number.isSafeInteger(stock) && Number.isSafeInteger(records * stock)
    && records * stock <= v['learning.maximumChoiceEntries'], 'learning.maximumChoiceEntries', 'choice-bound');
  requireInput(probability(v['learning.noChoiceRate']), 'learning.noChoiceRate');
  const response = v['learning.response.v1'];
  requireInput(object(response) && Object.keys(response).sort().join(',') === 'declineRate,expiryRate,selectionAfterAcceptRate,utilityNoise'
    && Object.values(response).every(probability) && response.declineRate + response.expiryRate <= 1, 'learning.response.v1');
  const start = Date.parse(snapshot.comparison?.assumptions?.['comparison.startsAt']?.value);
  const horizon = snapshot.comparison?.assumptions?.['comparison.horizonDays']?.value;
  const finalEnd = start + ((v['learning.cycles'] - 1) * v['learning.cycleSpacingDays'] + horizon) * 86400000;
  const comparisonValues = Object.fromEntries(Object.entries(snapshot.comparison.assumptions).map(([k, row]) => [k, row.value]));
  const groups = comparisonValues['comparison.accessGroups'];
  const maximumOffset = Array.isArray(groups) ? Math.max(...groups.map((group) => group.accessSeconds.max + group.responseSeconds.max),
    comparisonValues['employee.recommendation.v1']?.termValiditySeconds ?? NaN, comparisonValues['hold.buddy.durationSeconds']) * 1000 : NaN;
  requireInput(Number.isFinite(finalEnd + maximumOffset) && finalEnd + maximumOffset <= 253402300799999,
    'learning.simulationTime', 'time-bound');
  return { v, records, stock };
}

function features(row, observedAt) {
  const c = row.configuration;
  const supplied = { body: c.body, fuel: c.powertrain, seats: c.seats, boot: c.boot, zeroTo62: c.zeroTo62,
    mpg: c.mpg, sizeClass: c.sizeClass, equipment: c.equipment, frontIsofix: c.frontIsofix, rearIsofix: c.rearIsofix,
    tags: c.tags, modelLine: row.modelLine.split('|')[0], eligibilityModelKey: row.modelLine };
  const units = { seats: 'count', boot: 'L', zeroTo62: 's', mpg: 'mpg-imperial', sizeClass: 'ordinal-1-5' };
  const category = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9 .+/_=|-]{0,127}$/.test(v);
  const checks = {
    body: (v) => ['hatchback', 'saloon', 'estate', 'suv', 'coupe', 'convertible', 'mpv'].includes(v),
    fuel: (v) => ['petrol', 'diesel', 'phev', 'ev'].includes(v),
    seats: (v) => Number.isSafeInteger(v) && v >= 0,
    boot: (v) => Number.isFinite(v) && v >= 0,
    zeroTo62: (v) => Number.isFinite(v) && v > 0,
    mpg: (v) => Number.isFinite(v) && v >= 0,
    sizeClass: (v) => Number.isInteger(v) && v >= 1 && v <= 5,
    equipment: (v) => object(v) && Object.entries(v).every(([k, x]) => category(k) && typeof x === 'boolean'),
    frontIsofix: (v) => typeof v === 'boolean', rearIsofix: (v) => typeof v === 'boolean',
    tags: (v) => Array.isArray(v) && v.every(category), modelLine: category, eligibilityModelKey: category,
  };
  for (const [field, value] of Object.entries(supplied)) requireInput(value == null || checks[field](value), `configuration.${field}`, 'configuration-invalid');
  const facts = Object.fromEntries(Object.entries(supplied).map(([field, value]) => [field, {
    status: value === undefined || value === null ? 'unknown' : 'known', value: value ?? null, unit: units[field] ?? null,
    provenance: { sourceRef: `configuration:${row.configurationId}`, version: row.snapshotVersion, observedAt,
      // Known facts get the demo-confirmed label that generated stock uses; unknown ones never default.
      assurance: value == null ? 'unknown' : 'synthetic-scenario' },
  }]));
  return { configurationId: row.configurationId, snapshotVersion: row.snapshotVersion, display: { name: row.modelLine }, facts };
}


function validEligibility(value, policyVersion) {
  return exact(value, ['eligible', 'state', 'ruleIds', 'reasons', 'provenance'])
    && ['eligible', 'ineligible', 'needs-confirmation'].includes(value.state)
    && value.eligible === (value.state === 'eligible') && Array.isArray(value.ruleIds) && value.ruleIds.every(text)
    && Array.isArray(value.reasons) && value.reasons.every(text)
    && exact(value.provenance, ['rules', 'schemeRuleLinks', 'assumptions'])
    && Object.values(value.provenance).every((rows) => Array.isArray(rows)
      && rows.every((row) => object(row) && row.policyVersion === policyVersion));
}

// Preparation owns I/O; pure generation sees only this complete immutable policy/configuration snapshot.
export async function loadLearningPolicy({ policyService, policyRead, corpus } = {}) {
  let comparison;
  try { comparison = await loadComparisonPolicy({ policyService, policyRead, corpus }); } catch (error) {
    throw new LearningInputError(error.code ?? 'policy-unavailable', error.key ?? 'comparison');
  }
  const read = { runId: policyRead.runId, asOf: policyRead.asOf, policyVersion: comparison.policyVersion };
  requireInput(validInstant(read.asOf) && text(read.runId), 'policyRead');
  const assumptions = {};
  const readPort = async (method, field, ...args) => {
    let out;
    try { out = await policyService[method](...args); } catch { throw new LearningInputError('policy-unavailable', field); }
    requireInput(out?.status === 'ok' && object(out.value) && out.policyVersion === comparison.policyVersion
      && (out.value?.policyVersion === undefined || out.value.policyVersion === comparison.policyVersion), field, 'policy-unavailable');
    return structuredClone(out.value);
  };
  for (const field of LEARNING_KEYS) {
    const row = await readPort('getAssumption', field, field, read);
    requireInput(row.key === field && row.policyVersion === comparison.policyVersion && text(row.unit)
      && ['assumed', 'verified'].includes(row.status) && text(row.basis) && text(row.source) && /^\d{4}-\d{2}-\d{2}$/.test(row.sourceDate)
      && validInstant(row.effectiveFrom), field, 'incoherent-policy');
    assumptions[field] = row;
  }
  const bound = structuredClone(comparison);
  if (corpus?.enrichment !== undefined) bound.configurationSource.enrichment = structuredClone(corpus.enrichment);
  const snapshot = { schemaVersion: 1, policyVersion: comparison.policyVersion, policyRead: read, assumptions,
    comparison: bound, features: comparison.configurations.map((row) => features(row, read.asOf)), candidatePolicies: [] };
  bounds(snapshot);
  for (const context of comparison.assumptions['comparison.gradeDistribution'].value) {
    for (const row of snapshot.features) {
      const car = { configurationId: row.configurationId, ...Object.fromEntries(Object.entries(row.facts)
        .filter(([, fact]) => fact.status === 'known').map(([field, fact]) => [field, fact.value])) };
      const eligibility = await readPort('getEligibility', 'eligibility', context, car, read);
      const points = await readPort('getPointsCost', 'points', context, car, read);
      requireInput(validEligibility(eligibility, comparison.policyVersion), 'eligibility', 'incoherent-policy');
      requireInput(points.policyVersion === comparison.policyVersion && Number.isFinite(points.monthlyPoints) && points.monthlyPoints >= 0
        && points.unit === 'points/month' && text(points.source), 'points');
      snapshot.candidatePolicies.push({ key: key(context, row.configurationId), eligibility, points });
    }
  }
  snapshot.snapshotHash = inputDigest(snapshot);
  return freezeVehicleData(snapshot);
}

export function generateLearningRecords(seed, snapshot) {
  requireInput(text(seed) || Number.isSafeInteger(seed), 'seed', 'invalid-seed');
  const { v } = bounds(snapshot);
  const { snapshotHash, ...content } = snapshot;
  requireInput(snapshot.schemaVersion === 1 && snapshot.policyVersion === snapshot.comparison.policyVersion
    && inputDigest(content) === snapshotHash, 'snapshotHash', 'incoherent-policy');
  requireInput(exact(snapshot, ['schemaVersion', 'policyVersion', 'policyRead', 'assumptions', 'comparison', 'features', 'candidatePolicies', 'snapshotHash'])
    && exact(snapshot.assumptions, LEARNING_KEYS) && validInstant(snapshot.policyRead?.asOf) && text(snapshot.policyRead?.runId)
    && snapshot.policyRead.policyVersion === snapshot.policyVersion
    && LEARNING_KEYS.every((k) => snapshot.assumptions[k].key === k && snapshot.assumptions[k].policyVersion === snapshot.policyVersion), 'assumptions', 'incoherent-policy');
  requireInput(inputDigest(snapshot.features) === inputDigest(snapshot.comparison.configurations.map((row) =>
    features(row, snapshot.policyRead.asOf))), 'features', 'snapshot-invalid');
  const candidateKeys = snapshot.comparison.assumptions['comparison.gradeDistribution'].value.flatMap((context) =>
    snapshot.features.map((row) => key(context, row.configurationId)));
  requireInput(Array.isArray(snapshot.candidatePolicies) && snapshot.candidatePolicies.length === candidateKeys.length
    && new Set(snapshot.candidatePolicies.map((row) => row.key)).size === candidateKeys.length
    && snapshot.candidatePolicies.every((row) => candidateKeys.includes(row.key)
      && exact(row, ['key', 'eligibility', 'points']) && validEligibility(row.eligibility, snapshot.policyVersion)
      && row.points?.policyVersion === snapshot.policyVersion
      && Number.isFinite(row.points.monthlyPoints) && row.points.monthlyPoints >= 0 && row.points.unit === 'points/month'),
  'candidatePolicies', 'snapshot-invalid');
  const get = (k) => v[`learning.${k}`];
  const baselineStart = snapshot.comparison.assumptions['comparison.startsAt'].value;
  const horizon = snapshot.comparison.assumptions['comparison.horizonDays'].value;
  const duration = snapshot.comparison.assumptions['hold.buddy.durationSeconds'].value * 1000;
  const registry = snapshot.comparison.assumptions['employee.recommendation.v1'].value;
  const slider = { minimum: snapshot.comparison.assumptions['brief.slider.minimum'].value, maximum: snapshot.comparison.assumptions['brief.slider.maximum'].value };
  const response = get('response.v1');
  const records = []; const cycles = [];
  for (let cycle = 0; cycle < get('cycles'); cycle += 1) {
    const startsAt = iso(Date.parse(baselineStart) + cycle * get('cycleSpacingDays') * 86400000);
    const until = iso(Date.parse(startsAt) + horizon * 86400000);
    const overlay = { 'comparison.cohortSize': get('cohortSize'), 'comparison.startsAt': startsAt };
    const input = generateComparisonInputs(seed, snapshot.comparison, { overlay });
    const cycleId = reference(seed, 'cycle', cycle);
    cycles.push({ cycleId, index: cycle, startsAt, until, overlay, overlayHash: input.manifest.overlayHash,
      inputHash: input.manifest.inputHash, counts: input.manifest.counts, releaseSchedule: input.releaseSchedule });
    const supply = input.stock.map((car) => ({ ...car, availableFrom: Date.parse(input.releaseSchedule.find((release) => release.orderUuids.includes(car.orderUuid)).at), committed: false }));
    const opensAt = (employee) => Math.max(Date.parse(startsAt), Date.parse(employee.renewalAt) - duration) + employee.accessSeconds * 1000;
    const employees = [...input.employees].sort((a, b) => opensAt(a) - opensAt(b) || a.renewalAt.localeCompare(b.renewalAt) || a.employeeId.localeCompare(b.employeeId));
    for (const employee of employees) {
      const choiceAt = opensAt(employee);
      const at = iso(choiceAt);
      const alternatives = [];
      const rank = [];
      for (const car of supply) {
        if (car.committed || car.availableFrom > choiceAt || choiceAt > Date.parse(employee.renewalAt)) continue;
        const feature = snapshot.features.find((row) => row.configurationId === car.configurationId);
        const terms = snapshot.candidatePolicies.find((row) => row.key === key(employee, car.configurationId));
        requireInput(feature && terms, 'candidatePolicies', 'snapshot-invalid');
        const gates = evaluateEssentials(feature, employee.statedBrief, registry);
        if (terms.eligibility.state !== 'eligible' || gates.blockers.length || gates.unknowns.length || terms.points.monthlyPoints > employee.pointsAllowance) continue;
        const points = known({ quoteRef: reference(seed, cycle, employee.employeeId, car.orderUuid, 'quote'),
          configurationId: car.configurationId, monthlyPoints: terms.points.monthlyPoints, allowance: employee.pointsAllowance,
          unit: 'points/month', quotedAt: at, validUntil: iso(choiceAt + registry.termValiditySeconds * 1000), policyVersion: snapshot.policyVersion });
        alternatives.push({ configurationId: car.configurationId, orderRef: reference(seed, cycle, car.orderUuid), eligible: true, available: true,
          exposure: known({ from: iso(car.availableFrom), until: at, seconds: (choiceAt - car.availableFrom) / 1000 }), terms: points });
        const latentBrief = { ...employee.statedBrief, preferences: Object.fromEntries(Object.entries(employee.underlyingNeeds.preferences)
          .map(([field, p]) => [field, { ...p, valueState: 'confirmed', importanceState: 'confirmed' }])) };
        const fit = scorePreferences(feature, latentBrief, {}, registry, slider);
        const utility = (fit.score ?? 0) / slider.maximum + (draw(seed, cycle, employee.employeeId, car.orderUuid, 'utility') * 2 - 1) * response.utilityNoise;
        rank.push({ car, points, utility });
      }
      rank.sort((a, b) => b.utility - a.utility || a.car.orderUuid.localeCompare(b.car.orderUuid));
      const noChoice = !rank.length || draw(seed, cycle, employee.employeeId, 'no-choice') < get('noChoiceRate');
      const chosen = noChoice ? null : rank[0];
      const outcomes = { offered: event(), selection: event(), acceptance: event(), decline: { ...event(), reasonType: null },
        expiry: event(), wait: { ...event(), reasonType: null }, satisfaction: event() };
      let projectedAt = choiceAt;
      if (!chosen) outcomes.wait = { ...event('waited', at), reasonType: 'no-acceptable-choice' };
      else {
        outcomes.offered = event('offered', at);
        const respondAt = choiceAt + employee.responseSeconds * 1000;
        const expiresAt = Math.min(choiceAt + duration, Date.parse(chosen.points.value.validUntil));
        const responseDraw = draw(seed, cycle, employee.employeeId, 'response');
        if (responseDraw < response.expiryRate || respondAt >= expiresAt) {
          projectedAt = expiresAt; outcomes.expiry = event('expired', iso(expiresAt)); chosen.car.availableFrom = expiresAt;
        } else if (responseDraw < response.expiryRate + response.declineRate) {
          projectedAt = respondAt; outcomes.decline = { ...event('declined', iso(respondAt)), reasonType: SYNTHETIC_DECLINE_TYPE }; chosen.car.availableFrom = respondAt;
        } else {
          projectedAt = respondAt; outcomes.acceptance = event('accepted', iso(respondAt)); chosen.car.committed = true;
          if (draw(seed, cycle, employee.employeeId, 'selection') < response.selectionAfterAcceptRate) outcomes.selection = event('selected', iso(respondAt));
        }
      }
      const record = { schemaVersion: 1, recordId: reference(seed, cycle, employee.employeeId, 'record'), runId: `synthetic:${reference(seed, snapshot.policyVersion)}`,
        subject: { employeeRef: employee.employeeId, entitlementSlotRef: reference(seed, employee.employeeId, 'slot'), renewalRef: reference(seed, cycle, employee.employeeId, 'renewal') },
        target: { offerRef: chosen ? reference(seed, cycle, employee.employeeId, 'offer') : null, holdRef: chosen ? reference(seed, cycle, employee.employeeId, 'hold') : null,
          quoteRef: chosen ? chosen.points.value.quoteRef : null, orderRef: chosen ? reference(seed, cycle, chosen.car.orderUuid) : null,
          configurationId: chosen ? known(chosen.car.configurationId) : unknown('not-applicable') },
        renewal: { cohort: known(cycleId), period: known({ from: startsAt, until }) },
        entitlement: { schemeId: known(employee.schemeId), gradeId: known(employee.gradeId), allowanceBand: unknown('not-captured') },
        brief: { briefVersion: 1, policyVersion: snapshot.policyVersion, confirmedAt: startsAt, ...projectBriefIntent(employee.statedBrief) },
        choiceSet: known(alternatives), terms: chosen ? chosen.points : unknown('not-applicable'), outcomes,
        timestamps: { projectedAt: iso(projectedAt), clockVersion: `synthetic:${cycleId}` }, provenance: { kind: 'synthetic', generatorVersion: LEARNING_GENERATOR_VERSION, seed } };
      requireInput(validateLearningRecord(record).status === 'ok', 'record', 'invalid-record');
      records.push(record);
    }
  }
  return freezeVehicleData({ records, cycles });
}
