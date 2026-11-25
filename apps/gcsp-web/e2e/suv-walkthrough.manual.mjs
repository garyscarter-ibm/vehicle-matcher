import assert from 'node:assert/strict';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startComposition } from './composition.mjs';

const run = process.env.PROOF_RUN_TOKEN ?? '';
const sourceRevision = process.env.PROOF_SOURCE_REVISION ?? '';
const output = process.env.GCSP_E2E_OUTPUT ?? '';
assert.match(run, /^[a-zA-Z0-9-]+$/);
assert.match(sourceRevision, /^[a-f0-9]{40}$/);
assert.ok(path.isAbsolute(output) && !/OneDrive|CloudStorage/i.test(output));
const directory = path.join(output, 'f340');
const sessionFile = path.join(directory, 'manual-session.json');
const stopFile = path.join(directory, `manual-stop-${run}`);
mkdirSync(directory, { recursive: true });
assert.equal(existsSync(stopFile), false, 'This run must not reuse an existing stop marker');
const session = { schema: 'gcsp-f340-manual/1', mode: 'manual', run, sourceRevision, state: 'starting',
  startedAt: new Date().toISOString(), stopFile, automatedJourneyTestsRun: false };
const publish = () => {
  const temporary = `${sessionFile}.${run}.tmp`;
  writeFileSync(temporary, JSON.stringify(session, null, 2), { mode: 0o600 });
  renameSync(temporary, sessionFile);
};
publish();
let suite;
let stopReason;
const stopForSignal = (signal) => { stopReason = signal; process.exitCode = 1; };
const onInt = () => stopForSignal('SIGINT');
const onTerm = () => stopForSignal('SIGTERM');
process.once('SIGINT', onInt);
process.once('SIGTERM', onTerm);
try {
  suite = await startComposition({ caseId: 'f340' });
  const probes = [];
  for (const [label, subject, route, role] of [['Presenter', 'demo-presenter', 'presenter', 'presenter'],
    ['Paula', 'demo-paula', 'preferences', 'employee']]) {
    const page = await suite.newPage(`manual-startup-${label.toLowerCase()}`, subject, route);
    try {
      const read = await suite.call(page, 'GET', '/context');
      assert.equal(read.status, 200, `${label} signed context HTTP`);
      assert.equal(read.body.status, 'ok', `${label} signed context`);
      const context = read.body.value;
      assert.equal(context.subject, subject, `${label} subject`);
      assert.ok(context.roles.includes(role), `${label} role`);
      assert.equal(context.runId, suite.receipt.composition.runId, `${label} current run`);
      probes.push({ label, subject: context.subject, runId: context.runId, roles: context.roles });
    } finally { await page.close(); }
  }
  if (!stopReason) {
    Object.assign(session, { state: 'ready', readyAt: new Date().toISOString(), origins: suite.origins,
      links: { presenter: `${suite.origins.web}/gcsp/presenter`, paula: `${suite.origins.web}/gcsp/preferences` },
      startupSignInProbes: probes });
    suite.receipt.manualSession = { mode: 'manual', run, readyAt: session.readyAt, stopFile,
      startupSignInProbes: probes, automatedJourneyTestsRun: false };
    publish();
  }
  while (!stopReason) {
    if (existsSync(stopFile)) { stopReason = 'stop-file'; break; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} catch (error) {
  session.state = 'failed';
  session.failure = { name: error.name, reason: 'Manual startup/session failed; inspect the bounded composition logs.' };
  process.exitCode = 1;
} finally {
  session.stopReason = stopReason ?? 'startup-failed';
  session.stopRequestedAt = new Date().toISOString();
  if (suite) {
    suite.receipt.manualSession ??= { mode: 'manual', run, automatedJourneyTestsRun: false };
    Object.assign(suite.receipt.manualSession, { stopReason: session.stopReason, stopRequestedAt: session.stopRequestedAt });
    try { await suite.close(); }
    catch { session.state = 'failed'; process.exitCode = 1; }
    session.compositionClosed = !!suite.receipt.finishedAt && suite.receipt.cleanupErrors?.length === 0;
  }
  if (session.state !== 'failed') session.state = stopReason === 'stop-file' && session.compositionClosed ? 'stopped' : 'interrupted';
  session.finishedAt = new Date().toISOString();
  publish();
  process.removeListener('SIGINT', onInt);
  process.removeListener('SIGTERM', onTerm);
}
