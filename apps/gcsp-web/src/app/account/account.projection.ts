import { AccountAction, AccountContract, AccountDriver, AccountFailure, AccountProjection, AccountResult, AccountView,
  ContractTerms, ContractView, DisplayFact, DraftView, EvidenceRecord, JourneyIntent, ManualDraft } from './account.types';

const copy = <T>(value: T): T => structuredClone(value);
const nullable = <T>(value: T | null | undefined): T | null => value == null ? null : copy(value);
const fact = (label: string, value: unknown, unit: string | null = null): DisplayFact => ({ label, value: nullable(value), unit, missingLabel: 'Not supplied' });
const support = (view: EvidenceRecord | null | undefined): string => typeof view?.['supportOwner'] === 'string' ? view['supportOwner'] : 'scheme-support';
const failures: Partial<Record<AccountFailure['status'], string>> = { forbidden: 'refused', refused: 'refused', conflict: 'conflict',
  'stale-version': 'conflict', invalid: 'validation', 'not-found': 'not-found', 'stale-run': 'restarted',
  unauthenticated: 'authentication-required', 'authentication-required': 'authentication-required', 'account-changed': 'account-changed', aborted: 'aborted' };

export function toDraftView(result: AccountResult<ManualDraft>): DraftView {
  if (result.status !== 'ok') return { state: failures[result.status] ?? 'source-failure', draft: null, failure: copy(result), view: nullable(result.view) };
  const draft = copy(result.value);
  return { state: draft.requiresRefresh ? 'context-changed' : draft.draftStage === 'intent' ? 'intent' : 'complete', draft, failure: null, view: nullable(draft.view) };
}

