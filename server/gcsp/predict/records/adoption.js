import { createMemoryRepository, createMemoryStore } from '../../repository/index.js';
import { FilePolicyProvider, MemoryPolicyProvider, PolicyService, createMemoryPolicyStore } from '../../policy/index.js';
import { createDemoRuntime } from '../../clock/index.js';
import { LearningInputError } from './generator.js';

export const LEARNING_DEFINITION_SET = 'fucq113-learning-v1';
const ENVIRONMENT_ID = 'learning-cli';
const ROLE = 'greg';

// Throwaway in-memory run: seed-v1 stays unchanged and nothing leaves the process.
// The demo clock's start fixes the adoption instant, so reruns are identical.
export async function adoptLearningPolicy({ seedProvider = new FilePolicyProvider() } = {}) {
  const fail = (field) => { throw new LearningInputError('policy-unavailable', field); };
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
      environmentKind: 'synthetic', policyAsOf: startsAt, commandId: 'learning-bootstrap', sessionNow: () => startsAt });
    if (runtime.status !== 'ok') fail('demo-runtime');
    const { clock, identity } = runtime.value;
    const publisher = policyService.withPublicationPorts({ identity, clock, repository });
    const presenter = await identity.createPresenterSession('learning-presenter');
    if (presenter.status !== 'ok') fail('identity');
    const start = presenter.value.context;
    const time = await clock.now(start);
    if (time.status !== 'ok') fail('clock');
    const base = { runId: start.runId, asOf: time.value.now, policyVersion: start.policyVersion };
    const principals = await policyService.getAssumption('identity.demo.principals', base);
    const principal = principals.status === 'ok' ? principals.value.value.find((row) => row.roles?.includes(ROLE)) : null;
    if (!principal) fail('identity.demo.principals');
    const greg = await identity.switchPrincipal(start, principal.principalId, 'learning-greg');
    if (greg.status !== 'ok') fail('identity');
    const adopted = await publisher.adoptReviewedAssumptions(greg.value.context, { commandId: `adopt:${LEARNING_DEFINITION_SET}:${start.runId}`,
      expectedActiveVersion: start.policyVersion, policyVersion: `${start.policyVersion}+${LEARNING_DEFINITION_SET}`,
      effectiveFrom: time.value.now, definitionSetId: LEARNING_DEFINITION_SET });
    if (adopted.status !== 'ok' || adopted.value?.activation?.status !== 'active') fail('adoption');
    // One retained snapshot lets PolicyService validate it once, not on each of the thousands of reads.
    const retained = await provider.loadVersions({ runId: start.runId });
    const reader = new PolicyService({ provider: { loadVersions: async () => retained } });
    return { policyService: reader, close: async () => { try { await close(); } finally { await reader.close(); } },
      policyRead: { runId: start.runId, asOf: time.value.now, policyVersion: adopted.value.policyVersion },
      adoption: { definitionSetId: LEARNING_DEFINITION_SET, baseVersion: start.policyVersion,
        policyVersion: adopted.value.policyVersion, effectiveFrom: time.value.now, digest: adopted.value.adoption.digest } };
  } catch (error) {
    await close().catch(() => {});
    throw error instanceof LearningInputError ? error : new LearningInputError('policy-unavailable', 'adoption');
  }
}
