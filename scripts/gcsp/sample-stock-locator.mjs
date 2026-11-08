import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMITS = Object.freeze({ requests: 400, concurrency: 1, retries: 0,
  pageBytes: 1024 * 1024, totalBytes: 96 * 1024 * 1024, pageCars: 1000,
  requestTimeoutMs: 15000, planBytes: 128 * 1024 });
const fail = (code) => { throw Error(code); };
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safeLabel = (value) => typeof value === 'string' && value.length <= 80
  && /^[A-Za-z][A-Za-z '\-/()]*$/.test(value) && value.split(/[ '\-/()]+/).every((part) => part.length <= 24);
const safeSourceLabel = (value) => typeof value === 'string' && value.length >= 1 && value.length <= 80
  && /^\p{L}[\p{L}\p{Nd} '\-/().&]*$/u.test(value) && !/\p{Nd}{4}/u.test(value)
  && value.split(/[ '\-/().&]+/).every((part) => part.length <= 24);
const normaliseLabel = (value) => value.replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/\u00a0/g, ' ')
  .replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
const SESSION_COOKIE = '_new_car_stock_tool_session';
const safeId = (value) => typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value)
  && !/[0-9]{7}/.test(value);
const codes = new Set(['plan-invalid', 'source-invalid', 'source-stopped-401', 'source-stopped-403',
  'source-stopped-429', 'response-too-large', 'redirect-refused', 'request-timeout', 'request-failed',
  'sampling-incomplete', 'output-failed']);
const dateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value ? value : null;

function validateModel(model) {
  if (!plain(model) || !safeId(model.modelLineId) || !safeLabel(model.title)) fail('plan-invalid');
  if (model.labelPolicy !== undefined && !['reviewed', 'safe-pattern'].includes(model.labelPolicy)) fail('plan-invalid');
  for (const key of ['colours', 'upholsteries']) {
    const labels = model[key];
    if (!Array.isArray(labels) || !labels.length && model.labelPolicy !== 'safe-pattern' || labels.length > 100 || !labels.every(safeLabel)
      || new Set(labels).size !== labels.length) fail('plan-invalid');
  }
}

const validReference = (ref) => plain(ref) && typeof ref.reference === 'string' && ref.reference.length <= 256
  && /^docs\/gcsp\/[a-zA-Z0-9_/-]+\.json$/.test(ref.reference)
  && !ref.reference.split('/').includes('..') && /^[a-f0-9]{64}$/.test(ref.sha256);

function validatePlan(plan) {
  if (!plain(plan) || !['fixture', 'accepted-f77', 'authorised-run'].includes(plan.kind)
    || plan.kind === 'fixture' && plan.fixture !== true
    || plan.kind !== 'fixture' && plan.fixture !== false
    || plan.stopAtRequestCap !== undefined && typeof plan.stopAtRequestCap !== 'boolean'
    || plan.minIntervalMs !== undefined && (!Number.isSafeInteger(plan.minIntervalMs)
      || plan.minIntervalMs < 0 || plan.minIntervalMs > 5000)
    || !Number.isSafeInteger(plan.maxRequests) || plan.maxRequests < 1 || plan.maxRequests > LIMITS.requests
    || plan.concurrency !== 1 || plan.retries !== 0 || !Array.isArray(plan.models)
    || !plan.models.length || plan.models.length > LIMITS.requests) fail('plan-invalid');
  let count = 0; const ids = new Set();
  for (const model of plan.models) {
    validateModel(model);
    if (ids.has(model.modelLineId) || !Array.isArray(model.requests) || !model.requests.length) fail('plan-invalid');
    ids.add(model.modelLineId); count += model.requests.length;
    if (count > plan.maxRequests) fail('plan-invalid');
    for (let index = 0; index < model.requests.length; index++) {
      const raw = model.requests[index]; let url;
      if (typeof raw !== 'string' || raw.length > 4096) fail('plan-invalid');
      try { url = new URL(raw); } catch { fail('plan-invalid'); }
      if (url.origin !== 'https://stock.bmw.co.uk' || url.username || url.password || url.hash
        || url.pathname !== (index === 0 ? '/results' : '/results/more')) fail('plan-invalid');
    }
  }
  if (plan.kind === 'accepted-f77' && !validReference(plan.f77)
    || plan.kind === 'authorised-run' && !validReference(plan.authority)) fail('plan-invalid');
}

async function boundedFile(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.planBytes) fail('plan-invalid');
  const bytes = await readFile(path);
  if (bytes.byteLength > LIMITS.planBytes) fail('plan-invalid');
  return bytes;
}

