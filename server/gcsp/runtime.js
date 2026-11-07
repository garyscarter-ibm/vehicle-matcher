import { randomUUID } from 'node:crypto';
import { createMemoryRepository, createMemoryStore, createPostgresRepository, inputDigest, ok, result } from './repository/index.js';
import { PolicyService, MemoryPolicyProvider, PostgresPolicyProvider } from './policy/index.js';
import { createDemoRuntime } from './clock/index.js';
import { createManualContextService, createRepositoryManualPorts } from './manual-context/index.js';
import { seedManualDemoContext } from './manual-context/fixtures.js';
import { createBriefService } from './brief/index.js';
import { createBriefEditorService } from './brief/editor.js';
import { createActivityService } from './brief/activity.js';
import { createGregDemandService } from './greg/index.js';
import { createGregPublishService } from './greg/publish/index.js';
import { createScenarioService } from './scenarios/index.js';
import { createSyntheticManualStockAdapter } from './adapters/manual-stock.js';
import { createManualClaimsService } from './manual-claims/index.js';
import { createBuddyHoldService } from './offers/buddy-hold.js';
import { createAllocationService } from './allocation/index.js';
import { createOfferAccessService, OFFER_ACCESS_COOKIE } from './offers/access.js';
import { createOfferDecisionService } from './offers/decision.js';
import { createOfferFollowupService } from './offers/followup.js';
import { createStoredSubjectRecommendationEvaluator } from './recommendation/index.js';
import { verifyOfferToken, resolveOfferLandingUrl } from './offers/offer-token.js';
import { createNotificationDispatcher } from './notify/index.js';
import { createStockReleaseService } from './stock/index.js';
import { createStockReleaseHistoryPort } from './stock/history-port.js';
import { createManualGalleryStockRead } from './manual-gallery/stock-read.js';
import { createRenewalCaseService } from './cases/index.js';
import { ManualReviewDetailsService } from './manual-review/index.js';
import { createSyntheticOrderingAdapter } from './adapters/synthetic-ordering.js';
import { createSyntheticOrderingStatus } from './adapters/synthetic-ordering-status.js';
import { createSyntheticDocumentStatus } from './adapters/synthetic-ordering-documents.js';
import { createLifecycleApprovalService } from './lifecycle/approvals/index.js';
import { createLifecycleDocumentService } from './lifecycle/documents/index.js';
import { createManualOrderService, createManualOrderConversion } from './manual-order/index.js';

const unavailable = () => result('unavailable', { reason: 'The trusted demo runtime is unavailable.', retryable: true });
const scoped = (value, context) => ['runId', 'environmentId', 'employeeId'].every((key) => value?.[key] === context[key]);

