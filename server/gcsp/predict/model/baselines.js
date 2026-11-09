import { requireChoice } from './optimizer.js';

export function normalizeBaselineWeights(example, weights, { waitShare, smoothing }) {
  requireChoice(typeof waitShare === 'number' && Number.isFinite(waitShare) && waitShare >= 0 && waitShare <= 1
    && typeof smoothing === 'number' && Number.isFinite(smoothing) && smoothing > 0, 'baseline.settings');
  const choices = example.alternatives.filter((a) => !a.isWait);
  requireChoice(example.alternatives.filter((a) => a.isWait).length === 1
    && Array.isArray(weights) && weights.length === choices.length
    && weights.every((w) => typeof w === 'number' && Number.isFinite(w) && w >= 0), 'baseline.weights', 'baseline-unavailable');
  if (choices.length === 0) return [1];
  const denominator = weights.reduce((sum, w) => sum + w + smoothing, 0);
  let index = 0;
  return example.alternatives.map((a) => a.isWait ? waitShare : (1 - waitShare) * (weights[index++] + smoothing) / denominator);
}

export function expressedDemandBaseline(example, projection, mapping, options) {
  requireChoice(projection?.basis === 'expressed-saved-demand' && mapping.expressedDemandDimension === 'body',
    'FUCQ-99.projection', 'baseline-unavailable');
  const alternatives = example.alternatives.filter((a) => !a.isWait);
  const classes = alternatives.map((a) => a.attributes?.body);
  const weights = classes.map((key) => {
    const row = projection.demand?.byBody?.find((b) => b.key === key);
    requireChoice(typeof key === 'string' && row?.count?.kind === 'exact' && Number.isSafeInteger(row.count.value)
      && row.count.value >= 0, 'FUCQ-99.exact-body-count', 'baseline-unavailable');
    return row.count.value / classes.filter((c) => c === key).length;
  });
  return normalizeBaselineWeights(example, weights, options);
}

