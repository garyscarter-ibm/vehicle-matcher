// FUCQ-264 evidence: gcsp-case-queue.html with a read-only fixture of a closed case whose preference change the employee never confirmed.
import { defineGcspCaseQueue } from '../../../../blocks/gcsp/cases/gcsp-case-queue.js';
import { queueFixtureAdapter, queueOptionsFixture } from '../../../../blocks/gcsp/cases/queue-fixtures.js';
import { caseFixture } from '../../../../blocks/gcsp/cases/fixtures.js';
const waiting = caseFixture('waiting'); const at = '2026-11-05T15:00:00.000Z';
const closed = { ...waiting, caseId: 'synthetic-case-closed', status: 'closed', lastUpdatedAt: at, nextAction: 'None.', history: [...waiting.history, { at,
  actorId: 'synthetic-greg', actorRole: 'scheme-team', status: 'closed', reason: 'Closed by the scheme team before the change was confirmed.', nextAction: 'None.', dueAt: null }] };
const base = queueFixtureAdapter('populated'); const host = document.querySelector('gcsp-case-queue');
host.adapter = { ...base, async listCases() { return { status: 'ok', value: { cases: [structuredClone(closed)], asOf: at, policyVersion: 'synthetic-policy' } }; },
  async readOptions() { return { status: 'ok', value: { ...queueOptionsFixture(closed), nextStatuses: [] } }; } };
defineGcspCaseQueue();
