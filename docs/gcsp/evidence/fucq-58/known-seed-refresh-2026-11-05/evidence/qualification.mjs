import { projectModelContext } from '../../steering-diagnostic-2026-11-05/evidence/model-context-projection.mjs';
import { selectFullModelRecord } from '../../full-model-selector-2026-11-05/evidence/full-model-selector.mjs';
import { configurationKey } from '../../../../../../scripts/gcsp/fleet-plan.mjs';

const limits = { aggregateDecodedBytes: 2097152, backoffMs: 0, concurrency: 1, httpAttempts: 4, imageGets: 0, manifestGets: 0, otdGets: 0, ramBytes: 268435456, requestTimeoutMs: 10000, responseDecodedBytes: 1048576, retries: 0, scratchBytes: 33554432, solverGets: 1, wallMs: 45000, pageGets: 1, settingsGets: 1, treeGets: 1, projectionBytes: 262144, projectionFacts: 1024, projectionVisitedNodes: 30000, projectionDepth: 24, projectionPairs: 256 };
const pageUrl = 'https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ';
const treeUrl = 'https://prod.ucp.bmw.cloud/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2026-11-01/order-dates/2026-11-01?gfs-policy=none&cluster=default&model-ranges=G61E&future-models=true&closest-fallback=true';
const solverUrl = 'https://prod.ucp.bmw.cloud/rulesolver/constructibility-check/rule-sets/pcaso,con/brands/bmwCar/countries/gb/effect-dates/2027-01-05/order-dates/2026-11-01/models/T5MJ';
const expected = { modelCode: 'T5MJ', agModelCode: '72HH', catalogueRangeKey: 'G61E', modelRangeField: 'G61', orderDate: '2026-11-01', effectDate: '2027-01-05', steeringLiteral: 'RL', groups: ['5', 'I'] };
const seed = ['FKSFU', 'P0300', 'S0337', 'S043L'];
const query = { 'add-rules-for-mandatory-element-classes': 'fabric,paint,rim', application: 'connext', 'included-elements': seed.join(','), 'mandatory-elements': 'S0337' };
const settingsPattern = /^\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameObject = (a, b) => a && typeof a === 'object' && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([key, value]) => equal(a[key], value));
const fail = code => { const error = new Error(code); error.safeCode = code; throw error; };
const parse = bytes => { try { return JSON.parse(bytes.toString('utf8')); } catch { fail('unexpected-json'); } };

function checkPlan(plan) {
  if (!plan || plan.version !== 'fleet-known-seed-refresh-plan.v1' || plan.run !== 'fucq58-20261105-known-seed-refresh' || plan.executable !== true || plan.readOnly !== true || !sameObject(plan.limits, limits) || !sameObject(plan.expected, expected) || !sameObject(plan.solverQuery, query) || !equal(plan.seed, seed) || plan.pageUrl !== pageUrl || plan.treeUrl !== treeUrl || plan.solverUrl !== solverUrl || plan.settingsPattern !== '^/en_GB/settings\\.[a-zA-Z0-9]+\\.json$') fail('execution-plan-refused');
  const known = plan.knownBuild;
  if (!known || known.selectionComplete !== true || !Array.isArray(known.completeSelectedElements) || !Array.isArray(known.selectedAccessories) || !known.completeSelectedElements.length || !seed.every(code => known.completeSelectedElements.includes(code)) || configurationKey('T5MJ', known.completeSelectedElements, known.selectedAccessories) !== known.configurationId) fail('known-build-plan-refused');
}

function headerFor(settings, profileName) {
  let visited = 0;
  const profiles = [];
  const visit = (value, fn, name = '', depth = 0) => {
    if (!value || typeof value !== 'object') return;
    if (++visited > 30000 || depth > 24) fail('settings-traversal-limit');
    fn(value, name);
    for (const [key, entry] of Object.entries(value)) if (entry && typeof entry === 'object') visit(entry, fn, key, depth + 1);
  };
  visit(settings, (value, name) => { if (profileName.test(name)) profiles.push(value); });
  const values = [];
  for (const profile of profiles) visit(profile, value => {
    for (const [key, entry] of Object.entries(value)) if (key.toLowerCase() === 'x-api-key' && typeof entry === 'string') values.push(entry);
    if (typeof value.name === 'string' && value.name.toLowerCase() === 'x-api-key' && typeof value.value === 'string') values.push(value.value);
  });
  const unique = [...new Set(values)];
  if (unique.length !== 1 || !unique[0] || unique[0].length > 4096) fail('settings-header-shape');
  return { 'x-api-key': unique[0] };
}

function projectKnownBuild(result, known) {
  const configuration = result?.configuration;
  const elements = configuration?.elements;
  if (result?.constructible !== true || configuration?.modelCode !== 'T5MJ' || !elements || typeof elements !== 'object' || Array.isArray(elements)) fail('solver-unconstructible-or-substituted');
  const codes = Object.keys(elements).sort();
  if (!codes.length || codes.length > 1024 || codes.some(code => !/^[A-Z0-9]{4,12}$/.test(code)) || !seed.every(code => codes.includes(code))) fail('solver-incomplete-or-lost-selection');
  const accessories = [];
  for (const code of codes) {
    const entry = elements[code];
    if (!entry || entry.code !== code || !['option', 'accessory'].includes(entry.type)) fail('solver-element-classification');
    if (entry.type === 'accessory') accessories.push(code);
    if (code.startsWith('SE') && entry.type !== 'accessory') fail('solver-accessory-classification');
  }
  const id = configurationKey('T5MJ', codes, accessories);
  if (id !== known.configurationId || !equal(codes, [...known.completeSelectedElements].sort()) || !equal(accessories, [...known.selectedAccessories].sort())) fail('solver-known-identity-changed');
  return { constructible: true, resolvedModelCode: 'T5MJ', seedOptions: seed.slice(), requestedOptionsPreserved: true, selectionComplete: true, completeSelectedElements: codes, selectedAccessories: accessories, selectedElementCount: codes.length, baseOptionCount: codes.length - accessories.length, configurationId: id, knownConfiguration: true, verifiedFitted: 'unknown' };
}