// The actual service imports are deferred until an explicit offline training run.
export async function prepareActualChoiceBaselines({ training, settings, policyService, policyRead }) {
  const read = { ...policyRead, policyVersion: settings.policyVersion };
  const trainingPolicy = await policyService.getPolicySnapshot(read);
  requireChoice(trainingPolicy?.status === 'ok' && trainingPolicy.policyVersion === settings.policyVersion,
    'baseline.training-policy', 'baseline-unavailable');
  const readKey = async (key) => {
    const out = await policyService.getAssumption(key, read);
    requireChoice(out?.status === 'ok' && out.policyVersion === settings.policyVersion
      && out.value?.policyVersion === settings.policyVersion, key, 'baseline-unavailable');
    return out.value;
  };
  const mappingRow = await readKey('choice.baseline.v1'); const mapping = mappingRow.value;
  requireChoice(mapping?.expressedDemandDimension === 'body' && mapping.deterministicFitMapping === 'normalize-nonnegative-fit'
    && mapping.waitShareKey === 'learning.noChoiceRate', 'choice.baseline.v1', 'baseline-unavailable');
  const wait = await readKey(mapping.waitShareKey);
  const calibration = await readKey('employee.recommendation.v1');
  const minimum = await readKey('brief.slider.minimum'); const maximum = await readKey('brief.slider.maximum');
  const contexts = await readKey('eligibility.context.mapping');
  const options = { smoothing: mapping.smoothing, waitShare: wait.value };
  // Validate before allocating an isolated repository.
  normalizeBaselineWeights({ alternatives: [{ isWait: true }] }, [], options);
  const [{ createGregDemandService }, { scorePreferences }, { createDemoRuntime }, repositoryModule] = await Promise.all([
    import('../../greg/index.js'), import('../../../scenarios/employee/index.js'), import('../../clock/index.js'), import('../../repository/index.js'),
  ]);
  const { createMemoryRepository, createMemoryStore, inputDigest, ok } = repositoryModule;
  const repository = createMemoryRepository({ store: createMemoryStore() });
  requireChoice((await repository.open()).status === 'ok', 'baseline.repository', 'baseline-unavailable');
  try {
    const runtime = await createDemoRuntime({ repository, policy: policyService,
      environmentId: `offline-choice-baseline-${inputDigest(training.map((r) => r.recordId)).slice(0, 20)}`,
      environmentKind: 'synthetic', policyAsOf: read.asOf, commandId: 'baseline-bootstrap', sessionNow: () => read.asOf });
    requireChoice(runtime.status === 'ok', 'baseline.runtime', 'baseline-unavailable');
    const { clock, identity } = runtime.value;
    const presenter = await identity.createPresenterSession('offline-baseline-presenter');
    requireChoice(presenter.status === 'ok', 'baseline.presenter', 'baseline-unavailable');
    const initialClock = await clock.now(presenter.value.context);
    requireChoice(initialClock.status === 'ok' && Number.isFinite(Date.parse(read.asOf))
      && Number.isFinite(Date.parse(initialClock.value.now)) && Date.parse(initialClock.value.now) <= Date.parse(read.asOf),
    'baseline.clock', 'baseline-unavailable');
    if (Date.parse(initialClock.value.now) < Date.parse(read.asOf)) {
      const advanced = await clock.advance(presenter.value.context, { commandId: 'offline-baseline-training-instant',
        expectedClockVersion: initialClock.value.clockVersion, to: read.asOf });
      requireChoice(advanced.status === 'ok', 'baseline.clock', 'baseline-unavailable');
    }
    const acting = await identity.switchPrincipal(presenter.value.context, 'demo-greg', 'offline-baseline-greg');
    requireChoice(acting.status === 'ok' && acting.value.context.policyVersion === settings.policyVersion, 'baseline.context', 'baseline-unavailable');
    const context = acting.value.context;
    // A new run must resolve the identical retained source, never another run's
    // authority or a seed-only replacement for the selected training version.
    const baselinePolicy = await policyService.getPolicySnapshot({ ...read, runId: context.runId });
    requireChoice(baselinePolicy.status === 'ok' && inputDigest(baselinePolicy.value) === inputDigest(trainingPolicy.value),
      'baseline.policy-identity', 'baseline-unavailable');
    const initialBriefs = await repository.query(context, 'briefs');
    requireChoice(initialBriefs.status === 'ok' && initialBriefs.value.length === 0,
      'baseline.initial-population', 'baseline-unavailable');
    // Retain only the latest earlier-cycle confirmed brief for each training employee.
    const people = new Map();
    for (const example of [...training].sort((a, b) => a.observedAt.localeCompare(b.observedAt))) {
      requireChoice(typeof example.employeeRef === 'string' && example.entitlement, 'baseline.population', 'baseline-unavailable');
      people.set(example.employeeRef, example);
    }
    const inserted = await repository.transaction(context, { commandId: 'offline-training-population',
      inputDigest: inputDigest([...people.values()].map((r) => r.recordId)) }, async (tx) => {
      for (const example of people.values()) {
        const employeeId = `offline-learning-${example.employeeRef}`;
        const schemeId = example.entitlement.schemeId.value; const gradeId = example.entitlement.gradeId.value;
        const matches = contexts.value.filter((c) => c.schemeId === schemeId && c.gradeIds.includes(gradeId));
        requireChoice(matches.length === 1, 'baseline.employee-context', 'baseline-unavailable');
        const entitlementSlotId = `offline-slot-${employeeId}`; const companyId = matches[0].companyId;
        // Greg's demand read needs a bound slot and a source-stamped manual record; no driver, so no eligibility claim.
        const source = { mode: 'synthetic', sourceRef: 'offline-choice-training', schemaVersion: '1', sourceVersion: 'offline-v1',
          effectiveFrom: read.asOf, observedAt: read.asOf };
        const manualContext = { recordSetId: `offline:${employeeId}`, source, drivers: [],
          account: { employeeId, companyId, schemeId, gradeId } };
        const employee = await tx.insert('employees', { runId: context.runId, employeeId, principalId: employeeId,
          schemeId, gradeId, companyId, entitlementSlotId, roles: ['employee'], contract: { manualContext } });
        if (employee.status !== 'ok') return employee;
        const slot = await tx.insert('entitlement_slots', { runId: context.runId, employeeId, entitlementSlotId, capacity: 1, employeeCapacity: 1 });
        if (slot.status !== 'ok') return slot;
        const brief = await tx.insert('briefs', { ...structuredClone(example.brief), runId: context.runId, employeeId, entitlementSlotId,
          schemaVersion: 1, status: 'confirmed', confirmedBy: employeeId });
        if (brief.status !== 'ok') return brief;
      }
      return ok({ trainingPopulation: people.size });
    });
    requireChoice(inserted.status === 'ok', 'baseline.population', 'baseline-unavailable');
    const demand = await createGregDemandService({ repository, policy: policyService, clock, identity }).readDemand(context);
    requireChoice(demand.status === 'ok' && demand.value.basis === 'expressed-saved-demand', 'FUCQ-99.readDemand', 'baseline-unavailable');
    const projection = demand.value;
    const registry = calibration.value; const slider = { minimum: minimum.value, maximum: maximum.value };
    return {
      expressedDemand: { predict: (example) => expressedDemandBaseline(example, projection, mapping, options),
        provenance: { source: 'FUCQ-99 createGregDemandService.readDemand; earlier training briefs only',
          version: projection.projectionVersion, policyVersion: settings.policyVersion, trainingPopulation: people.size,
          mapping: mappingRow, waitAssumption: wait } },
      deterministicFit: { predict: (example) => {
        const weights = example.alternatives.filter((a) => !a.isWait).map((a) => {
          const fit = scorePreferences(a.snapshot, example.brief, {}, registry, slider);
          requireChoice(typeof fit.score === 'number' && Number.isFinite(fit.score) && fit.score >= 0,
            'FUCQ-29.scorePreferences', 'baseline-unavailable');
          return fit.score;
        });
        return normalizeBaselineWeights(example, weights, options);
      }, provenance: { source: 'FUCQ-29 scorePreferences; normalized fit, not calibrated probability',
        version: calibration.policyVersion, policyVersion: settings.policyVersion, mapping: mappingRow, waitAssumption: wait } },
    };
  } finally { await repository.close(); }
}
