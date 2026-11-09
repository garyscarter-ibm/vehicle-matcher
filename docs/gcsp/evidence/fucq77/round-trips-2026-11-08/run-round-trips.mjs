// FUCQ-77 headless round trips: opens each sample deep link in headless Chrome and compares the resolved options.
// Usage: node run-round-trips.mjs --scratch <abs dir> [--probe] ; stops at once on 401/403/429 or a bot challenge.
// --probe loads link 0 only (kept in scratch); a full run reuses it and loads the rest. Ledger in scratch caps total requests.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configurationDeepLink, lineModels } from '../../../../../scripts/gcsp/demo-verifier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const REPORT = join(REPO, 'docs/gcsp/evidence/fucq-20/demo-collection-report.json');
const RECORDS = join(REPO, 'server/data/gcsp/vehicle-evidence/demo-fleet.v1/versions/7c9cc707ab44b36f9cb5eb64b54170b25d914d5ee7e31722384c737612c45a9c/configurations.jsonl');
const RESUME = process.argv.includes('--resume'); // second run: only links with no retained result, own request cap
const CAP = RESUME ? 330 : 600; const PORTS = [8960, 8969]; const STOP_STATUS = new Set([401, 403, 429]);
const BLOCKED_TYPES = new Set(['Image', 'Media', 'Font']);
const CHALLENGE = /access denied|captcha|verify (that )?you are (a )?human|are you a robot|unusual traffic/i;
// Render, telemetry and marketing hosts carry no option data; blocking them keeps the request count down.
const SKIPPED_HOSTS = new Set(['prod.cosy.bmw.cloud', 'sf-mco.aws.bmw.cloud', 'wcp-otelcol-public.envprd.conx.aws.bmw.cloud',
  'api.prod.pge.bmw.cloud', 'api.ems-prod.bmw.cloud']);
