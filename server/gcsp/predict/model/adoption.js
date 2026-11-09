import { createMemoryRepository, createMemoryStore } from '../../repository/index.js';
import { FilePolicyProvider, MemoryPolicyProvider, PolicyService, createMemoryPolicyStore } from '../../policy/index.js';
import { createDemoRuntime } from '../../clock/index.js';
import { ChoiceModelError } from './optimizer.js';

export const CHOICE_ADOPTION_SETS = Object.freeze(['fucq113-learning-v1', 'fucq115-choice-model-v1']);
const ENVIRONMENT_ID = 'choice-training-cli';

// Throwaway in-memory run: seed-v1 stays unchanged, each reviewed set is adopted as Greg, one second apart.
// The result only reads policy; no model reference is published and nothing is activated.
export async function adoptChoiceTrainingPolicy({ seedProvider = new FilePolicyProvider(), sets = CHOICE_ADOPTION_SETS, availableCycleIndices, sensitivity } = {}) {
  const fail = (field) => { throw new ChoiceModelError('choice-policy-unavailable', field); };
  let repository; let policyService;
  const close = async () => { try { await repository?.close(); } finally { await policyService?.close(); } };
  try {
    const versions = await seedProvider.loadVersions();
    const seed = versions?.[0] ?? fail('policy-file');
    const provider = new MemoryPolicyProvider({ store: createMemoryPolicyStore(), seedProvider: { loadVersions: async () => versions } });
    policyService = new PolicyService({ provider });
    const scenario = await policyService.getAssumption('clock.scenario.v1', { runId: ENVIRONMENT_ID, asOf: seed.effectiveFrom });
    const startsAt = scenario.status === 'ok' ? scenario.value.value?.startsAt : undefined;
    if (typeof startsAt !== 'string') fail('clock.scenario.v1');
    repository = createMemoryRepository({ store: createMemoryStore() });
    if ((await repository.open()).status !== 'ok') fail('repository');
    const runtime = await createDemoRuntime({ repository, policy: policyService, environmentId: ENVIRONMENT_ID,
      environmentKind: 'synthetic', policyAsOf: startsAt, commandId: 'choice-bootstrap', sessionNow: () => startsAt });
    if (runtime.status !== 'ok') fail('demo-runtime');
    const { clock, identity } = runtime.value;
    const publisher = policyService.withPublicationPorts({ identity, clock, repository });
    const presenter = await identity.createPresenterSession('choice-presenter');
    if (presenter.status !== 'ok') fail('identity');
    const start = presenter.value.context;
    const now = async () => { const out = await clock.now(start); if (out.status !== 'ok') fail('clock'); return out.value; };
    let time = await now();
    const base = { runId: start.runId, asOf: time.now, policyVersion: start.policyVersion };
    const principals = await policyService.getAssumption('identity.demo.principals', base);
    const principal = principals.status === 'ok' ? principals.value.value.find((row) => row.roles?.includes('greg')) : null;
    if (!principal) fail('identity.demo.principals');
    const greg = await identity.switchPrincipal(start, principal.principalId, 'choice-greg');
    if (greg.status !== 'ok') fail('identity');
    let active = start.policyVersion; const adoptions = [];
    for (const definitionSetId of sets) {
      if (adoptions.length) {
        const moved = await clock.advance(start, { commandId: `choice-step:${time.clockVersion}`, expectedClockVersion: time.clockVersion, bySeconds: 1 });
        if (moved.status !== 'ok') fail('clock');
        time = await now();
      }
      const adopted = await publisher.adoptReviewedAssumptions(greg.value.context, { commandId: `adopt:${definitionSetId}:${start.runId}`,
        expectedActiveVersion: active, policyVersion: `${active}+${definitionSetId}`, effectiveFrom: time.now, definitionSetId });
      if (adopted.status !== 'ok' || adopted.value?.activation?.status !== 'active') fail('adoption');
      active = adopted.value.policyVersion;
      adoptions.push({ definitionSetId, policyVersion: active, effectiveFrom: time.now, digest: adopted.value.adoption.digest });
    }
    if (sensitivity) {
      // One dated successor changes only the listed keys; reviewed bundles and seed-v1 stay as they are.
      const moved = await clock.advance(start, { commandId: `choice-step:${time.clockVersion}`, expectedClockVersion: time.clockVersion, bySeconds: 1 });
      if (moved.status !== 'ok') fail('clock');
      time = await now();
      const { status, basis, source, sourceDate } = sensitivity;
      const published = await publisher.publishPolicyVersion(greg.value.context, { commandId: `sensitivity:${start.runId}`,
        expectedActiveVersion: active, policyVersion: `${active}+sensitivity`, effectiveFrom: time.now,
        changes: sensitivity.changes.map(({ key, value }) => ({ table: 'assumptions', key, patch: { value, status, basis, source, sourceDate } })) });
      if (published.status !== 'ok') fail('sensitivity-publication');
      active = published.value.policyVersion;
      adoptions.push({ definitionSetId: 'sensitivity', policyVersion: active, effectiveFrom: time.now, digest: null });
    }
    if (Array.isArray(availableCycleIndices)) {
      // A dataset with fewer cycles than the reviewed split needs a dated, recorded successor of that one key.
      const pin = { runId: start.runId, asOf: time.now, policyVersion: active };
      const row = await policyService.getAssumption('choice.training.split.v1', pin);
      if (row.status !== 'ok') fail('choice.training.split.v1');
      const evaluationCycleIndices = row.value.value.evaluationCycleIndices.filter((index) => availableCycleIndices.includes(index));
      if (evaluationCycleIndices.length && evaluationCycleIndices.length < row.value.value.evaluationCycleIndices.length) {
        const moved = await clock.advance(start, { commandId: `choice-step:${time.clockVersion}`, expectedClockVersion: time.clockVersion, bySeconds: 1 });
        if (moved.status !== 'ok') fail('clock');
        time = await now();
        const published = await publisher.publishPolicyVersion(greg.value.context, { commandId: `split:${start.runId}`,
          expectedActiveVersion: active, policyVersion: `${active}+evaluation-cycles`, effectiveFrom: time.now,
          changes: [{ table: 'assumptions', key: 'choice.training.split.v1', patch: {
            value: { ...row.value.value, evaluationCycleIndices }, status: 'assumed', sourceDate: time.now.slice(0, 10),
            source: 'scripts/gcsp/train-choice-model.mjs',
            basis: 'Reviewed split narrowed to the evaluation cycles the dataset contains; all other split values unchanged.' } }] });
        if (published.status !== 'ok') fail('split-publication');
        active = published.value.policyVersion;
        adoptions.push({ definitionSetId: 'choice.training.split.v1', policyVersion: active, effectiveFrom: time.now, digest: null });
      }
    }
    // One retained snapshot lets PolicyService validate it once, not on each read.
    const retained = await provider.loadVersions({ runId: start.runId });
    const reader = new PolicyService({ provider: { loadVersions: async () => retained } });
    return { policyService: reader, close: async () => { try { await close(); } finally { await reader.close(); } },
      policyRead: { runId: start.runId, asOf: time.now, policyVersion: active }, baseVersion: start.policyVersion, adoptions };
  } catch (error) {
    await close().catch(() => {});
    throw error instanceof ChoiceModelError ? error : new ChoiceModelError('choice-policy-unavailable', 'adoption');
  }
}
