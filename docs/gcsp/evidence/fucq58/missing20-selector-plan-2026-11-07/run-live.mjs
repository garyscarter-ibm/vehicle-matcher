import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { projectSelector } from './selector.mjs';

const base = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(base, '../../../../..');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = p => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const planPath = path.join(base, 'execution-plan.json');
const plan = read(planPath);
if (process.argv[2] !== 'live' || process.env.BMW_MISSING20_SELECTOR_GRANT !== plan.id) throw new Error('exact-parent-selector-grant-required');
const release = read(path.join(base, 'parent-release.json'));
if (release.status !== 'released-once' || release.allocationId !== plan.id || release.planSha256 !== sha(planPath)) throw new Error('exact-parent-release-required');
for (const [relative, expected] of Object.entries({ ...plan.codePins, ...plan.inputPins })) {
  if (sha(path.resolve(root, relative)) !== expected) throw new Error('selector-input-pin-changed');
}
if (sha(process.execPath) !== plan.runtime.sha256) throw new Error('selector-runtime-pin-changed');
const destination = plan.outputRoot;
if (path.resolve(destination) !== destination || fs.lstatSync(destination).isSymbolicLink()) throw new Error('owned-output-required');
const owner = read(path.join(destination, 'output-ownership.json'));
if (owner.allocationId !== plan.id) throw new Error('owned-output-identity');
const write = (name, value) => fs.writeFileSync(path.join(destination, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
write('execution-once.json', { allocationId: plan.id, state: 'consumed', planSha256: sha(planPath), consumedAt: new Date().toISOString() });
const events = [];
const event = value => { events.push(value); fs.appendFileSync(path.join(destination, 'source-events.jsonl'), JSON.stringify(value) + '\n', { mode: 0o600 }); };
let receipt = { allocationId: plan.id, method: 'GET', url: plan.request.url, sourceRequests: 0, solverRequests: 0, newAdmissions: 0, capacityCredit: 0, acceptance: false };
try {
  const started = Date.now();
  event({ attempt: 1, method: 'GET', phase: 'started', startedAt: new Date().toISOString() });
  receipt.sourceRequests = 1;
  const html = await new Promise((resolve, reject) => {
    let settled = false;
    const settle = (error, value) => { if (settled) return; settled = true; clearTimeout(deadline); if (error) reject(error); else resolve(value); };
    const request = https.get(plan.request.url, { headers: { 'User-Agent': 'BMW-public-selector-observation/1.0', 'Cache-Control': 'no-store', Accept: 'text/html' } }, response => {
      event({ attempt: 1, method: 'GET', phase: 'headers-received', at: new Date().toISOString(), status: response.statusCode });
      receipt.httpStatus = response.statusCode;
      const type = String(response.headers['content-type'] || '').split(';')[0].toLowerCase();
      if (response.statusCode !== 200 || type !== 'text/html' || response.headers['content-encoding']) {
        response.destroy(); settle(new Error('selector-status-or-content-refused')); return;
      }
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > plan.limits.responseBytes) { response.destroy(); settle(new Error('selector-response-byte-limit')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        receipt.responseBytes = buffer.length; receipt.elapsedMilliseconds = Date.now() - started;
        event({ attempt: 1, method: 'GET', phase: 'body-complete', at: new Date().toISOString(), decodedBytes: buffer.length });
        try { settle(null, new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer)); }
        catch { settle(new Error('selector-invalid-utf8')); }
      });
      response.on('error', error => settle(error));
    });
    const deadline = setTimeout(() => { request.destroy(); settle(new Error('selector-request-timeout')); }, plan.limits.requestMilliseconds);
    request.on('error', error => settle(error));
  });
  const projection = projectSelector(html, plan.limits.maximumLeads, plan.limits.maximumOccurrences);
  if (Buffer.byteLength(JSON.stringify(projection)) > plan.limits.projectionBytes) throw new Error('selector-projection-byte-limit');
  write('selector-observation.json', projection);
  receipt = { ...receipt, status: projection.status, observationSha256: sha(path.join(destination, 'selector-observation.json')), literalLeads: projection.leads.length };
} catch (error) {
  const errorCode = typeof error.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code : null;
  const allowed = new Set(['selector-status-or-content-refused','selector-response-byte-limit','selector-request-timeout','selector-projection-byte-limit','selector-input-limit','selector-occurrence-limit','selector-lead-limit','selector-invalid-utf8']);
  receipt = { ...receipt, status: 'stopped', errorType: error.name, errorCode, reason: allowed.has(error.message) ? error.message : 'transport-or-stream-refused' };
  event({ attempt: 1, method: 'GET', phase: 'stopped', at: new Date().toISOString(), reason: receipt.reason, errorCode });
  process.exitCode = 1;
} finally {
  write('receipt.json', receipt);
  process.stdout.write(JSON.stringify(receipt) + '\n');
}
