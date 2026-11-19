import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';

const SCRIPT = new URL('../../scripts/gcsp/fucq482-cutover-rehearsal.mjs', import.meta.url).pathname;
const SCRATCH = mkdtempSync('/private/tmp/f482-refusal-');
after(() => rmSync(SCRATCH, { recursive: true, force: true }));
const run = (env) => spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20000 });

test('the rehearsal refuses without an owned SCRATCH', () => {
  const r = run({});
  assert.equal(r.status, 2);
  assert.match(r.stderr, /REFUSED: SCRATCH is not set/);
});

test('the rehearsal refuses a scratch directory in a cloud-synced folder', () => {
  const r = run({ SCRATCH: '/Users/someone/Library/CloudStorage/OneDrive-Org/scratch' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cloud-synced folder/);
});

test('the rehearsal refuses a source revision that is not 40 hex characters', () => {
  const r = run({ SCRATCH, PROOF_RUN_TOKEN: 'abc-123-run', PROOF_SOURCE_REVISION: 'main' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PROOF_SOURCE_REVISION must be the parent-verified 40-hex/);
});

test('the rehearsal refuses a database that is not a local JDBC URL', () => {
  const r = run({ SCRATCH, PROOF_RUN_TOKEN: 'abc-123-run', PROOF_SOURCE_REVISION: 'a'.repeat(40), GCSP_TEST_DATABASE_URL: 'jdbc:postgresql://db.example.com:5432/gcsp' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /localhost naming one database/);
});
