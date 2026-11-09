export const CONTRACT_VERSION = '1.0.0';
export const OCCUPYING_STATES = Object.freeze(['active', 'claim-pending', 'release-pending', 'selection-pending']);
const common = ['runId', 'version', 'createdAt', 'updatedAt'];
const definition = (key, fields, unique = [], refs = [], immutable = false) => Object.freeze({
  key: Object.freeze(key.split(' ')), fields: Object.freeze([...new Set([...common, ...key.split(' '), ...fields.split(' ')])]),
  unique, refs, immutable,
});
export const TABLES = Object.freeze({
  runs: definition('runId', 'environmentId status current scenarioVersion fixtureVersion corpusVersion policyVersion clockInstant clockVersion versions', [['environmentId', '$current']]),
  employees: definition('runId employeeId', 'principalId companyId gradeId schemeId entitlementSlotId roles contract renewalId name'),
  entitlement_slots: definition('runId entitlementSlotId', 'employeeId renewalId contractId capacity employeeCapacity state', [], [['employees', 'employeeId']]),
  briefs: definition('runId employeeId briefVersion', 'entitlementSlotId renewalId schemaVersion previousBriefVersion status preferences essentials currentCarFeedback knownFacts buddy policyVersion confirmedBy confirmedAt postDeclineChange', [], [['employees', 'employeeId']], true),
  stock: definition('runId orderUuid', 'orderNumber configurationId wholesalerOrderId revision release account visibility state status available held allocated agModelCode vgModelCode facts corpusVersion', [['orderNumber']]),
  future_order_requests: definition('runId requestId', 'commandId model derivative quantity state requestedAt requestedBy policyVersion stockVersion providerReference provenance history plan', [['requestedBy', 'commandId'], ['providerReference']]),
  confirmed_supply: definition('runId supplyId', 'requestId commandId quantity state confirmedAt expectedAt policyVersion sourceVersion providerReference provenance', [['providerReference']], [['future_order_requests', 'requestId']], true),
  holds: definition('runId holdId', 'orderUuid employeeId entitlementSlotId renewalId type state phase expiresAt policyVersion quoteId operationId reviewStartedAt releaseReason', [], [['stock', 'orderUuid'], ['employees', 'employeeId'], ['entitlement_slots', 'entitlementSlotId'], ['quotes', 'quoteId']]),
  claims: definition('runId claimId', 'holdId orderUuid employeeId entitlementSlotId renewalId type state expiresAt policyVersion quoteId operationId', [['holdId']], [['holds', 'holdId'], ['stock', 'orderUuid'], ['entitlement_slots', 'entitlementSlotId'], ['employees', 'employeeId']]),
  quotes: definition('runId quoteId', 'orderUuid employeeId entitlementSlotId configurationId facts eligibility terms briefVersion draftVersion policyVersion quotedAt validUntil expiresAt provenance monthlyPoints allowance', [], [], true),
  offers: definition('runId offerId', 'holdId employeeId orderUuid state briefVersion policyVersion quoteId expiresAt tokenHash environmentId tokenMetadata operationId', [['holdId']], [['holds', 'holdId'], ['quotes', 'quoteId']]),
  decisions: definition('runId decisionId', 'commandId offerId holdId employeeId decision reason actorId versions outcome originalResponse', [['commandId']]),
  pending_operations: definition('runId operationId', 'operationType idempotencyKey inputDigest payload providerReference lastKnownState state attempts outcome intendedDecision holdId offerId orderReference', [['operationType', 'idempotencyKey'], ['orderReference']]),
  event_receipts: definition('runId consumerId eventId', 'inputDigest eventType handlerId inputVersions state outcome'),
  notification_outbox: definition('runId jobId', 'idempotencyKey inputDigest offerId messageKind messageVersion recipientId recipientReference transport state outcome attempts payload', [['idempotencyKey']]),
  forecast_snapshots: definition('runId forecastId', 'inputVersion policyVersion modelVersion asOf output provenance', [], [], true),
  plan_snapshots: definition('runId planId', 'forecastId inputVersion constraintVersion policyVersion output provenance', [], [], true),
  policy_versions: definition('runId policyVersion', 'seedDigest sourceVersion effectiveFrom effectiveTo source publisher publishedAt', [['seedDigest']], [], true),
  scheme_rule_links: definition('runId policyVersion linkId', 'schemeId ruleId effectiveFrom effectiveTo source status', [], [['policy_versions', 'policyVersion']], true),
  eligibility_rules: definition('runId policyVersion ruleId', 'effect matchField operator value lower upper min max effectiveFrom effectiveTo source status', [], [['policy_versions', 'policyVersion']], true),
  price_plans: definition('runId policyVersion pricePlanId priceEntryId', 'schemeId configurationId matchField matchKey value monthlyPoints unit effectiveFrom effectiveTo source status', [], [['policy_versions', 'policyVersion']], true),
  grade_allowances: definition('runId policyVersion companyId schemeId gradeId', 'monthlyPoints unit effectiveFrom effectiveTo source status', [], [['policy_versions', 'policyVersion']], true),
  policy_assumptions: definition('runId policyVersion key', 'value unit status basis source sourceDate effectiveFrom effectiveTo', [], [['policy_versions', 'policyVersion']], true),
  identity_sessions: definition('runId sessionIdHash', 'principalId employeeId roles environmentId expiresAt actingPrincipalId'),
  renewal_cases: definition('runId caseId', 'employeeId renewalId owner status reason trigger nextAction dueAt openedAt lastUpdatedAt renewalDeadline renewalDeadlineState policyVersion history remedy fictional', [], [['employees', 'employeeId']]),
  tick_runs: definition('runId tickId', 'commandId eventId targetClock handlerOrder outcomes state inputDigest'),
  comparison_results: definition('runId resultId', 'experimentId kind completedAt policyVersion manifest result', [], [], true),
  comparison_jobs: definition('runId jobId', 'experimentId status request progress startedAt finishedAt resultId reason requestedBy instanceId'),
});
export const createState = () => ({ tables: Object.fromEntries(Object.keys(TABLES).map((table) => [table, []])) });
export const FOUNDATION_TABLES = Object.freeze(Object.keys(TABLES).filter((table) => !['policy_versions', 'scheme_rule_links', 'eligibility_rules', 'price_plans', 'grade_allowances', 'policy_assumptions'].includes(table)));