function calendarDay(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
function contractView(contract: AccountContract, asOf: string | null | undefined, drivers: readonly AccountDriver[], actions: readonly AccountAction[]): ContractView {
  const driver = drivers.find((row) => row.driverId === contract.driverId) ?? null;
  const end = calendarDay(contract.contractEndDate);
  const today = asOf && Number.isFinite(Date.parse(asOf)) ? calendarDay(asOf.slice(0, 10)) : null;
  return { ...copy(contract), driver: nullable(driver), daysRemaining: end !== null && today !== null ? Math.ceil((end - today) / 86400000) : null,
    action: nullable(actions.find((row) => row.action === 'replace' && row.oldContractId === contract.contractId && row.slotId === contract.slotId && row.schemeId === contract.schemeId)),
    media: nullable(contract.media), facts: [fact('Status', contract.status), fact('Driver', driver?.name), fact('Scheme', contract.schemeId),
      fact('Actual collection', contract.actualCollectionDate), fact('Contract end', contract.contractEndDate), fact('Term', contract.months, 'months'),
      fact('Annual mileage', contract.annualMileage, contract.mileageUnit), fact('Current mileage', contract.currentOdometer?.value, contract.currentOdometer?.unit),
      fact('Earliest collection', contract.earliestCollectionDate), fact('Latest collection', contract.latestCollectionDate), fact('Car order number', contract.orderNumber),
      fact('Registration', contract.registration), fact('Delivered VIN', contract.vin), fact('Returned', contract.returnedDate), fact('Returned mileage', contract.returnedMileage, 'mi')] };
}

export function toAccountView(result: AccountResult<AccountProjection>, options: { readonly draft?: AccountResult<ManualDraft> | null } = {}): AccountView {
  if (result.status !== 'ok') return { state: failures[result.status] ?? 'source-failure', backendState: null, asOf: null, account: null,
    drivers: [], additionalDrivers: [], identityFacts: [], currentContracts: [], currentOrders: [], currentCarRelationships: [], primaryContract: null,
    contractState: 'no-current-car', carReturned: false, slots: [], histories: [], historyState: 'no-history', actions: [], allowance: null, choices: null,
    contextVersion: null, assumptions: null, versions: null, view: nullable(result.view), supportOwner: support(result.view), failure: copy(result), draft: null };
  const value = result.value;
  const actions = value.state === 'ready' ? value.actions.filter((row) => row.enabled === true && ['order', 'replace'].includes(row.action)).map(copy) : [];
  const drivers = copy(value.drivers ?? []);
  const relationships = copy(value.currentCarRelationships ?? []);
  const moved = new Set(relationships.filter((row) => row.oldCar?.contractId && row.currentCar?.kind !== 'contract').map((row) => row.oldCar?.contractId));
  const contracts = (value.contracts ?? (value.currentContract ? [value.currentContract] : [])).filter((row) => !moved.has(row.contractId))
    .map((row) => contractView(row, value.asOf, drivers, actions));
  const currentOrders = relationships.flatMap((row) => row.currentCar?.kind === 'order' ? [{ orderUuid: row.currentCar.orderUuid,
    vin: row.currentCar.vin ?? null, collectedAt: row.newCar?.collectedAt ?? null }] : []);
  const histories = (value.histories ?? []).map((history) => ({ ...copy(history), count: history.entries.length,
    state: history.entries.length ? 'history' : 'empty-history', entries: history.entries.map((entry) => contractView(entry, value.asOf, drivers, [])) }));
  const account = nullable(value.account);
  return { state: value.state === 'ready' ? actions.some((row) => row.action === 'replace') ? 'ready-replacement' : 'ready-new'
    : ['unknown-scheme', 'unknown-company', 'unknown-grade'].includes(value.state) ? 'unsupported-scheme' : value.state,
    backendState: value.state, asOf: value.asOf ?? null, account, drivers, additionalDrivers: drivers.filter((driver) => driver.kind !== 'employee'),
    identityFacts: [fact('Name', account?.name), fact('Date of birth', account?.dateOfBirth), fact('Address', account?.address),
      ...(account?.company?.trim() ? [fact('Company', account.company)] : []), fact('Employee number', account?.employeeNumber),
      fact('Band or grade', account?.grade ?? account?.gradeId), fact('Phone', account?.contact?.phone), fact('Email', account?.contact?.email),
      fact('Allowance override', account?.allowanceOverride), fact('Override end', account?.allowanceOverrideEndDate)],
    currentContracts: contracts, currentOrders, currentCarRelationships: relationships,
    primaryContract: contracts.find((row) => row.contractId === value.currentContract?.contractId) ?? null,
    contractState: contracts.length || currentOrders.length ? 'current-contract' : 'no-current-car',
    carReturned: relationships.some((row) => row.currentCar === null && row.oldCar?.status === 'returned'),
    slots: (value.slots ?? []).map((slot) => ({ ...copy(slot), action: nullable(actions.find((row) => row.slotId === slot.entitlementSlotId)) })),
    histories, historyState: histories.some((history) => history.count > 0) ? 'history' : 'no-history', actions,
    allowance: nullable(value.allowance), choices: nullable(value.choices), contextVersion: value.contextVersion ?? null,
    assumptions: nullable(value.assumptions), versions: nullable(value.versions), view: nullable(value.view), supportOwner: support(value.view), failure: null,
    draft: options.draft ? toDraftView(options.draft) : null };
}

export function journeyIntent(action: AccountAction): JourneyIntent {
  return { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId ?? null, slotId: action.slotId, schemeId: action.schemeId };
}
export function matchingDraft(account: AccountProjection, action: AccountAction, draft: ManualDraft): boolean {
  const intent = journeyIntent(action);
  return account.state === 'ready' && account.actions.some((row) => row.enabled && row.action === action.action && row.slotId === action.slotId
    && row.schemeId === action.schemeId && row.oldContractId === action.oldContractId) && !draft.requiresRefresh && draft.contextVersion === account.contextVersion
    && draft.choices.mode === intent.mode && draft.choices.oldContractId === intent.oldContractId && draft.choices.slotId === intent.slotId && draft.choices.schemeId === intent.schemeId;
}

// Preserve an explicit unknown/zero allowance; only the trusted choices scheme can fill an absent one.
export function contractTerms(contract: AccountContract, account: AccountProjection): ContractTerms | null {
  if (contract.terms?.kind && contract.terms.kind !== 'points-monthly') return copy(contract.terms);
  const source = contract.terms;
  const cost = source && Object.hasOwn(source, 'value') ? source.value : contract.vehicle?.['points'];
  const allowance = account.allowance;
  const budget = source && Object.hasOwn(source, 'allowance') ? source.allowance
    : contract.schemeId === account.choices?.['schemeId'] && allowance?.['status'] !== 'unknown'
      ? allowance?.['monthlyPoints'] ?? allowance?.['value'] ?? null : null;
  if (!source && cost == null && budget == null) return null;
  return { ...copy(source ?? {}), kind: 'points-monthly', value: typeof cost === 'number' || cost === null || typeof cost === 'object' ? cost as ContractTerms['value'] : null,
    allowance: typeof budget === 'number' || budget === null || typeof budget === 'object' ? budget as ContractTerms['allowance'] : null };
}