// Allowed-host calls the option comparison does not need: per-option what-ifs, prices, delivery, accessories, anonymous garage saves.
const SKIPPED_PATHS = [['what-if', /\/add-element-bulk-invocation\//], ['pricing', /\/pricing\//], ['otd', /\/otd\//],
  ['accessories', /\/accessories\/channels\//], ['garage', /\/garage\//], ['marketing-texts', /\/marketing-texts\//], ['classifiers', /\/classifiers\//]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const probe = process.argv.includes('--probe');
const scratch = arg('--scratch');
if (!scratch || !scratch.startsWith('/')) throw new Error('--scratch <absolute dir> is required');
const allowedHost = (host) => (host === 'configure.bmw.co.uk' || host.endsWith('.bmw.cloud')) && !SKIPPED_HOSTS.has(host);
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return 'invalid'; } };
const bump = (map, key, n = 1) => { map[key] = (map[key] || 0) + n; };
const merge = (into, from) => { for (const [k, v] of Object.entries(from)) bump(into, k, v); };
const sorted = (list) => [...new Set(list)].sort();
const diff = (a, b) => { const set = new Set(b); return a.filter((x) => !set.has(x)); };

async function freePort() {
  for (let port = PORTS[0]; port <= PORTS[1]; port++) {
    const ok = await new Promise((res) => { const s = createServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });
    if (ok) return port;
  }
  throw new Error('no free debugging port in 8960-8969');
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static async open(url) {
    const cdp = new Cdp(new WebSocket(url));
    await new Promise((res, rej) => { cdp.ws.onopen = res; cdp.ws.onerror = () => rej(new Error('ws error')); });
    cdp.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && cdp.pending.has(msg.id)) { const { res, rej } = cdp.pending.get(msg.id); cdp.pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
      else if (msg.method) for (const l of cdp.listeners) l(msg);
    };
    return cdp;
  }
  send(method, params = {}, ms = 20000) {
    const id = ++this.id;
    return Promise.race([new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params })); }),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${method}`)), ms))]);
  }
}

async function assemble(all, ledger, sample) {
  const completedAt = new Date().toISOString();
  const passed = all.filter((r) => r.pass).length; const failed = all.filter((r) => !r.pass).length;
  await writeFile(join(HERE, 'round-trips.json'), `${JSON.stringify({ observed: completedAt.slice(0, 10), results: all,
    summary: { required: sample.length, passed, failed, notRun: sample.length - all.length } }, null, 2)}\n`);
  await writeFile(join(HERE, 'receipt.json'), `${JSON.stringify({ startedAt: ledger.startedAt, completedAt, elapsedMs: ledger.elapsedMs,
    pageLoads: ledger.loads, bmwRequests: { total: ledger.bmwRequests, cap: CAP, byHost: ledger.byHost },
    blockedByHost: ledger.blockedByHost, skippedAllowedHostByRule: ledger.skippedByRule, stops: ledger.stops,
    chromeProcessGroupsKilled: ledger.chromePids }, null, 2)}\n`);
}

/** Second run: keep the retained results and first-run receipt numbers as they are, add this run and a combined total. */
async function assembleResume(kept, fresh, ledger, sample) {
  const receiptPath = join(HERE, 'receipt.json'); const tripsPath = join(HERE, 'round-trips.json');
  const first = JSON.parse(await readFile(receiptPath, 'utf8')); const prior = JSON.parse(await readFile(tripsPath, 'utf8'));
  const all = [...kept, ...fresh]; const completedAt = new Date().toISOString();
  const passed = all.filter((r) => r.pass).length; const failed = all.filter((r) => !r.pass).length;
  await writeFile(tripsPath, `${JSON.stringify({ observed: prior.observed, results: all,
    summary: { required: sample.length, passed, failed, notRun: sample.length - all.length } }, null, 2)}\n`);
  first.pageLoads = 22; // corrected: two cold probes, one cached probe and 19 loads of the first full run
  const second = { startedAt: ledger.startedAt, completedAt, elapsedMs: ledger.elapsedMs, pageLoads: ledger.loads,
    bmwRequests: { total: ledger.bmwRequests, cap: CAP, byHost: ledger.byHost }, blockedByHost: ledger.blockedByHost,
    skippedAllowedHostByRule: ledger.skippedByRule, stops: ledger.stops, chromeProcessGroupsKilled: ledger.chromePids };
  const byHost = {}; merge(byHost, first.bmwRequests.byHost); merge(byHost, ledger.byHost);
  const blocked = {}; merge(blocked, first.blockedByHost); merge(blocked, ledger.blockedByHost);
  await writeFile(receiptPath, `${JSON.stringify({ ...first, secondRun: second, combined: { pageLoads: first.pageLoads + ledger.loads,
    bmwRequests: { total: first.bmwRequests.total + ledger.bmwRequests, byHost }, blockedByHost: blocked,
    elapsedMs: first.elapsedMs + ledger.elapsedMs } }, null, 2)}\n`);
}

async function main() {
  const startedAt = new Date().toISOString(); const t0 = Date.now();
  await mkdir(scratch, { recursive: true });
  const ledgerPath = join(scratch, 'ledger.json');
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8').catch(() => JSON.stringify({ startedAt, elapsedMs: 0, loads: 0, bmwRequests: 0,
    byHost: {}, blockedByHost: {}, skippedByRule: {}, stops: [], chromePids: [] })));
  const sample = JSON.parse(await readFile(REPORT, 'utf8')).deepLinks.sample;
  const rows = new Map();
  for (const line of (await readFile(RECORDS, 'utf8')).split('\n')) if (line) { const row = JSON.parse(line); rows.set(row.configurationId, row); }
  const plan = JSON.parse(await readFile(join(REPO, 'server/data/gcsp/vehicle-evidence/demo-plan.json'), 'utf8'));
  const ranges = new Map(plan.modelLines.filter((l) => l.mapping.status === 'mapped').flatMap((l) => lineModels(l).map((m) => [m.vgModelCode, m.modelRange])));
  if (process.argv.includes('--assemble')) { // rebuild the outputs from scratch results, no browser or requests
    const read = async (name) => JSON.parse(await readFile(join(scratch, name), 'utf8')).results;
    const kept = [...await read('probe-results.json'), ...(await read('run-results.json')).filter((r) => r.documentStatus !== null)];
    await assemble(kept, ledger, sample); return;
  }
  const probeResults = RESUME ? JSON.parse(await readFile(join(HERE, 'round-trips.json'), 'utf8')).results : probe ? [] : JSON.parse(await readFile(join(scratch, 'probe-results.json'), 'utf8').catch(() => '{"results":[]}')).results;
  const targets = probe ? sample.slice(0, 1) : sample.filter((item) => !probeResults.some((r) => r.configurationId === item.configurationId));
  const results = []; const stops = []; const blockedByHost = {}; const byHost = {}; const skippedByRule = {};
  const pathHist = {}; let confirmed = 0; const unresolved = new Set(); let stopped = false; let chrome; let cdp; let loads = 0;
  try {
    const port = await freePort();
    chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${join(scratch, 'profile')}`, '--no-first-run',
      '--no-default-browser-check', '--lang=en-GB', '--disable-gpu', '--disable-background-networking', '--disable-sync', 'about:blank'],
    { detached: true, stdio: 'ignore', env: { ...process.env, TMPDIR: scratch } });
    chrome.unref();
    let target;
    for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* starting */ } }
    if (!target) throw new Error('Chrome exposed no page target');
    cdp = await Cdp.open(target.webSocketDebuggerUrl);
    const requests = new Map(); const checks = []; let current;
    const stop = (url, why) => { stopped = true; stops.push({ url: url ?? null, why }); };
    cdp.listeners.push(async (msg) => {
      const { method, params } = msg;
      try {
        if (method === 'Fetch.requestPaused') {
          const host = hostOf(params.request.url); const path = new URL(params.request.url).pathname;
          const fail = () => cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' });
          const rule = SKIPPED_PATHS.find(([, re]) => re.test(path));
          if (BLOCKED_TYPES.has(params.resourceType) || !(host === 'configure.bmw.co.uk' || host.endsWith('.bmw.cloud'))) { bump(blockedByHost, host); await fail(); return; }
          if (!allowedHost(host)) { bump(skippedByRule, `host:${host}`); await fail(); return; }
          if (rule) { bump(skippedByRule, `path:${rule[0]}`); await fail(); return; }
          if (stopped || confirmed + unresolved.size + ledger.bmwRequests >= CAP) { if (!stopped) stop(current?.url, 'request cap reached'); await fail(); return; }
          unresolved.add(params.networkId || params.requestId);
          await cdp.send('Fetch.continueRequest', { requestId: params.requestId });
        } else if (method === 'Network.requestWillBeSent') {
          const u = params.request.url; const host = hostOf(u);
          requests.set(params.requestId, { host, path: u.split('?')[0].split('#')[0], method: params.request.method });
          if (allowedHost(host)) bump(pathHist, `${host}${new URL(u).pathname.replace(/[0-9a-f]{8,}|\d+/gi, '#').split('/').slice(0, 4).join('/')}`);
        } else if (method === 'Network.responseReceived') {
          const req = requests.get(params.requestId); const host = hostOf(params.response.url);
          if (!allowedHost(host)) return;
          unresolved.delete(params.requestId);
          const cached = params.response.fromDiskCache || params.response.fromPrefetchCache || params.response.fromServiceWorker;
          if (!cached) { confirmed++; bump(byHost, host); }
          if (STOP_STATUS.has(params.response.status)) stop(current?.url, `HTTP ${params.response.status} from ${host}`);
          if (req) req.status = params.response.status;
        } else if (method === 'Network.loadingFailed') {
          const req = requests.get(params.requestId);
          if (unresolved.delete(params.requestId) && req && !params.blockedReason && params.errorText !== 'net::ERR_BLOCKED_BY_CLIENT') { confirmed++; bump(byHost, req.host); }
        } else if (method === 'Network.loadingFinished') {
          const req = requests.get(params.requestId);
          if (req && /\/rulesolver\/constructibility-check\/rule-sets\/.*\/models\//.test(req.path)) {
            const body = await cdp.send('Network.getResponseBody', { requestId: params.requestId });
            let parsed; try { parsed = JSON.parse(body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body); } catch { parsed = null; }
            const elements = parsed?.configuration?.elements;
            // Keep only the resolved option codes and the verdict; nothing else from the body is retained.
            checks.push({ status: req.status, constructible: parsed?.constructible,
              options: elements ? Object.values(elements).filter((e) => e?.type === 'option').map((e) => e.code) : null });
          }
        }
      } catch (error) { if (!/No resource|Invalid InterceptionId|Target closed/.test(error.message)) stops.push({ url: null, why: `handler: ${error.message}` }); }
    });
    await cdp.send('Network.enable'); await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    for (const item of targets) {
      if (stopped) break;
      const row = rows.get(item.configurationId);
      const recordOptions = sorted(row.canonicalIdentity.factoryOptionCodes);
      if (configurationDeepLink(row, { modelRange: ranges.get(row.canonicalIdentity.vgModelCode) }) !== item.url) {
        results.push({ lineId: item.lineId, configurationId: item.configurationId, url: item.url, pass: false, error: 'sample url differs from the record deep link' }); continue;
      }
      current = item; checks.length = 0; loads++;
      const observedAt = new Date().toISOString();
      await cdp.send('Page.navigate', { url: item.url });
      const begin = Date.now();
      while (!stopped && Date.now() - begin < 60000 && !checks.length) await sleep(400);
      for (let quiet = checks.length; !stopped && Date.now() - begin < 75000;) { await sleep(2500); if (checks.length === quiet) break; quiet = checks.length; }
      const page = await cdp.send('Runtime.evaluate', { expression: '({ path: location.pathname, title: document.title, text: (document.body ? document.body.innerText : "").slice(0, 4000) })', returnByValue: true })
        .then((r) => r.result.value).catch(() => ({ path: '', title: '', text: '' }));
      if (CHALLENGE.test(`${page.title}\n${page.text}`)) stop(item.url, 'bot challenge or access denied page');
      const first = checks[0]; // the model-level check made on load; later calls are per-option what-ifs
      if (stopped && !first) break; // stopped before any answer: leave this link not run
      const resolved = sorted(first?.options ?? []);
      const urlOptions = sorted((page.path.split('/')[5] || '').split(',').filter((c) => c && !c.startsWith('-')));
      const missing = diff(recordOptions, resolved); const extra = diff(resolved, recordOptions);
      results.push({ lineId: item.lineId, configurationId: item.configurationId, url: item.url, documentStatus: first?.status ?? null,
        constructible: first ? first.constructible === true : null, resolvedCount: resolved.length, missing, extra,
        urlRewritten: page.path !== new URL(item.url).pathname, urlOptionsMatch: diff(recordOptions, urlOptions).length === 0 && diff(urlOptions, recordOptions).length === 0,
        pass: !!first && first.constructible === true && missing.length === 0 && extra.length === 0, observedAt });
    }
  } finally {
    cdp?.ws?.close();
    if (chrome?.pid) { try { process.kill(-chrome.pid, 'SIGTERM'); } catch { /* gone */ } await sleep(1000); try { process.kill(-chrome.pid, 'SIGKILL'); } catch { /* gone */ } }
    ledger.bmwRequests += confirmed; ledger.loads += loads; ledger.elapsedMs += Date.now() - t0; ledger.stops.push(...stops);
    merge(ledger.byHost, byHost); merge(ledger.blockedByHost, blockedByHost); merge(ledger.skippedByRule, skippedByRule);
    if (chrome?.pid) ledger.chromePids.push(chrome.pid);
    await writeFile(ledgerPath, JSON.stringify(ledger));
    await writeFile(join(scratch, probe ? 'probe-results.json' : 'run-results.json'), JSON.stringify({ results, stops, pathHist }, null, 1));
    if (RESUME) await assembleResume(probeResults, results, ledger, sample);
    else if (!probe) await assemble([...probeResults, ...results], ledger, sample);
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
