import { randomUUID } from 'node:crypto';
import { createMemoryRepository, createMemoryStore, createPostgresRepository, inputDigest, ok, result } from './repository/index.js';
import { createPolicyService } from './policy/index.js';
import { createDemoRuntime } from './clock/index.js';
import { createManualContextService, createRepositoryManualPorts } from './manual-context/index.js';
import { seedManualDemoContext } from './manual-context/fixtures.js';
import { createBriefService } from './brief/index.js';
import { createBriefEditorService } from './brief/editor.js';
import { createActivityService } from './brief/activity.js';

const unavailable = () => result('unavailable', { reason: 'The trusted demo runtime is unavailable.', retryable: true });
const scoped = (value, context) => ['runId', 'environmentId', 'employeeId'].every((key) => value?.[key] === context[key]);

// Explicit composition only. A failed PostgreSQL open never changes providers.
export async function createGcspRuntime({ mode = 'postgres', repository, repositoryOptions, policy = createPolicyService(),
  environmentId, policyAsOf, commandId, sessionNow = () => new Date().toISOString() } = {}) {
  if (!['postgres', 'memory'].includes(mode)) return result('invalid', { code: 'unsupported-repository-mode' });
  repository ??= mode === 'memory' ? createMemoryRepository({ store: createMemoryStore() }) : createPostgresRepository(repositoryOptions);
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await repository.close(); } };
  try {
    const opened = await repository.open();
    if (opened.status !== 'ok') { await close(); return opened; }
    const initialized = await createDemoRuntime({ repository, policy, environmentId, environmentKind: 'synthetic', policyAsOf, commandId, sessionNow });
    if (initialized.status !== 'ok') { await close(); return initialized; }
    const { clock, identity } = initialized.value;
    const ports = createRepositoryManualPorts({ repository, policy });
    const account = createManualContextService({ repository, policy, clock, identity, ports });
    const brief = createBriefService({ repository, policy, clock, identity });
    const provider = { async resolve(context) {
      const allowed = await identity.requireRole(context, 'employee'); if (allowed.status !== 'ok') return allowed;
      const time = await clock.now(context); if (time.status !== 'ok') return time;
      const read = { runId: context.runId, asOf: time.value.now, policyVersion: context.policyVersion };
      const [drivers, stock, current] = await Promise.all([ports.driver.read(context, read), ports.releasedStock.read(context, read), account.readAccount(context)]);
      const failure = [drivers, stock, current].find((entry) => entry.status !== 'ok'); if (failure) return failure;
      if (!scoped(drivers.value, context) || !scoped(stock.value, context)
        || drivers.value.recordSetId !== current.value.versions?.recordSetId
        || drivers.value.repositoryVersion !== current.value.versions?.employee
        || !Array.isArray(drivers.value.drivers) || !Array.isArray(stock.value.stock)) return unavailable();
      const driver = drivers.value.drivers.find((entry) => entry.driverId === current.value.currentContract?.driverId)
        ?? drivers.value.drivers.find((entry) => entry.kind === 'employee');
      return ok({ runId: context.runId, environmentId: context.environmentId, employeeId: context.employeeId,
        factsVersion: inputDigest({ driver: drivers.value.source, recordSetId: drivers.value.recordSetId, repositoryVersion: drivers.value.repositoryVersion }),
        stockVersion: stock.value.sourceVersion, employeeFacts: { ...drivers.value.employeeFacts, driverEligible: driver?.eligible }, stock: stock.value.stock });
    } };
    const editor = createBriefEditorService({ brief, account, provider, policy, clock, identity });
    const activity = createActivityService({ repository, identity, clock });
    const dependencies = { gcspIdentity: identity, gcspClock: clock, gcspManual: account, gcspBrief: brief,
      gcspBriefEditor: editor, gcspActivity: activity, gcspRecommendations: { provider, policy, time: clock } };
    // Backend-only local bootstrap. The browser cannot choose identities or receive raw credentials in JSON.
    async function createLocalSession() {
      const presenter = await identity.createPresenterSession(`local-presenter:${randomUUID()}`);
      if (presenter.status !== 'ok') return presenter;
      const time = await clock.now(presenter.value.context); if (time.status !== 'ok') return time;
      const configured = await policy.getAssumption('identity.demo.principals', { runId: presenter.value.context.runId,
        asOf: time.value.now, policyVersion: presenter.value.context.policyVersion });
      if (configured.status !== 'ok') return configured;
      const principal = configured.value.value.find((entry) => entry.roles.includes('employee'));
      if (!principal) return unavailable();
      const acting = await identity.switchPrincipal(presenter.value.context, principal.principalId, `local-employee:${randomUUID()}`);
      if (acting.status !== 'ok') return acting;
      const seeded = await seedManualDemoContext({ repository, identity, clock, context: acting.value.context });
      if (seeded.status !== 'ok') return seeded;
      return ok({ context: acting.value.context, setCookie: [presenter.value.setCookie[1], acting.value.setCookie] });
    }
    return ok({ mode, repository, policy, clock, identity, account, brief, editor, activity, provider, dependencies, createLocalSession, close });
  } catch { await close(); return unavailable(); }
}
