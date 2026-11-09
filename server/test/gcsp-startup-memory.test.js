// FUCQ-190: the hosted runtime (memory mode) must start well inside Render's 512 MiB instance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { measureStartupMemory, STARTUP_RSS_CEILING_MIB } from '../scripts/startup-memory-check.mjs';

test(`hosted memory-mode start-up peaks under ${STARTUP_RSS_CEILING_MIB} MiB RSS`, { timeout: 300000 }, async () => {
  const measured = await measureStartupMemory();
  assert.equal(STARTUP_RSS_CEILING_MIB, 400);
  assert.ok(measured.pass, `Start-up peak RSS ${measured.peakRssMiB} MiB reached the ${STARTUP_RSS_CEILING_MIB} MiB ceiling: ${JSON.stringify(measured)}`);
});
