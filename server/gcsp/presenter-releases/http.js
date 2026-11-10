import { ok, result } from '../repository/core.js';
import { readCarNamer } from '../policy/car-name.js';
import { configurationIdDisplayImage, modelDisplayImage, readDisplayImageCatalogue } from '../vehicle-evidence/display-images.js';

// FUCQ-364: presenter read of the run's latest release. User agnostic: cars and totals only, never a person.
const CONSUMER = 'stock-release';
const ASSET = /^\/assets\/gcsp-vehicle-evidence\/[a-f0-9]{64}\.webp$/;
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const fact = (row, name) => row?.facts?.facts?.[name]?.value;
const unavailable = () => result('unavailable', { reason: 'Released stock has not been configured.', retryable: true });
const broken = () => result('unavailable', { reason: 'The latest release could not be read. Try again.', retryable: true });
// The shared "on the scheme" predicate (greg/index.js, manual-context/ports.js): released, available, not held or allocated.
const onScheme = (row) => row.state === 'released' && row.available === true && row.held !== true && row.allocated !== true;

function latestRelease(receipts) {
  let latest = null;
  for (const receipt of receipts) {
    const value = receipt?.outcome?.status === 'ok' ? receipt.outcome.value : null;
    if (receipt?.eventType !== 'stock-released' || value?.kind !== 'stock-released' || !text(value.windowId)
      || !Number.isFinite(Date.parse(value.releasedAt)) || !Array.isArray(value.orderUuids)) continue;
    const later = !latest || Date.parse(value.releasedAt) > Date.parse(latest.releasedAt)
      || value.releasedAt === latest.releasedAt && receipt.eventId > latest.eventId;
    if (later) latest = { ...value, eventId: receipt.eventId };
  }
  return latest;
}

// Engine-led templates ("{engine} Touring") need an engine, so a bare line falls back to its last word.
const lineName = (name, line) => name(line, null) ?? name(`${line}|${line.split(' ').at(-1)}`, line);

async function image(row, key) {
  const photo = row.facts?.display?.photo;
  if (typeof photo === 'string' && ASSET.test(photo)) return photo;
  const found = await configurationIdDisplayImage(row.configurationId, key) ?? (key ? await modelDisplayImage(key) : null);
  return found ? `/${found.asset}` : null;
}

// Rows without a colour fact (fixed demo stock) take the paint of the catalogue picture they show.
async function pictureColours(policy, read) {
  let labels = null;
  try { labels = await policy?.getAssumption('stock.optionLabels.v1', read); } catch { /* colours stay unknown */ }
  const paint = labels?.status === 'ok' ? labels.value?.value?.paint ?? {} : {};
  const data = await readDisplayImageCatalogue().catch(() => null);
  const colours = new Map();
  for (const entry of data ? [...data.configurations.map((row) => row.image), ...Object.values(data.variants), ...Object.values(data.models)] : []) {
    let codes = [];
    try { codes = Buffer.from(entry?.configurationId ?? '', 'base64').toString('utf8').split(':')[1]?.split(',') ?? []; } catch { /* no paint */ }
    const code = codes.filter((item) => /^P[A-Z0-9]{4}$/.test(item));
    if (code.length === 1 && text(paint[code[0]]) && text(entry.asset)) colours.set(`/${entry.asset}`, paint[code[0]]);
  }
  return colours;
}

async function project(row, name, colours) {
  const key = text(fact(row, 'eligibilityModelKey')) ? fact(row, 'eligibilityModelKey') : null;
  const line = text(fact(row, 'modelLine')) ? fact(row, 'modelLine') : key?.split('|')[0] ?? null;
  const imageSrc = await image(row, key);
  const colourName = text(fact(row, 'colour')) ? fact(row, 'colour') : colours.get(imageSrc) ?? null;
  const recorded = text(row.facts?.display?.name) ? row.facts.display.name : null;
  const suffix = colourName ? ` in ${colourName}` : null;
  const modelName = recorded && suffix && recorded.endsWith(suffix) ? recorded.slice(0, -suffix.length)
    : recorded ?? (key ? name(key, line) : null);
  return { id: row.orderUuid, imageSrc, imageAlt: [modelName, colourName].filter(Boolean).join(' in '),
    modelName, modelLine: line ? lineName(name, line) : null, colourName };
}

const distinct = (cars, field) => new Set(cars.map((car) => car[field]).filter((value) => value !== null)).size;

/** Read only: release receipts and stock rows. Nothing is written, held, allocated or evaluated. */
export function createPresenterReleaseRoutes(deps) {
  return [{ method: 'GET', path: '/api/gcsp/presenter/releases/latest', role: 'presenter', purpose: 'presenter-control',
    async handle({ context, body, searchParams }) {
      if ([...searchParams.keys()].length || Object.keys(body).length) return result('invalid', {
        code: 'unsupported-query', reasons: [{ field: 'query', reason: 'The release view accepts no query selectors.' }],
      });
      const repository = deps?.repository;
      if (!repository) return unavailable();
      // Receipts first: a release commits its stock rows with its receipt, so every listed car is already readable.
      const receipts = await repository.query(context, 'event_receipts', { consumerId: CONSUMER, state: 'completed' });
      if (receipts.status !== 'ok') return receipts;
      const stock = await repository.query(context, 'stock');
      if (stock.status !== 'ok') return stock;
      const release = latestRelease(receipts.value);
      const empty = { runId: context.runId, release: null, cars: [], modelLines: [],
        counts: { released: 0, modelLines: 0, colours: 0, onScheme: stock.value.filter(onScheme).length } };
      if (!release) return ok(empty);
      const rows = new Map(stock.value.map((row) => [row.orderUuid, row]));
      if (release.orderUuids.some((id) => !rows.has(id))) return broken();
      const read = { runId: context.runId, asOf: release.releasedAt, policyVersion: release.policyVersion };
      const [name, colours] = await Promise.all([readCarNamer(deps.policy, read), pictureColours(deps.policy, read)]);
      const cars = await Promise.all(release.orderUuids.map((id) => project(rows.get(id), name, colours)));
      const lines = new Map();
      for (const car of cars) if (car.modelLine) lines.set(car.modelLine, (lines.get(car.modelLine) ?? 0) + 1);
      const modelLines = [...lines].map(([modelLine, count]) => ({ modelLine, count }))
        .sort((a, b) => b.count - a.count || (a.modelLine < b.modelLine ? -1 : 1));
      return ok({ ...empty, release: { windowId: release.windowId, releasedAt: release.releasedAt, trancheId: release.trancheId }, cars, modelLines,
        counts: { released: cars.length, modelLines: modelLines.length, colours: distinct(cars, 'colourName'), onScheme: empty.counts.onScheme } });
    } }];
}
