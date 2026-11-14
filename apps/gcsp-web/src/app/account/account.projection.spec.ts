import { describe, expect, it } from 'vitest';
import { contractTerms, journeyIntent, matchingDraft, toAccountView, toDraftView } from './account.projection';
import { accountSnapshot, savedDraft } from './account.test-data';
import { AccountProjection, AccountResult, CurrentCarRelationship } from './account.types';

const project = (value: AccountProjection) => toAccountView({ status: 'ok', value });
describe('native account projection from frozen service facts', () => {
  it('retains identity, drivers, full contract/history evidence and authoritative display time without mutating input', () => {
    const input = accountSnapshot(); const original = structuredClone(input); const model = project(input);
    expect(model.state).toBe('ready-replacement'); expect(model.primaryContract?.daysRemaining).toBe(26);
    expect(model.account).toEqual(input.account); expect(model.drivers).toEqual(input.drivers);
    expect(model.additionalDrivers[0].driverId).toBe('nominated:employee-paula');
    expect(model.primaryContract?.facts.find((row) => row.label === 'Current mileage')?.value).toBe(5200);
    expect(model.primaryContract?.vehicle).toEqual(input.contracts?.[0].vehicle);
    expect(model.versions).toEqual(input.versions); expect(model.assumptions).toEqual(input.assumptions);
    expect(model.histories[0].entries[0]['source']).toEqual(input.histories?.[0].entries[0]['source']);
    expect(model.primaryContract?.action).toEqual(input.actions[0]); expect(input).toEqual(original);
    expect(model.account).not.toBe(input.account); expect(model.drivers).not.toBe(input.drivers);
  });
  it('keeps exact identities, provenance and the additional slot without inventing ordering authority', () => {
    const input = accountSnapshot(); const first = input.contracts![0];
    const second = { ...first, contractId: 'second', slotId: 'second-slot', schemeId: 'other-scheme', driverId: input.drivers![1].driverId,
      vin: 'DELIVEREDVIN', orderNumber: '1234567', configurationId: 'config-only', orderUuid: 'stock-car', media: null,
      terms: { kind: 'points-monthly', value: 0, allowance: null }, technical: { assurance: 'model-level', fittedEquipment: null } };
    const value = { ...input, contracts: [first, second], slots: [...input.slots!, { entitlementSlotId: 'second-slot', ordering: { enabled: false, reason: 'outside-trusted-context' } }],
      histories: [...input.histories!, { schemeId: 'other-scheme', entries: [second], orderingSupported: false }] };
    const model = project(value); const car = model.currentContracts[1];
    expect(car.vin).toBe('DELIVEREDVIN'); expect(car.orderNumber).toBe('1234567'); expect(car['orderUuid']).toBe('stock-car'); expect(car['configurationId']).toBe('config-only');
    expect(car.terms).toEqual(second.terms); expect(car['technical']).toEqual(second.technical);
    expect(car.action).toBeNull(); expect(model.slots[1].action).toBeNull(); expect(model.histories.at(-1)?.count).toBe(1);
    expect(model.histories.at(-1)?.['orderingSupported']).toBe(false);
  });
  it('represents incomplete evidence, absent images and an unavailable clock explicitly', () => {
    const input = accountSnapshot(); const contract = { ...input.contracts![0], media: null, contractEndDate: null, months: 0, currentOdometer: null };
    const model = project({ ...input, asOf: null, contracts: [contract], currentContract: contract, histories: [] });
    expect(model.primaryContract?.media).toBeNull(); expect(model.primaryContract?.daysRemaining).toBeNull();
    expect(model.primaryContract?.facts.find((row) => row.label === 'Delivered VIN')).toEqual({ label: 'Delivered VIN', value: null, unit: null, missingLabel: 'Not supplied' });
    expect(model.primaryContract?.facts.find((row) => row.label === 'Term')?.value).toBe(0);
    expect(model.identityFacts.find((row) => row.label === 'Date of birth')?.value).toBeNull(); expect(model.historyState).toBe('no-history');
    expect(project({ ...input, contracts: [{ ...contract, contractEndDate: '2026-02-30' }] }).currentContracts[0].daysRemaining).toBeNull();
    const absent = project({ state: 'absent-hr-account', account: null, actions: [] });
    expect(absent.state).toBe('absent-hr-account'); expect(absent.account).toBeNull(); expect(absent.contractState).toBe('no-current-car');
  });
  it('never treats a planned order as a current-car change; confirmed handover/return suppresses the old contract', () => {
    const input = accountSnapshot(); const oldCar = { contractId: input.contracts![0].contractId, status: 'held' };
    const held: CurrentCarRelationship = { currentCar: { kind: 'contract', contractId: oldCar.contractId }, oldCar, newCar: { status: 'on-order' } };
    expect(project({ ...input, currentCarRelationships: [held] }).currentContracts).toHaveLength(1);
    const collected: CurrentCarRelationship = { currentCar: { kind: 'order', orderUuid: 'exact-car', vin: 'VIN' }, oldCar,
      newCar: { collectedAt: '2026-11-07T13:00:00.000Z', status: 'collected' }, contractVersion: 'lifecycle.current-car.v1' };
    const model = project({ ...input, currentCarRelationships: [collected] });
    expect(model.currentContracts).toEqual([]); expect(model.primaryContract).toBeNull();
    expect(model.currentOrders).toEqual([{ orderUuid: 'exact-car', vin: 'VIN', collectedAt: '2026-11-07T13:00:00.000Z' }]);
    expect(model.currentCarRelationships).toEqual([collected]); expect(model.contractState).toBe('current-contract');
    const returned = project({ ...input, currentCarRelationships: [{ currentCar: null, oldCar: { ...oldCar, status: 'returned' } }] });
    expect(returned.currentContracts).toEqual([]); expect(returned.carReturned).toBe(true); expect(returned.contractState).toBe('no-current-car');
  });
  it('preserves zero/unknown terms and borrows only an absent allowance from the trusted choices scheme', () => {
    const input = accountSnapshot(); const contract = input.contracts![0];
    expect(contractTerms(contract, input)).toEqual({ kind: 'points-monthly', value: 1100, allowance: 1300 });
    expect(contractTerms({ ...contract, terms: { value: 0 } }, input)).toEqual({ kind: 'points-monthly', value: 0, allowance: 1300 });
    expect(contractTerms({ ...contract, terms: { kind: 'points-monthly', value: 0, allowance: 0 } }, input)).toEqual({ kind: 'points-monthly', value: 0, allowance: 0 });
    expect(contractTerms({ ...contract, terms: { kind: 'points-monthly', value: null, allowance: null } }, input)).toEqual({ kind: 'points-monthly', value: null, allowance: null });
    const unknown = { status: 'unknown', value: null, provenance: { sourceRef: 'not-confirmed' } };
    expect(contractTerms({ ...contract, terms: { kind: 'points-monthly', value: unknown, allowance: unknown } }, input)?.allowance).toEqual(unknown);
    expect(contractTerms({ ...contract, schemeId: 'other-scheme' }, input)?.allowance).toBeNull();
    expect(contractTerms(contract, { ...input, allowance: { status: 'unknown', value: 999 } })?.allowance).toBeNull();
    expect(contractTerms({ ...contract, terms: { kind: 'purchase-money', value: 125, currency: 'GBP' } }, input)).toEqual({ kind: 'purchase-money', value: 125, currency: 'GBP' });
  });
  it('retains backend empty, refusal and support states without enabled actions', () => {
    const input = accountSnapshot();
    for (const state of ['not-yet-eligible', 'ordering-closed', 'no-entitlement', 'absent-hr-account', 'unsupported-scheme']) {
      const model = project({ ...input, state }); expect(model.state).toBe(state); expect(model.actions).toEqual([]);
    }
    expect(project({ ...input, state: 'unknown-grade' }).state).toBe('unsupported-scheme');
    for (const [status, state] of [['unavailable', 'source-failure'], ['forbidden', 'refused'], ['stale-version', 'conflict'], ['stale-run', 'restarted'], ['authentication-required', 'authentication-required']] as const) {
      const failure = { status, code: 'source-code', view: { supportOwner: 'hr-support' } };
      const model = toAccountView(failure); expect(model.state).toBe(state); expect(model.failure).toEqual(failure);
      expect(model.account).toBeNull(); expect(model.currentContracts).toEqual([]); expect(model.supportOwner).toBe('hr-support');
    }
  });
  it('projects saved intent/complete/stale states and matches only the permitted current draft', () => {
    const input = accountSnapshot(); const draft = savedDraft(); const action = input.actions[0];
    expect(journeyIntent(action)).toEqual(draft.choices); expect(matchingDraft(input, action, draft)).toBe(true);
    for (const changed of [{ requiresRefresh: true }, { contextVersion: 'old' }, { choices: { ...draft.choices, slotId: 'other-slot' } }]) expect(matchingDraft(input, action, { ...draft, ...changed })).toBe(false);
    expect(matchingDraft({ ...input, state: 'no-entitlement' }, action, draft)).toBe(false);
    const result: AccountResult<typeof draft> = { status: 'ok', value: draft };
    expect(toDraftView(result).state).toBe('intent'); expect(toDraftView({ status: 'ok', value: { ...draft, draftStage: 'complete' } }).state).toBe('complete');
    expect(toDraftView({ status: 'ok', value: { ...draft, requiresRefresh: true } }).state).toBe('context-changed');
    expect(toAccountView({ status: 'ok', value: input }, { draft: result }).draft?.draft).toEqual(draft);
    expect(toDraftView({ status: 'not-found', resourceType: 'manual-draft' }).state).toBe('not-found');
  });
});