async function verifyAcceptance(plan, projectRoot) {
  try {
    const bytes = await boundedFile(resolve(projectRoot, plan.f77.reference));
    if (createHash('sha256').update(bytes).digest('hex') !== plan.f77.sha256) fail('plan-invalid');
    const accepted = JSON.parse(bytes.toString('utf8'));
    if (!plain(accepted) || accepted.kind !== 'fucq-77-demo-plan' || accepted.issue !== 'FUCQ-77'
      || accepted.status !== 'accepted' || !safeLabel(accepted.acceptedBy)
      || !dateOnly(accepted.acceptedDate) || !Array.isArray(accepted.modelLines)
      || accepted.modelLines.length !== plan.models.length) fail('plan-invalid');
    const expected = plan.models.map(({ modelLineId, title }) => ({ modelLineId, title }))
      .sort((a, b) => a.modelLineId.localeCompare(b.modelLineId));
    const actual = accepted.modelLines.map(({ modelLineId, title }) => ({ modelLineId, title }))
      .sort((a, b) => a.modelLineId.localeCompare(b.modelLineId));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('plan-invalid');
  } catch { fail('plan-invalid'); }
}

async function verifyAuthority(plan, projectRoot) {
  try {
    const bytes = await boundedFile(resolve(projectRoot, plan.authority.reference));
    if (createHash('sha256').update(bytes).digest('hex') !== plan.authority.sha256) fail('plan-invalid');
    const authority = JSON.parse(bytes.toString('utf8'));
    if (!plain(authority) || authority.kind !== 'fucq-live-run-authority' || !/^FUCQ-\d{1,4}$/.test(authority.issue)
      || !safeLabel(authority.approvedBy) || !dateOnly(authority.approvedDate)
      || !Array.isArray(authority.modelLines) || authority.modelLines.length !== plan.models.length) fail('plan-invalid');
    const pick = (lines) => lines.map(({ modelLineId, title }) => ({ modelLineId, title }))
      .sort((a, b) => a.modelLineId.localeCompare(b.modelLineId));
    if (JSON.stringify(pick(authority.modelLines)) !== JSON.stringify(pick(plan.models))) fail('plan-invalid');
  } catch { fail('plan-invalid'); }
}

export function createAggregate(model) {
  validateModel(model);
  return { modelLineId: model.modelLineId, title: model.title, carCount: 0,
    colourShares: [], upholsteryShares: [], unknownCounts: { colour: 0, upholstery: 0 },
    unsafeLabelCounts: { colour: 0, upholstery: 0 },
    leadTimeWeeks: { min: null, max: null, unknownCount: 0 },
    deliveryDateSpread: { min: null, max: null, unknownCount: 0 },
    priceBand: { min: null, max: null, currency: 'GBP', unknownCount: 0 } };
}

function category(value, model, key) {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string') fail('source-invalid');
  const text = normaliseLabel(value);
  if (!text) return {};
  if (model.labelPolicy === 'safe-pattern') return safeSourceLabel(text) ? { label: text } : { unsafe: true };
  const label = model[key].find((item) => item === text);
  if (label === undefined) fail('source-invalid');
  return { label };
}

function price(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1000000 ? value : null;
  if (typeof value !== 'string' || value.length > 32) return null;
  const match = /^(?:£\s*|GBP\s+)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s+GBP)?$/.exec(value.trim());
  return match ? price(Number(match[1].replaceAll(',', ''))) : null;
}