export async function runQualification(plan, { fetchImpl = fetch, now = Date.now } = {}) {
  const summary = { version: 'fleet-known-seed-refresh-observation.v1', run: 'fucq58-20261105-known-seed-refresh', observedAt: new Date().toISOString(), source: 'public-bmw-uk-configurator', providerStatus: 'unsupported-public-website', readOnly: true, writes: 0, attempts: 0, decodedBytes: 0, requests: [], status: 'incomplete', stop: null, modelSelection: null, build: null, additionalConfigurations: 0, profileActivations: 0, profileQualification: 'unqualified' };
  const start = now();
  const all = new AbortController();
  let wallTimer;
  const checkWall = () => { if (all.signal.aborted || now() - start >= limits.wallMs) fail('wall-limit'); };
  async function get(category, url, headers = {}) {
    checkWall();
    const categories = ['page', 'settings', 'tree', 'solver'];
    if (summary.attempts >= 4 || categories[summary.attempts] !== category) fail('request-budget');
    const parsed = new URL(url);
    const allowed = category === 'page' ? url === pageUrl : category === 'tree' ? url === treeUrl : category === 'solver' ? parsed.origin + parsed.pathname === solverUrl && sameObject(Object.fromEntries(parsed.searchParams), query) : parsed.origin === 'https://configure.bmw.co.uk' && settingsPattern.test(parsed.pathname) && !parsed.search;
    if (!allowed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) fail('endpoint-refused');
    const record = { category, attempt: ++summary.attempts, status: null, decodedBytes: 0, elapsedMs: 0 };
    summary.requests.push(record);
    const since = now();
    const one = new AbortController();
    const requestTimer = setTimeout(() => one.abort(), limits.requestTimeoutMs);
    let reader;
    try {
      const response = await fetchImpl(url, { method: 'GET', headers, credentials: 'omit', cache: 'no-store', redirect: 'manual', signal: AbortSignal.any([all.signal, one.signal]) });
      record.status = response.status;
      if (response.status >= 300 && response.status < 400) fail('redirect-refused');
      if (response.status !== 200) fail([401, 403, 429].includes(response.status) ? 'authentication-or-rate-limit' : 'source-http-failure');
      const contentType = (response.headers.get('content-type') || '').split(';')[0];
      if (contentType !== (category === 'page' ? 'text/html' : 'application/json')) fail('unexpected-content-type');
      record.contentType = contentType;
      if (Number(response.headers.get('content-length')) > limits.responseDecodedBytes) fail('declared-response-too-large');
      const chunks = [];
      reader = response.body.getReader();
      while (true) {
        const part = await reader.read();
        if (one.signal.aborted) fail('request-timeout');
        checkWall();
        if (part.done) break;
        record.decodedBytes += part.value.byteLength;
        summary.decodedBytes += part.value.byteLength;
        if (record.decodedBytes > limits.responseDecodedBytes || summary.decodedBytes > limits.aggregateDecodedBytes) fail('decoded-byte-limit');
        chunks.push(part.value);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      record.failure = error.safeCode || (one.signal.aborted ? 'request-timeout' : all.signal.aborted ? 'wall-limit' : 'transport-failure');
      fail(record.failure);
    } finally {
      if (reader) await reader.cancel().catch(() => {});
      clearTimeout(requestTimer);
      record.elapsedMs = now() - since;
    }
  }
  try {
    checkPlan(plan);
    wallTimer = setTimeout(() => all.abort(), limits.wallMs);
    const html = (await get('page', pageUrl)).toString('utf8');
    const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)].map(match => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
    if (paths.length !== 1 || !settingsPattern.test(paths[0])) fail('settings-discovery-shape');
    const settings = parse(await get('settings', 'https://configure.bmw.co.uk' + paths[0]));
    const tree = parse(await get('tree', treeUrl, headerFor(settings, /^settingsVehicleTree$/)));
    const projection = projectModelContext(tree, { modelCode: 'T5MJ', agModelCode: '72HH' }, { maxFacts: limits.projectionFacts, maxNodes: limits.projectionVisitedNodes, maxDepth: limits.projectionDepth, maxPairs: limits.projectionPairs });
    if (Buffer.byteLength(JSON.stringify(projection)) > limits.projectionBytes) fail('projection-output-limit');
    summary.modelSelection = selectFullModelRecord(projection, expected);
    checkWall();
    const request = new URL(solverUrl);
    for (const [key, value] of Object.entries(query)) request.searchParams.set(key, value);
    const result = parse(await get('solver', request.href, headerFor(settings, /^settings(RuleSolver|Rules|Constructibility)$/)));
    summary.build = projectKnownBuild(result, plan.knownBuild);
    checkWall();
    summary.status = 'completed-known-seed-refresh';
  } catch (error) {
    summary.status = 'stopped';
    summary.stop = error.safeCode || (/^(selector|projection)-[a-z-]+$/.test(error.message || '') ? error.message : 'unexpected-local-shape-or-failure');
  } finally {
    clearTimeout(wallTimer);
    all.abort();
    summary.elapsedMs = now() - start;
  }
  return summary;
}
