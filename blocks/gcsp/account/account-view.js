// Pure account projection. Authority, policy and the display clock come from the server.
const copy = (value) => value == null ? null : structuredClone(value);
const list = (value) => Array.isArray(value) ? value : [];
const fact = (label, value, unit = null) => ({ label, value: copy(value), unit, missingLabel: 'Not supplied' });
const failureStates = { unavailable: 'source-failure', forbidden: 'refused', 'stale-run': 'refused',
  conflict: 'conflict', 'stale-version': 'conflict', invalid: 'validation', 'not-found': 'not-found' };

export function toDraftView(envelope) {
  if (envelope?.status !== 'ok') return { state: failureStates[envelope?.status] ?? 'source-failure',
    draft: null, failure: copy(envelope), view: copy(envelope?.view) };
  const draft = copy(envelope.value);
  return { state: draft.requiresRefresh ? 'context-changed' : draft.draftStage === 'intent' ? 'intent' : 'complete',
    draft, failure: null, view: copy(draft.view) };
}

function contractView(contract, asOf, drivers, actions) {
  const driver = drivers.find((row) => row.driverId === contract.driverId) ?? null;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(contract.contractEndDate ?? '')
    ? Date.parse(`${contract.contractEndDate}T00:00:00.000Z`) : NaN;
  const today = typeof asOf === 'string' ? Date.parse(`${asOf.slice(0, 10)}T00:00:00.000Z`) : NaN;
  return { ...copy(contract), driver: copy(driver), daysRemaining: Number.isFinite(end) && Number.isFinite(today)
    ? Math.ceil((end - today) / 86400000) : null,
  action: copy(actions.find((row) => row.action === 'replace' && row.oldContractId === contract.contractId
    && row.slotId === contract.slotId && row.schemeId === contract.schemeId)),
  media: copy(contract.media),
  facts: [fact('Status', contract.status), fact('Driver', driver?.name), fact('Scheme', contract.schemeId),
    fact('Actual collection', contract.actualCollectionDate), fact('Contract end', contract.contractEndDate),
    fact('Term', contract.months, 'months'), fact('Annual mileage', contract.annualMileage, contract.mileageUnit),
    fact('Current mileage', contract.currentOdometer?.value, contract.currentOdometer?.unit),
    fact('Earliest collection', contract.earliestCollectionDate), fact('Latest collection', contract.latestCollectionDate),
    fact('Order reference', contract.orderNumber), fact('Registration', contract.registration), fact('Delivered VIN', contract.vin),
    fact('Returned', contract.returnedDate), fact('Returned mileage', contract.returnedMileage, 'mi')],
  };
}

export function toAccountView(envelope, { draft = null } = {}) {
  if (envelope?.status !== 'ok' || !envelope.value || typeof envelope.value !== 'object') return {
    state: failureStates[envelope?.status] ?? 'source-failure', backendState: null,
    account: null, currentContracts: [], slots: [], histories: [], actions: [],
    failure: copy(envelope), view: copy(envelope?.view), supportOwner: envelope?.view?.supportOwner ?? 'scheme-support',
  };
  const value = envelope.value;
  const actions = value.state === 'ready' ? list(value.actions).filter((row) => row.enabled === true
    && ['order', 'replace'].includes(row.action)).map(copy) : [];
  const drivers = list(value.drivers).map(copy);
  const contracts = list(value.contracts ?? (value.currentContract ? [value.currentContract] : []))
    .map((row) => contractView(row, value.asOf, drivers, actions));
  const histories = list(value.histories).map((history) => ({ ...copy(history),
    count: list(history.entries).length, state: list(history.entries).length ? 'history' : 'empty-history',
    entries: list(history.entries).map((entry) => contractView(entry, value.asOf, drivers, [])) }));
  const account = copy(value.account);
  return { state: value.state === 'ready' ? actions.some((row) => row.action === 'replace') ? 'ready-replacement' : 'ready-new'
    : ['unknown-scheme', 'unknown-company', 'unknown-grade'].includes(value.state) ? 'unsupported-scheme' : value.state,
  backendState: value.state, asOf: value.asOf ?? null, account, drivers,
  additionalDrivers: drivers.filter((driver) => driver.kind !== 'employee'),
  identityFacts: [fact('Name', account?.name), fact('Date of birth', account?.dateOfBirth), fact('Address', account?.address),
    fact('Company', account?.company ?? account?.companyId), fact('Employee number', account?.employeeNumber),
    fact('Band or grade', account?.grade ?? account?.gradeId), fact('Phone', account?.contact?.phone),
    fact('Email', account?.contact?.email), fact('Allowance override', account?.allowanceOverride),
    fact('Override end', account?.allowanceOverrideEndDate)],
  currentContracts: contracts, primaryContract: contracts.find((row) => row.contractId === value.currentContract?.contractId) ?? null,
  contractState: contracts.length ? 'current-contract' : 'no-current-car',
  slots: list(value.slots).map((slot) => ({ ...copy(slot),
    action: copy(actions.find((row) => row.slotId === slot.entitlementSlotId)) })),
  histories, historyState: histories.some((history) => history.count > 0) ? 'history' : 'no-history', actions,
  allowance: copy(value.allowance), choices: copy(value.choices), contextVersion: value.contextVersion ?? null,
  assumptions: copy(value.assumptions), versions: copy(value.versions), view: copy(value.view),
  supportOwner: value.view?.supportOwner ?? 'scheme-support', failure: null,
  draft: draft ? toDraftView(draft) : null };
}

export function journeyIntent(action) {
  return { mode: action.action === 'replace' ? 'replacement' : 'new', oldContractId: action.oldContractId ?? null,
    slotId: action.slotId, schemeId: action.schemeId };
}
