import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemoryRepository, createMemoryStore, inputDigest, ok } from '../../gcsp/repository/index.js';
import { PolicyService } from '../../gcsp/policy/index.js';
import { DemoIdentityAdapter } from '../../gcsp/identity/index.js';
import { createAllocationService } from '../../gcsp/allocation/index.js';
import { brief, stock, providerValue, fact, preference, instant } from './employee-recommendation.js';

export async function allocationFixture({ rule, cars = 2, claimResult, reverse = false, canonicalPeople = false } = {}) {
  const source = JSON.parse(await readFile(new URL('../../gcsp/policy/seed-v1.json', import.meta.url)));
  if (rule) source.assumptions.find((a) => a.key === 'allocation.tieBreak.rule').value = rule;
  // Explicit alternative test population: three same-scheme fictional people compete fairly.
  const people = source.assumptions.find((a) => a.key === 'identity.demo.principals').value;
  const originals = people.filter((p) => p.roles.includes('employee'));
  const first = originals[0];
  if (!canonicalPeople) for (const p of originals) for (const k of ['companyId', 'schemeId', 'gradeId']) p[k] = first[k];
  const policy = new PolicyService({ provider: { async loadVersions() { return [source]; } } });
  const store = createMemoryStore(); let now = instant; let current = { runId: 'allocation-run', environmentId: 'allocation-test' };
  const repository = createMemoryRepository({ store, now: () => now }); await repository.open();
  const scope = { ...current, principalId: 'backend', roles: [] };
  let serial = 0;
  const write = async (work) => { const id = `fixture:${++serial}`;
    const out = await repository.transaction(scope, { commandId: id, inputDigest: inputDigest(id) }, work);
    assert.equal(out.status, 'ok', JSON.stringify(out)); return out; };
  await write((tx) => tx.insert('runs', { ...current, current: true, status: 'active', policyVersion: source.policyVersion,
    clockInstant: instant, clockVersion: 1 }));
  const identity = new DemoIdentityAdapter({ repository, policy, currentRun: () => current, sessionNow: () => now });
  const presenter = await identity.createPresenterSession('presenter'); assert.equal(presenter.status, 'ok');
  const context = presenter.value.context;
  const employees = [];
  for (const p of originals) { const resolved = await identity.resolveEmployeeContext(context, p.employeeId);
    assert.equal(resolved.status, 'ok'); employees.push(resolved.value); }
  const clock = { async now(ctx) { return ok({ runId: ctx.runId, now: instant, clockVersion: 'clock-v1' }); } };
  await write(async (tx) => {
    for (const [i, employee] of employees.entries()) {
      const row = await tx.get({ table: 'employees', key: { runId: context.runId, employeeId: employee.employeeId } });
      const changed = await tx.compareAndSwap({ table: 'employees', key: { runId: context.runId, employeeId: employee.employeeId } }, row.value.version,
        { contract: { manualContext: { employeeFacts: providerValue().employeeFacts,
          contracts: [{ employeeId: employee.employeeId, schemeId: employee.schemeId, slotId: employee.entitlementSlotId,
            status: 'current', contractEndDate: `2026-12-${String(i + 1).padStart(2, '0')}` }] } } });
      if (changed.status !== 'ok') return changed;
      const input = brief(); input.preferences = { body: preference(i === 0 ? 'saloon' : 'estate') };
      const b = await tx.insert('briefs', { ...input, runId: context.runId, employeeId: employee.employeeId,
        entitlementSlotId: employee.entitlementSlotId, renewalId: `renewal:${employee.employeeId}`, status: 'confirmed',
        buddy: { searchConsent: true, holdConsent: true, paused: false, permissionVersion: 1 },
        policyVersion: context.policyVersion, confirmedBy: employee.principalId, confirmedAt: instant });
      if (b.status !== 'ok') return b;
    }
    for (let i = 1; i <= cars; i += 1) { const candidate = stock(i, { body: fact('estate') });
      const row = await tx.insert('stock', { runId: context.runId, orderUuid: candidate.orderUuid, orderNumber: String(i).padStart(7, '0'),
        configurationId: candidate.configurationId, state: 'available', available: true, facts: candidate.snapshot,
        release: { availability: candidate.availability, releasedAt: instant, trancheId: 'tranche-1' },
        visibility: { companyIds: [first.companyId], schemeIds: [first.schemeId], employeeIds: null } });
      if (row.status !== 'ok') return row;
    }
    return ok({ seeded: true });
  });
  if (reverse) { store.state.tables.employees.reverse(); store.state.tables.briefs.reverse(); store.state.tables.stock.reverse(); }
  const calls = []; const outcomes = new Map(); const occupied = new Set();
  const claim = { async tryClaim(employee, input) {
    assert.equal((await identity.requireRole(employee, 'employee')).status, 'ok');
    calls.push({ employee, input });
    if (outcomes.has(input.operationId)) return outcomes.get(input.operationId);
    const out = claimResult ? await claimResult(employee, input, calls.length)
      : occupied.has(input.orderUuid) ? { status: 'conflict', reason: 'car-occupied' } : ok({ claimId: input.operationId });
    if (out.status === 'ok') { outcomes.set(input.operationId, out); occupied.add(input.orderUuid); }
    return out;
  } };
  const create = (overrides = {}) => createAllocationService({ repository, policy, clock, identity, claim, ...overrides });
  const event = { eventId: 'tranche-1', eventType: 'stock-released', runId: context.runId, stockVersion: 'tranche-v1' };
  return { source, policy, repository, store, identity, presenter, context, employees, clock, calls, write, create, event,
    service: create(), expire: () => { now = '2026-11-06T12:00:00.000Z'; },
    retire: async () => {
      await write((tx) => tx.compareAndSwap({ table: 'runs', key: { runId: current.runId } }, 1, { current: false, status: 'historical' }));
      current = { ...current, runId: 'other-run' };
      const saved = await repository.transaction({ ...scope, ...current }, { commandId: 'new-run', inputDigest: inputDigest('new-run') },
        (tx) => tx.insert('runs', { ...current, current: true, status: 'active', policyVersion: source.policyVersion }));
      assert.equal(saved.status, 'ok', JSON.stringify(saved));
    }, stock };
}
