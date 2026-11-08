const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const DISCOVERY = freeze({
  version: 'historical-f44-discovery-plan.v1', run: 'dev-poller-restart-20261105-fucq58', executable: true, readOnly: true,
  targets: [{ schemeModelLine: 'F44 Gran Coupe', range: 'F44' }],
  context: { country: 'gb', locale: 'en_GB', requestOrderDate: '2024-10-01', requestEffectDate: '2024-10-01', futureModels: false, closestFallback: false },
  limits: { httpAttempts: 3, pageGets: 1, settingsGets: 1, treeGets: 1, solverGets: 0, otdGets: 0, manifestGets: 0, imageGets: 0, concurrency: 1, retries: 0, backoffMs: 0, requestTimeoutMs: 10000, wallMs: 45000, bootstrapResponseDecodedBytes: 1048576, responseDecodedBytes: 2097152, aggregateDecodedBytes: 4194304, outputBytes: 262144, modelsPerResponse: 256, ramBytes: 268435456, scratchBytes: 33554432, cacheEntries: 0 }
});
const { limits } = DISCOVERY;
const pageUrl = 'https://configure.bmw.co.uk/en_GB/configure/G61E/T5MJ';
const settingsPattern = /^\/en_GB\/settings\.[a-zA-Z0-9]+\.json$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => { const error = new Error(code); error.safeCode = code; throw error; };
const canonical = value => JSON.stringify(value, (_, entry) => object(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const code = value => typeof value === 'string' && /^[A-Z0-9]{4,12}$/.test(value);
const rangeCode = value => typeof value === 'string' && /^[A-Z][A-Z0-9]{1,15}$/.test(value);

export function projectCatalogue(tree, requestedRange) {
  if (!object(tree) || !rangeCode(requestedRange) || Object.keys(tree).length > 64) fail('catalogue-root-shape');
  const ranges = new Set(), selected = new Map();
  let count = 0;
  // Only full direct records at this observed relationship supply catalogue context.
  for (const [group, series] of Object.entries(tree)) {
    if (!object(series) || !Object.hasOwn(series, 'modelRanges')) continue;
    if (!/^[A-Za-z0-9_+-]{1,32}$/.test(group) || !object(series.modelRanges) || Object.keys(series.modelRanges).length > 64) fail('catalogue-range-shape');
    for (const [range, entry] of Object.entries(series.modelRanges)) {
      if (!rangeCode(range) || !object(entry)) fail('catalogue-range-shape');
      if (range !== requestedRange) fail('substitute-range-refused');
      ranges.add(range);
      if (ranges.size > 64 || (entry.models !== undefined && !object(entry.models))) fail('catalogue-range-shape');
      for (const [model, facts] of Object.entries(entry.models || {})) {
        if (++count > limits.modelsPerResponse) fail('model-count-limit');
        if (!code(model) || !object(facts) || facts.modelCode !== model || !code(facts.agModelCode) || !rangeCode(facts.modelRange) || !['RL', 'LL'].includes(facts.steering) || !date(facts.orderDate) || facts.orderDate !== DISCOVERY.context.requestOrderDate || !date(facts.effectDate)) fail('model-context-incomplete-or-conflicting');
        const safe = { modelCode: model, agModelCode: facts.agModelCode, catalogueRangeKey: range, modelRangeField: facts.modelRange, steeringLiteral: facts.steering, orderDate: facts.orderDate, modelEffectDate: facts.effectDate, effectDateMatchesRequest: facts.effectDate === DISCOVERY.context.requestEffectDate };
        const key = range + '/' + model;
        const previous = selected.get(key);
        if (previous && canonical(previous.facts) !== canonical(safe)) fail('duplicate-context-conflict');
        const path = [group, 'modelRanges', range, 'models', model];
        if (previous) previous.paths.push(path); else selected.set(key, { facts: safe, paths: [path] });
      }
    }
  }
  const models = [...selected.values()].map(({ facts, paths }) => ({ ...facts, paths, constructibility: 'unknown', profileQualification: 'unqualified', derivative: null, body: null, powertrain: null, modelYear: null, productionEra: null, plant: null }));
  const requestedRangeFound = models.some(model => model.catalogueRangeKey === requestedRange);
  const result = { requestedRange, requestedRangeFound, returnedRangeKeys: [...ranges].sort(), coverageStatus: requestedRangeFound ? 'catalogue-candidates-observed' : 'requested-range-unmatched', models, globalAvailability: 'unknown', newConfigurations: 0, profileActivations: 0 };
  if (Buffer.byteLength(JSON.stringify(result)) > limits.outputBytes) fail('projection-output-limit');
  return result;
}

function treeUrl(range) {
  return 'https://prod.ucp.bmw.cloud/model-matrices/vehicle-trees/connext-bmw/sources/pcaso/brands/bmwCar/countries/gb/effect-dates/2024-10-01/order-dates/2024-10-01?gfs-policy=none&cluster=default&model-ranges=' + range + '&future-models=false&closest-fallback=false';
}
function publicHeader(settings) {
  let visited = 0;
  const profiles = [], values = [];
  const visit = (value, fn, name = '', depth = 0) => {
    if (!value || typeof value !== 'object') return;
    if (++visited > 30000 || depth > 24) fail('settings-traversal-limit');
    fn(value, name);
    for (const [key, entry] of Object.entries(value)) if (entry && typeof entry === 'object') visit(entry, fn, key, depth + 1);
  };
  visit(settings, (value, name) => { if (name === 'settingsVehicleTree') profiles.push(value); });
  for (const profile of profiles) visit(profile, value => {
    for (const [key, entry] of Object.entries(value)) if (key.toLowerCase() === 'x-api-key' && typeof entry === 'string') values.push(entry);
    if (typeof value.name === 'string' && value.name.toLowerCase() === 'x-api-key' && typeof value.value === 'string') values.push(value.value);
  });
  const unique = [...new Set(values)];
  if (unique.length !== 1 || !unique[0] || unique[0].length > 4096) fail('settings-header-shape');
  return { 'x-api-key': unique[0] };
}
const parse = bytes => { try { return JSON.parse(bytes.toString('utf8')); } catch { fail('unexpected-json'); } };

export async function runDiscovery(plan, { fetchImpl = fetch, now = Date.now } = {}) {
  const result = { version: 'historical-f44-observation.v1', run: DISCOVERY.run, observedAt: new Date().toISOString(), source: 'public-bmw-uk-configurator', providerStatus: 'unsupported-public-website', requestedContext: DISCOVERY.context, readOnly: true, writes: 0, attempts: 0, decodedBytes: 0, requests: [], observations: [], status: 'incomplete', stop: null, newConfigurations: 0, profileActivations: 0 };
  const start = now(), all = new AbortController();
  let wallTimer;
  const checkWall = () => { if (all.signal.aborted || now() - start >= limits.wallMs) fail('wall-limit'); };
  async function get(category, url, headers = {}) {
    checkWall();
    const categories = ['page', 'settings', 'tree:F44'];
    if (result.attempts >= limits.httpAttempts || categories[result.attempts] !== category) fail('request-budget');
    const parsed = new URL(url);
    const allowed = category === 'page' ? url === pageUrl : category.startsWith('tree:') ? url === treeUrl(category.slice(5)) : parsed.origin === 'https://configure.bmw.co.uk' && settingsPattern.test(parsed.pathname) && !parsed.search;
    if (!allowed || parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) fail('endpoint-refused');
    const request = { category, attempt: ++result.attempts, status: null, decodedBytes: 0, elapsedMs: 0 };
    result.requests.push(request);
    const since = now(), one = new AbortController();
    const responseCap = category.startsWith('tree:') ? limits.responseDecodedBytes : limits.bootstrapResponseDecodedBytes;
    const timer = setTimeout(() => one.abort(), limits.requestTimeoutMs);
    let reader;
    try {
      const response = await fetchImpl(url, { method: 'GET', headers, credentials: 'omit', cache: 'no-store', redirect: 'manual', signal: AbortSignal.any([all.signal, one.signal]) });
      request.status = response.status;
      if (response.status >= 300 && response.status < 400) fail('redirect-refused');
      if (response.status !== 200) fail([401, 403, 429].includes(response.status) ? 'authentication-or-rate-limit' : 'source-http-failure');
      const contentType = (response.headers.get('content-type') || '').split(';')[0];
      if (contentType !== (category === 'page' ? 'text/html' : 'application/json')) fail('unexpected-content-type');
      request.contentType = contentType;
      if (Number(response.headers.get('content-length')) > responseCap) fail('declared-response-too-large');
      const chunks = []; reader = response.body.getReader();
      while (true) {
        const part = await reader.read();
        if (one.signal.aborted) fail('request-timeout');
        checkWall(); if (part.done) break;
        request.decodedBytes += part.value.byteLength; result.decodedBytes += part.value.byteLength;
        if (request.decodedBytes > responseCap || result.decodedBytes > limits.aggregateDecodedBytes) fail('decoded-byte-limit');
        chunks.push(part.value);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      request.failure = error.safeCode || (one.signal.aborted ? 'request-timeout' : all.signal.aborted ? 'wall-limit' : 'transport-failure');
      fail(request.failure);
    } finally {
      if (reader) await reader.cancel().catch(() => {});
      clearTimeout(timer); request.elapsedMs = now() - since;
    }
  }
  try {
    for (const [key, value] of Object.entries(DISCOVERY)) if (!plan || canonical(plan[key]) !== canonical(value)) fail('execution-plan-refused');
    wallTimer = setTimeout(() => all.abort(), limits.wallMs);
    const html = (await get('page', pageUrl)).toString('utf8');
    const paths = [...new Set([...html.matchAll(/(?:\/en_GB\/)?settings\.[a-zA-Z0-9]+\.json/g)].map(match => match[0].startsWith('/en_GB/') ? match[0] : '/en_GB/' + match[0]))];
    if (paths.length !== 1 || !settingsPattern.test(paths[0])) fail('settings-discovery-shape');
    const settings = parse(await get('settings', 'https://configure.bmw.co.uk' + paths[0]));
    const header = publicHeader(settings);
    for (const target of DISCOVERY.targets) {
      const tree = parse(await get('tree:' + target.range, treeUrl(target.range), header));
      result.observations.push({ schemeModelLine: target.schemeModelLine, ...projectCatalogue(tree, target.range) });
      checkWall();
    }
    result.status = 'completed-discovery';
  } catch (error) {
    result.status = 'stopped'; result.stop = error.safeCode || 'unexpected-local-shape-or-failure';
  } finally {
    clearTimeout(wallTimer); all.abort(); result.elapsedMs = now() - start;
  }
  return result;
}
