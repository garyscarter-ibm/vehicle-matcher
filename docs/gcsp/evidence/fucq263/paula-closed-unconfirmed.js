// FUCQ-263 evidence: gcsp-help.html with a read-only fixture of a closed case whose preference change Paula never confirmed.
import { defineGcspHelp } from '../../../../blocks/gcsp/cases/gcsp-help.js';
import { fixtureAdapter, fixtureAccountAdapter, caseFixture } from '../../../../blocks/gcsp/cases/fixtures.js';
const waiting = caseFixture('waiting'); const at = '2026-11-05T15:00:00.000Z';
const closed = { ...waiting, status: 'closed', lastUpdatedAt: at, history: [...waiting.history, { at, actorId: 'synthetic-greg', actorRole: 'scheme-team',
  status: 'closed', reason: 'Closed by the scheme team before the change was confirmed.', nextAction: 'None.', dueAt: null }] };
const host = document.querySelector('gcsp-help');
host.adapter = { ...fixtureAdapter('waiting'), async readCases() { return { status: 'ok', value: { cases: [closed], asOf: at, policyVersion: 'synthetic-policy' } }; } };
host.accountAdapter = fixtureAccountAdapter;
defineGcspHelp();