const weeks = (value) => (typeof value === 'number' || typeof value === 'string' && /^\d{1,3}$/.test(value))
  && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 520 ? Number(value) : null;
function range(current, min, max) {
  return { ...current, min: min === null ? current.min : current.min === null || min < current.min ? min : current.min,
    max: max === null ? current.max : current.max === null || max > current.max ? max : current.max,
    unknownCount: current.unknownCount + (min === null || max === null ? 1 : 0) };
}

function validateAggregate(state, model) {
  const keys = (value, expected) => plain(value) && Object.keys(value).sort().join(',') === expected.sort().join(',');
  const count = (value) => Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.requests * LIMITS.pageCars;
  if (!keys(state, Object.keys(createAggregate(model))) || state.modelLineId !== model.modelLineId
    || state.title !== model.title || !count(state.carCount)
    || !keys(state.unknownCounts, ['colour', 'upholstery'])
    || !keys(state.unsafeLabelCounts, ['colour', 'upholstery'])) fail('source-invalid');
  for (const [name, parser, extras] of [['leadTimeWeeks', weeks, []], ['deliveryDateSpread', dateOnly, []],
    ['priceBand', price, ['currency']]]) {
    const band = state[name];
    if (!keys(band, ['min', 'max', 'unknownCount', ...extras]) || !count(band.unknownCount)
      || band.unknownCount > state.carCount || extras.length && band.currency !== 'GBP'
      || ['min', 'max'].some((key) => band[key] !== null && parser(band[key]) !== band[key])) fail('source-invalid');
  }
  for (const [name, key, labels] of [['colourShares', 'colour', model.colours],
    ['upholsteryShares', 'upholstery', model.upholsteries]]) {
    if (!Array.isArray(state[name]) || !count(state.unknownCounts[key]) || !count(state.unsafeLabelCounts[key])
      || state.unsafeLabelCounts[key] > state.unknownCounts[key]) fail('source-invalid');
    const allowed = (label) => model.labelPolicy === 'safe-pattern' ? safeSourceLabel(label) : labels.includes(label);
    const seen = new Set(); let total = state.unknownCounts[key];
    for (const entry of state[name]) {
      if (!keys(entry, ['label', 'count', 'share']) || !allowed(entry.label)
        || seen.has(entry.label) || !count(entry.count) || !entry.count
        || entry.share !== entry.count / state.carCount) fail('source-invalid');
      seen.add(entry.label); total += entry.count;
    }
    if (total !== state.carCount) fail('source-invalid');
  }
}

export function accumulatePage(previous, page, model) {
  validateModel(model);
  validateAggregate(previous, model);
  if (!plain(page) || !Array.isArray(page.location) || page.location.length > LIMITS.pageCars
    || typeof page.finished !== 'boolean') fail('source-invalid');
  const next = { ...previous, unknownCounts: { ...previous.unknownCounts },
    unsafeLabelCounts: { ...previous.unsafeLabelCounts },
    leadTimeWeeks: { ...previous.leadTimeWeeks }, deliveryDateSpread: { ...previous.deliveryDateSpread },
    priceBand: { ...previous.priceBand } };
  const colourCounts = new Map(previous.colourShares.map(({ label, count }) => [label, count]));
  const upholsteryCounts = new Map(previous.upholsteryShares.map(({ label, count }) => [label, count]));
  for (const car of page.location) {
    if (!plain(car)) fail('source-invalid');
    const colour = category(car.colour, model, 'colours');
    const text = car.upholstery_text;
    const upholstery = category(text === undefined || text === null || text === ''
      ? car.upholstery_type : text, model, 'upholsteries');
    for (const [found, counts, key] of [[colour, colourCounts, 'colour'], [upholstery, upholsteryCounts, 'upholstery']]) {
      if (found.label === undefined) { next.unknownCounts[key]++; if (found.unsafe) next.unsafeLabelCounts[key]++; }
      else counts.set(found.label, (counts.get(found.label) || 0) + 1);
    }
    let min = weeks(car.lead_time_in_weeks_min); let max = weeks(car.lead_time_in_weeks_max);
    if (min !== null && max !== null && min > max) { min = null; max = null; }
    next.leadTimeWeeks = range(next.leadTimeWeeks, min, max);
    const delivery = dateOnly(car.confirmed_delivery_date_to);
    next.deliveryDateSpread = range(next.deliveryDateSpread, delivery, delivery);
    const cash = price(car.visible_cash_price);
    next.priceBand = range(next.priceBand, cash, cash);
    next.carCount++;
  }
  const shares = (counts) => Array.from(counts, ([label, count]) => ({ label, count,
    share: count / next.carCount })).sort((a, b) => a.label.localeCompare(b.label));
  next.colourShares = shares(colourCounts); next.upholsteryShares = shares(upholsteryCounts);
  return next;
}

