import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { projectModelContext } from './model-context-projection.mjs';

if (process.argv[2] !== '--execute-diagnostic') throw Error('explicit-diagnostic-execution-required');
const planFile = new URL('../plan.json', import.meta.url);
const planBytes = await readFile(planFile);
const plan = JSON.parse(planBytes);
const expectedLimits = { httpAttempts: 3, pageGets: 1, settingsGets: 1, treeGets: 1, solverGets: 0, otdGets: 0, manifestGets: 0, imageGets: 0, retries: 0, backoffMs: 0, concurrency: 1, requestTimeoutMs: 10000, wallMs: 45000, responseDecodedBytes: 1048576, aggregateDecodedBytes: 2097152, projectionBytes: 262144, projectionFacts: 1024, projectionVisitedNodes: 30000, projectionDepth: 24, projectionPairs: 256 };
if (plan.version !== 'fleet-steering-diagnostic-plan.v1' || !plan.readOnly || Object.keys(plan.limits).length !== Object.keys(expectedLimits).length || Object.entries(expectedLimits).some(([key, value]) => plan.limits[key] !== value)) throw Error('diagnostic-plan-refused');
if (plan.pageUrl !== 'https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ') throw Error('diagnostic-page-refused');
const treeUrl = new URL(plan.treeUrl);
if (treeUrl.origin !== 'https://prod.ucp.bmw.cloud' || treeUrl.pathname !== '/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2026-11-01/order-dates/2026-11-01' || treeUrl.search !== '?gfs-policy=none&cluster=default&model-ranges=G61E&future-models=true&closest-fallback=true') throw Error('diagnostic-tree-refused');
if (plan.context.modelCode !== 'T5MJ' || plan.context.agModelCode !== '72HH' || plan.settingsPattern !== '^/en_GB/settings\\.[a-zA-Z0-9]+\\.json$') throw Error('diagnostic-context-refused');
const digest = value => createHash('sha256').update(value).digest('hex');
const summary = {
  version: 'fleet-steering-diagnostic-observations.v1', run: plan.run, observedDate: new Date().toISOString(),
  source: 'public-bmw-uk-configurator', providerStatus: 'unsupported-public-website', authority: plan.authority,
  planSha256: digest(planBytes), clientSha256: digest(await readFile(new URL('./diagnostic-client.mjs', import.meta.url))),
  extractorSha256: digest(await readFile(new URL('./model-context-projection.mjs', import.meta.url))),
  testsSha256: digest(await readFile(new URL('./model-context-projection.test.mjs', import.meta.url))),
  requestedContext: plan.context, readOnly: true, writes: 0, attempts: 0, decodedBytes: 0, requests: [],
  solverGets: 0, otdGets: 0, manifestGets: 0, imageGets: 0, retries: 0, additionalConfigurations: 0, profileActivations: 0,
  status: 'incomplete', stop: null, projectionFile: null,
  interpretation: 'Literal source facts and explicit tree paths only. No constructibility/profile compatibility or steering semantics inferred from an unrelated literal.',
};
const start = Date.now();
const all = new AbortController();
const wallTimer = setTimeout(() => all.abort(), plan.limits.wallMs);
const fail = code => { const error = new Error(code); error.safeCode = code; throw error; };
const parse = bytes => { try { return JSON.parse(bytes.toString('utf8')); } catch { fail('unexpected-json'); } };
async function get(category, url, headers = {}) {
  if (all.signal.aborted || Date.now() - start >= plan.limits.wallMs) fail('wall-limit');
  if (summary.attempts >= 3 || summary.requests.some(item => item.category === category)) fail('request-budget');
  const parsed = new URL(url);
  const allowed = category === 'page' ? url === plan.pageUrl : category === 'tree' ? url === plan.treeUrl : category === 'settings' && parsed.origin === 'https://configure.bmw.co.uk' && new RegExp(plan.settingsPattern).test(parsed.pathname) && !parsed.search && !parsed.hash;
  if (!allowed || parsed.protocol !== 'https:' || parsed.username || parsed.password) fail('endpoint-refused');
  const record = { category, attempt: ++summary.attempts, status: null, decodedBytes: 0, elapsedMs: 0 };
  summary.requests.push(record);
  const since = Date.now();
  const one = new AbortController();
  const requestTimer = setTimeout(() => one.abort(), plan.limits.requestTimeoutMs);
  let reader;
  try {
    const response = await fetch(url, { method: 'GET', headers, credentials: 'omit', cache: 'no-store', redirect: 'manual', signal: AbortSignal.any([all.signal, one.signal]) });
    record.status = response.status;
    if (response.status >= 300 && response.status < 400) fail('redirect-refused');
    if (response.status !== 200) fail([401, 403, 429].includes(response.status) ? 'authentication-or-rate-limit' : 'source-http-failure');
    record.contentType = (response.headers.get('content-type') || '').split(';')[0];
    if (category === 'page' ? record.contentType !== 'text/html' : record.contentType !== 'application/json') fail('unexpected-content-type');
    const declared = Number(response.headers.get('content-length'));
    if (declared > plan.limits.responseDecodedBytes) { record.declaredBytes = declared; fail('declared-response-too-large'); }
    const chunks = [];
    reader = response.body.getReader();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      record.decodedBytes += part.value.byteLength;
      summary.decodedBytes += part.value.byteLength;
      if (record.decodedBytes > plan.limits.responseDecodedBytes || summary.decodedBytes > plan.limits.aggregateDecodedBytes) fail('decoded-byte-limit');
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    record.failure = error.safeCode || (one.signal.aborted ? 'request-timeout' : all.signal.aborted ? 'wall-limit' : 'transport-failure');
    fail(record.failure);
  } finally {
    if (reader) await reader.cancel().catch(() => {});
    clearTimeout(requestTimer);
    record.elapsedMs = Date.now() - since;
  }
}
function catalogueHeader(settings) {
  const profiles = [];
  const visit = (value, callback, key = '') => {
    if (!value || typeof value !== 'object') return;
    callback(value, key);
    for (const [name, entry] of Object.entries(value)) if (entry && typeof entry === 'object') visit(entry, callback, name);
  };
  visit(settings, (value, key) => { if (key === 'settingsVehicleTree') profiles.push(value); });
  const values = [];
  for (const profile of profiles) visit(profile, value => {
    for (const [name, entry] of Object.entries(value)) if (name.toLowerCase() === 'x-api-key' && typeof entry === 'string') values.push(entry);
    if (typeof value.name === 'string' && value.name.toLowerCase() === 'x-api-key' && typeof value.value === 'string') values.push(value.value);
  });
  const unique = [...new Set(values)];
  if (unique.length !== 1) fail('catalogue-header-shape');
  return { 'x-api-key': unique[0] };
}
try {
  const html = (await get('page', plan.pageUrl)).toString('utf8');
  const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)].map(match => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
  if (paths.length !== 1 || !new RegExp(plan.settingsPattern).test(paths[0])) fail('settings-discovery-shape');
  const settings = parse(await get('settings', 'https://configure.bmw.co.uk' + paths[0]));
  const tree = parse(await get('tree', plan.treeUrl, catalogueHeader(settings)));
  const projection = projectModelContext(tree, { modelCode: plan.context.modelCode, agModelCode: plan.context.agModelCode }, { maxFacts: plan.limits.projectionFacts, maxNodes: plan.limits.projectionVisitedNodes, maxDepth: plan.limits.projectionDepth, maxPairs: plan.limits.projectionPairs });
  const text = JSON.stringify(projection, null, 2) + '\n';
  if (all.signal.aborted || Date.now() - start >= plan.limits.wallMs) fail('wall-limit');
  if (Buffer.byteLength(text) > plan.limits.projectionBytes) fail('projection-output-limit');
  await writeFile(new URL('./projection.json', import.meta.url), text, { flag: 'wx' });
  summary.projectionFile = 'projection.json';
  summary.projectionSha256 = digest(text);
  summary.projectionBytes = Buffer.byteLength(text);
  summary.matchCounts = { model: projection.matches.model.length, ag: projection.matches.ag.length };
  summary.sameObjectObservations = projection.sameObjectObservations;
  summary.status = projection.matches.model.length && projection.matches.ag.length ? 'completed-bounded-diagnostic' : 'stopped';
  if (summary.status === 'stopped') summary.stop = 'target-literals-unconfirmed';
} catch (error) {
  summary.status = 'stopped';
  summary.stop = error.safeCode || (/^projection-[a-z-]+$/.test(error.message || '') ? error.message : 'unexpected-local-shape-or-failure');
} finally {
  clearTimeout(wallTimer);
  all.abort();
  summary.elapsedMs = Date.now() - start;
  await writeFile(new URL('./diagnostic.json', import.meta.url), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: summary.status, stop: summary.stop, attempts: summary.attempts, decodedBytes: summary.decodedBytes, elapsedMs: summary.elapsedMs, matchCounts: summary.matchCounts, sameObjectObservations: summary.sameObjectObservations, additionalConfigurations: 0, profileActivations: 0 }));
}
