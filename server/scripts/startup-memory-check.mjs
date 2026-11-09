#!/usr/bin/env node
// Starts the hosted runtime as Render does (GCSP_RUNTIME=1, memory, offline) and fails if its peak RSS
// reaches the ceiling. FUCQ-190: gcsp-api must start inside a 512 MiB instance with headroom.
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const STARTUP_RSS_CEILING_MIB = 400;
const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const PROBE = new URL('./startup-memory-probe.mjs', import.meta.url).href;
const MIB = 1024 * 1024;
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function freePort() {
  const probe = createServer();
  await new Promise((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address();
  await new Promise((done) => probe.close(done));
  return port;
}
const residentBytes = (pid) => {
  try { return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim()) * 1024; } catch { return 0; }
};

/** Measures one start-up until /health/vehicle-evidence is ready plus `settleMs`; never reads or sends secrets. */
export async function measureStartupMemory({ serverDir = SERVER_DIR, ceilingMiB = STARTUP_RSS_CEILING_MIB,
  readyTimeoutMs = 240000, settleMs = 5000 } = {}) {
  const scratch = await mkdtemp(join(tmpdir(), 'gcsp-startup-memory-'));
  const port = await freePort(); const report = join(scratch, 'report.json');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch, PORT: String(port),
    GCSP_RUNTIME: '1', GCSP_REPOSITORY_MODE: 'memory', GCSP_OFFLINE: '1', GCSP_PUBLIC_ORIGIN: `http://localhost:${port}`,
    DEMO_ACCESS_KEY: `memory-check-${randomBytes(9).toString('hex')}`, GCSP_STARTUP_MEMORY_REPORT: report };
  const child = spawn(process.execPath, ['--import', PROBE, 'index.js'], { cwd: resolve(serverDir), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk) => { output = (output + chunk).slice(-4000); });
  const exited = once(child, 'exit'); const started = Date.now();
  try {
    let readyMs = null; let readyRssBytes = 0;
    while (readyMs === null) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Runtime exited before readiness. Output tail: ${output.slice(-600)}`);
      if (Date.now() - started > readyTimeoutMs) throw new Error(`Runtime was not ready in ${readyTimeoutMs} ms. Output tail: ${output.slice(-600)}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health/vehicle-evidence`);
        if (response.status === 200) { readyMs = Date.now() - started; readyRssBytes = residentBytes(child.pid); }
        await response.arrayBuffer();
      } catch { /* not listening yet */ }
      if (readyMs === null) await pause(250);
    }
    await pause(settleMs);
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000); await exited; clearTimeout(timer);
    const { maxRssBytes } = JSON.parse(await readFile(report, 'utf8'));
    const peakRssMiB = Math.round(maxRssBytes / MIB);
    return { peakRssMiB, readyRssMiB: Math.round(readyRssBytes / MIB), readyMs, ceilingMiB, node: process.version,
      platform: process.platform, pass: peakRssMiB < ceilingMiB };
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--server');
  try {
    const measured = await measureStartupMemory(at > 0 ? { serverDir: process.argv[at + 1] } : {});
    console.log(JSON.stringify(measured)); if (!measured.pass) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