function sessionCookie(headers) {
  let values = [];
  try { values = headers?.getSetCookie?.() ?? [headers?.get?.('set-cookie')]; } catch { return null; }
  let found = null;
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const match = new RegExp(`(?:^|,\\s*)${SESSION_COOKIE}=([^;,\\s]*)`).exec(raw);
    if (match && /^[A-Za-z0-9%._~+/=-]{1,4096}$/.test(match[1])) found = match[1];
  }
  return found;
}

async function readPage(url, fetchImpl, timeoutMs, budget, session) {
  const controller = new AbortController(); let timer; let reader; let response;
  try {
    return await Promise.race([(async () => {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error', credentials: 'omit',
        cache: 'no-store',
        headers: session.cookie ? { accept: 'application/json', cookie: `${SESSION_COOKIE}=${session.cookie}` }
          : { accept: 'application/json' }, signal: controller.signal });
      if (controller.signal.aborted) fail('request-timeout');
      if ([401, 403, 429].includes(response.status)) fail(`source-stopped-${response.status}`);
      if (response.redirected || response.status >= 300 && response.status < 400
        || response.url && response.url !== url) fail('redirect-refused');
      if (response.status === 204 && session.index > 0) {
        void response.body?.cancel().catch(() => {});
        return { location: [], finished: true };
      }
      if (response.status !== 200) fail('request-failed');
      session.cookie = sessionCookie(response.headers) ?? session.cookie;
      if (response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail('source-invalid');
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > LIMITS.pageBytes)) fail('response-too-large');
      reader = response.body?.getReader(); if (!reader) fail('source-invalid');
      const chunks = []; let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (controller.signal.aborted) fail('request-timeout');
        if (done) break;
        size += value.byteLength; budget.bytes += value.byteLength;
        if (size > LIMITS.pageBytes || budget.bytes > LIMITS.totalBytes) fail('response-too-large');
        chunks.push(Buffer.from(value));
      }
      try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); } catch { fail('source-invalid'); }
    })(), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Error('request-timeout')); }, timeoutMs);
    })]);
  } catch (error) {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {});
    fail(codes.has(error?.message) ? error.message : 'request-failed');
  } finally { clearTimeout(timer); }
}