// Explicit composition only. A failed PostgreSQL open never changes providers.
export async function createGcspRuntime({ mode = 'postgres', repository, repositoryOptions, policy,
  environmentId, policyAsOf, commandId, stockProvider, offerLandingUrl = process.env.GCSP_OFFER_LANDING_URL,
  sessionNow = () => new Date().toISOString() } = {}) {
  if (!['postgres', 'memory'].includes(mode)) return result('invalid', { code: 'unsupported-repository-mode' });
  try { offerLandingUrl = resolveOfferLandingUrl(offerLandingUrl); }
  catch { return result('invalid', { code: 'invalid-offer-landing-url' }); }
  repository ??= mode === 'memory' ? createMemoryRepository({ store: createMemoryStore() }) : createPostgresRepository(repositoryOptions);
  const ownsPolicy = policy === undefined;
  const readPolicy = policy ?? new PolicyService({ provider: mode === 'memory'
    ? new MemoryPolicyProvider() : new PostgresPolicyProvider(repositoryOptions) });
  let closing; let notify;
  // The trusted host settles startup and its initiating calls before closing.
  const close = () => closing ??= (async () => {
    try { notify?.close(); } finally {
      try { await repository.close(); } finally { if (ownsPolicy) await readPolicy.close(); }
    }
  })();
  try {
    const opened = await repository.open();
    if (opened.status !== 'ok') { await close(); return opened; }
    const initialized = await createDemoRuntime({ repository, policy: readPolicy, environmentId, environmentKind: 'synthetic', policyAsOf, commandId, sessionNow });
    if (initialized.status !== 'ok') { await close(); return initialized; }
    const { clock, identity } = initialized.value;
    policy = readPolicy.withPublicationPorts({ identity, clock, repository });
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
    const greg = createGregDemandService({ repository, policy, clock, identity });
    const gregPublish = createGregPublishService({ repository, policy, clock, identity });
    // Prepared scenario fixtures are branded by the exact policy instance used by the clock.
    const scenarios = createScenarioService({ repository, policy: readPolicy, clock, identity });
    const adapter = createSyntheticManualStockAdapter();
    const manualClaims = createManualClaimsService({ repository, policy, clock, identity, manual: account, adapter });
    // The trusted host supplies the existing pull port. No source is invented here.
    // A factory gets the same policy the release service reads, so provider windows follow policy.
    const pullProvider = typeof stockProvider === 'function' ? stockProvider({ policy }) : stockProvider;
    const stockRelease = pullProvider === undefined ? undefined
      : createStockReleaseService({ repository, policy, clock, identity, provider: pullProvider });
    const releaseHistory = createStockReleaseHistoryPort({ repository, identity, clock });
    const galleryRead = createManualGalleryStockRead({ manual: manualClaims, releaseHistory, identity, clock });
    // Route reads through this facade; lifecycle and mutations keep the original instance.
    const manualRead = Object.freeze({
      readAccount: manualClaims.readAccount.bind(manualClaims),
      readDraft: manualClaims.readDraft.bind(manualClaims),
      saveDraft: manualClaims.saveDraft.bind(manualClaims),
      browseStock: galleryRead.browseStock.bind(galleryRead),
    });
    const manualReview = new ManualReviewDetailsService({ repository, policy, identity, manualClaims });
    const cases = createRenewalCaseService({ repository, policy, clock, identity });
    const orderingAdapter = createSyntheticOrderingAdapter({ repository });
    orderingAdapter.status = createSyntheticOrderingStatus({ repository });
    orderingAdapter.documentStatus = createSyntheticDocumentStatus({ repository });
    const manualOrder = createManualOrderService({ repository, policy, clock, identity, adapter: orderingAdapter,
      converters: { cart: createManualOrderConversion({ claims: manualClaims, manual: account }) } });
    const lifecycle = createLifecycleApprovalService({ repository, policy, clock, identity, status: orderingAdapter.status });
    const documents = createLifecycleDocumentService({ repository, policy, clock, identity,
      lifecycleStages: lifecycle.stagePort(), provider: orderingAdapter.documentStatus });
    const buddy = createBuddyHoldService({ repository, policy, clock, identity, adapter, offerLandingUrl });
    // FUCQ-96 proposes claims on the clock's buddy-allocation stage; only the buddy port writes holds.
    const allocation = createAllocationService({ repository, policy, clock, identity, claim: buddy });
    const offerAccess = createOfferAccessService({ repository, policy, clock, identity, environmentId, sessionNow, verifyOfferToken });
    const offerDecisions = createOfferDecisionService({ repository, policy, clock, access: offerAccess,
      createStoredSubjectEvaluator: createStoredSubjectRecommendationEvaluator, mode: adapter.mode });
    const offerFollowup = createOfferFollowupService({ repository, policy, clock, identity, brief, offers: offerAccess });
    const resolveOfferAccess = async ({ selector, cookie }) => {
      const hasOfferCookie = typeof cookie === 'string' && cookie.split(';')
        .some((part) => part.trim().startsWith(`${OFFER_ACCESS_COOKIE}=`));
      const session = hasOfferCookie ? await offerAccess.fromSession(selector, cookie) : null;
      if (session && !['not-found', 'stale-run'].includes(session.status)) return session;
      const resolved = await identity.resolveSession({ authorized: true, cookie });
      return resolved.status === 'ok' ? offerAccess.fromAccount(resolved.value, selector) : session ?? resolved;
    };
    notify = createNotificationDispatcher({ repository, policy, clock, environmentId });
    const dependencies = { gcspRepository: repository, gcspPolicy: policy, gcspGreg: greg, gcspGregPublish: gregPublish,
      gcspScenarios: scenarios, gcspManualClaims: manualClaims, gcspManualRead: manualRead, gcspManualReview: manualReview,
      gcspStockRelease: stockRelease, gcspCases: cases, gcspManualOrder: manualOrder,
      gcspLifecycle: lifecycle, gcspDocuments: documents,
      gcspBuddy: buddy, gcspAllocation: allocation, gcspOfferAccess: offerAccess,
      gcspOfferDecisions: offerDecisions, gcspResolveOfferAccess: resolveOfferAccess, gcspOfferFollowup: offerFollowup,
      gcspNotify: notify, gcspOutbox: { repository },
      // Backend-only; the switch route calls it with the server-issued employee context, replay-safe per run.
      gcspPrepareEmployee: (context) => seedManualDemoContext({ repository, identity, clock, context }),
      gcspIdentity: identity, gcspClock: clock, gcspManual: account, gcspBrief: brief,
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
    return ok({ mode, repository, policy, clock, identity, account, brief, editor, activity, provider, greg, gregPublish, scenarios, manualClaims, manualRead, manualReview, manualOrder, stockRelease, releaseHistory, cases, orderingAdapter, lifecycle, documents, buddy, allocation, offerAccess, offerDecisions, offerFollowup, resolveOfferAccess, notify, dependencies, createLocalSession, close });
  } catch { await close(); return unavailable(); }
}