async function publish(output, report) {
  let temporary;
  try {
    if (typeof output !== 'string' || !output.endsWith('.json')) fail('output-failed');
    const target = resolve(output); const parent = await lstat(dirname(target));
    if (!parent.isDirectory() || parent.isSymbolicLink()) fail('output-failed');
    try { const existing = await lstat(target);
      if (!existing.isFile() || existing.isSymbolicLink()) fail('output-failed');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    temporary = resolve(dirname(target), `.stock-aggregate-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } catch { fail('output-failed'); }
  finally { if (temporary) await unlink(temporary).catch(() => {}); }
}

export async function sampleStockLocator({ plan, execute = false, fetchImpl, output,
  sampleDate = new Date().toISOString().slice(0, 10), requestTimeoutMs = LIMITS.requestTimeoutMs,
  projectRoot = fileURLToPath(new URL('../../', import.meta.url)),
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  if (execute !== true) return { status: 'offline' };
  validatePlan(plan);
  plan = { kind: plan.kind, fixture: plan.fixture, maxRequests: plan.maxRequests,
    concurrency: 1, retries: 0, f77: plan.f77 && { reference: plan.f77.reference, sha256: plan.f77.sha256 },
    ...plan.kind === 'authorised-run' && { authority: { reference: plan.authority.reference, sha256: plan.authority.sha256 } },
    ...plan.stopAtRequestCap && { stopAtRequestCap: true },
    ...plan.minIntervalMs && { minIntervalMs: plan.minIntervalMs },
    models: plan.models.map((model) => ({ modelLineId: model.modelLineId, title: model.title,
      colours: [...model.colours], upholsteries: [...model.upholsteries], requests: [...model.requests],
      ...model.labelPolicy && { labelPolicy: model.labelPolicy } })) };
  if (!dateOnly(sampleDate) || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1
    || requestTimeoutMs > LIMITS.requestTimeoutMs) fail('plan-invalid');
  if (plan.kind === 'fixture') { if (typeof fetchImpl !== 'function') fail('plan-invalid'); }
  else {
    await (plan.kind === 'authorised-run' ? verifyAuthority : verifyAcceptance)(plan, projectRoot);
    fetchImpl ||= globalThis.fetch;
  }
  if (typeof fetchImpl !== 'function' || plan.minIntervalMs && typeof sleep !== 'function') fail('plan-invalid');
  const budget = { bytes: 0 }; let requestCount = 0; const models = [];
  for (const model of plan.models) {
    let aggregate = createAggregate(model); let completed = false; let modelRequests = 0;
    const session = { cookie: null, index: 0 };
    for (const url of model.requests) {
      if (requestCount >= plan.maxRequests) fail('sampling-incomplete');
      if (plan.minIntervalMs && requestCount > 0) await sleep(plan.minIntervalMs);
      session.index = modelRequests; requestCount++; modelRequests++;
      const page = await readPage(url, fetchImpl, requestTimeoutMs, budget, session);
      aggregate = accumulatePage(aggregate, page, model);
      if (page.finished) { completed = true; break; }
    }
    if (!completed && !plan.stopAtRequestCap) fail('sampling-incomplete');
    models.push({ ...aggregate, sampleDate, requestCount: modelRequests, complete: completed });
  }
  const report = { sampleDate, requestCount, source: 'BMW UK new-car stock locator',
    planDigest: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
    f77: plan.kind === 'accepted-f77' ? { reference: plan.f77.reference, sha256: plan.f77.sha256 } : null,
    authority: plan.kind === 'authorised-run' ? { reference: plan.authority.reference, sha256: plan.authority.sha256 } : null,
    evidenceKind: plan.kind === 'fixture' ? 'synthetic fixture' : 'observed aggregate', models };
  if (output !== undefined) await publish(output, report);
  return report;
}

async function main(args) {
  try {
    const options = {}; const allowed = new Set(['--plan', '--output']);
    for (let i = 0; i < args.length; i++) {
      const key = args[i];
      if (key === '--execute' && options.execute === undefined) options.execute = true;
      else if (allowed.has(key) && options[key] === undefined && args[i + 1] && !args[i + 1].startsWith('--')) {
        options[key] = args[++i];
      } else fail('plan-invalid');
    }
    if (!options.execute) { process.stdout.write('Offline: no requests or output.\n'); return; }
    if (!options['--plan'] || !options['--output']) fail('plan-invalid');
    let plan;
    try { plan = JSON.parse((await boundedFile(resolve(options['--plan']))).toString('utf8')); }
    catch { fail('plan-invalid'); }
    if (!['accepted-f77', 'authorised-run'].includes(plan.kind)) fail('plan-invalid');
    await sampleStockLocator({ plan, execute: true, output: options['--output'] });
    process.stdout.write('Aggregate sample saved.\n');
  } catch (error) {
    process.stderr.write(`${codes.has(error?.message) ? error.message : 'plan-invalid'}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
