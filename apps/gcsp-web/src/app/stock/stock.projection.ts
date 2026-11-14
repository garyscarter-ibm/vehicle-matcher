import { StockCar, StockData, StockDecision, StockDisplayFact, StockFact, StockPayload, StockProjection,
  StockRecord, StockReleaseHistory, StockState, StockVersions } from './stock.types';

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): value is number => count(value) && value > 0;
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const instant = (value: unknown): value is string => text(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const optionalText = (value: unknown) => value == null || text(value);
const own = (value: object, key: string) => Object.hasOwn(value, key);
const equal = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  return object(a) && object(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => own(b, key) && equal(a[key], b[key]));
};
function data(value: unknown, ancestors = new Set<unknown>()): value is StockData {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!object(value) && !Array.isArray(value) || ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = Object.values(value).every((part) => data(part, ancestors));
  ancestors.delete(value); return valid;
}
const assurances = ['unknown', 'confirmed-listing', 'confirmed-build', 'model-reference', 'derived', 'synthetic-scenario'];
function provenance(value: unknown): boolean {
  return object(value) && text(value['sourceRef']) && text(value['version']) && instant(value['observedAt']) && assurances.includes(value['assurance'] as string);
}
function fact(value: unknown): boolean {
  return object(value) && ['known', 'unknown'].includes(value['status'] as string) && own(value, 'value')
    && (value['status'] === 'unknown' ? value['value'] === null : value['value'] !== null)
    && (value['unit'] === null || text(value['unit'])) && (typeof value['value'] !== 'number' || text(value['unit']))
    && (value['provenance'] === undefined || provenance(value['provenance'])
      && object(value['provenance']) && (value['status'] === 'unknown') === (value['provenance']['assurance'] === 'unknown'));
}
const points = (value: unknown): boolean => object(value) && amount(value['value']) && value['unit'] === 'points';
function terms(value: unknown): boolean {
  if (!object(value) || value['kind'] !== 'employee-scheme' || !text(value['termsVersion']) || !points(value['points'])
    || !object(value['allowanceInputs']) || !Object.values(value['allowanceInputs']).every(points)) return false;
  const cash = value['contribution'];
  if (cash !== null && (!object(cash) || !amount(cash['amount']) || !text(cash['currency']) || !/^[A-Z]{3}$/.test(cash['currency'])
    || !['month', 'year', 'one-off'].includes(cash['period'] as string))) return false;
  if (value['provenance'] !== undefined && !provenance(value['provenance'])) return false;
  return (value['validFrom'] === undefined && value['validUntil'] === undefined)
    || instant(value['validFrom']) && instant(value['validUntil']) && Date.parse(value['validUntil']) > Date.parse(value['validFrom']);
}
function snapshot(value: unknown, id: string, key: string): boolean {
  if (!object(value) || value['identityKind'] !== 'exact-stock' || !object(value['sourceKeys']) || value['sourceKeys']['stockId'] !== id
    || !text(value['sourceNamespace']) || value['candidateKey'] !== key || key !== `${encodeURIComponent(value['sourceNamespace'])}:exact-stock:${encodeURIComponent(id)}`
    || !text(value['snapshotVersion']) || !object(value['facts']) || !Object.values(value['facts']).every(fact)
    || !object(value['display'])) return false;
  if (value['contractVersion'] !== undefined && value['contractVersion'] !== 'vehicle-snapshot-v1'
    || value['observedAt'] !== undefined && !instant(value['observedAt'])) return false;
  const display = value['display'];
  if (!['name', 'manufacturer', 'model', 'derivative', 'photo', 'link', 'colour'].every((name) => optionalText(display[name]))) return false;
  return display['images'] === undefined || Array.isArray(display['images']) && display['images'].every((image: unknown) => object(image)
    && text(image['src']) && optionalText(image['alt']) && optionalText(image['caption']) && (image['provenance'] === undefined || object(image['provenance'])));
}
function decision(value: unknown, versions: Record<string, unknown>): value is StockDecision {
  if (!object(value) || !text(value['orderUuid']) || !text(value['configurationId']) || !text(value['candidateKey'])
    || typeof value['orderNumber'] !== 'string' || !/^\d{7}$/.test(value['orderNumber']) || value['draftVersion'] !== versions['draft']
    || !['eligible', 'ineligible', 'needs-confirmation'].includes(value['gateStatus'] as string)
    || !snapshot(value['snapshot'], value['orderUuid'], value['candidateKey']) || !object(value['versions'])) return false;
  const pin = value['versions']; const snap = value['snapshot'] as Record<string, unknown>; const quote = value['terms'];
  if (!text(pin['availability']) || object(value['evidence']) && object(value['evidence']['availability'])
    && value['evidence']['availability']['version'] !== pin['availability']) return false;
  if (pin['snapshot'] !== snap['snapshotVersion'] || quote !== null && !terms(quote)
    || pin['terms'] !== (object(quote) ? quote['termsVersion'] : null)) return false;
  if (Object.entries(versions).some(([key, part]) => !['draft', 'context'].includes(key) && (!own(pin, key) || !equal(pin[key], part)))) return false;
  if (own(pin, 'context') && pin['context'] !== versions['context']) return false;
  if (Object.entries(pin).some(([key, part]) => key === 'brief' ? part !== versions['draft'] : key === 'terms' ? part !== null && !text(part)
    : !text(part))) return false;
  if (value['score'] !== undefined && value['score'] !== null || value['suitable'] !== undefined && value['suitable'] !== (value['gateStatus'] === 'eligible')) return false;
  if (!['blockers', 'unknowns'].every((key) => Array.isArray(value[key]) && value[key].every((entry: unknown) => text(entry) || object(entry)))) return false;
  const claim = value['claimInput'];
  return claim == null || object(claim) && value['gateStatus'] === 'eligible' && object(quote) && claim['orderUuid'] === value['orderUuid']
    && positive(claim['expectedStockVersion']) && claim['expectedDraftVersion'] === versions['draft']
    && claim['expectedContextVersion'] === versions['context'] && text(claim['expectedTermsDigest']);
}
export function validStockReleaseHistory(value: unknown): value is StockReleaseHistory {
  if (!object(value) || !text(value['runId']) || !instant(value['observedAt']) || !object(value['history'])
    || !object(value['source']) || value['source']['state'] !== 'current-version-unknown') return false;
  const h = value['history']; const sourceVersions = h['sourceVersions'];
  if (!count(h['releasedCarCount']) || !count(h['releaseCount']) || !Array.isArray(sourceVersions) || !sourceVersions.every(text)
    || new Set(sourceVersions).size !== sourceVersions.length) return false;
  if (h['state'] === 'none-visible') return h['releasedCarCount'] === 0 && h['releaseCount'] === 0 && h['latestReleasedAt'] === null && !sourceVersions.length;
  return h['state'] === 'released' && h['releasedCarCount'] > 0 && h['releaseCount'] > 0 && h['releaseCount'] <= h['releasedCarCount']
    && instant(h['latestReleasedAt']) && Date.parse(h['latestReleasedAt']) <= Date.parse(value['observedAt'])
    && sourceVersions.length > 0 && sourceVersions.length <= h['releaseCount'];
}

/** Validate the employee stock DTO; compact rows cannot override shared version pins. */
export function validateStockPayload(input: unknown): StockPayload | null {
  if (!data(input) || !object(input) || !object(input['versions']) || !positive(input['versions']['draft']) || !text(input['versions']['context'])
    || !count(input['total']) || !Array.isArray(input['decisions']) || input['ranked'] !== false || input['browsingReservesStock'] !== false) return null;
  const source: Record<string, unknown> = structuredClone(input); const versions = source['versions'] as Record<string, unknown>;
  if (!['brief', 'facts', 'policy', 'stock', 'clock'].every((key) => own(versions, key))
    || versions['brief'] !== versions['draft'] || Object.entries(versions).some(([key, part]) => ['draft', 'brief'].includes(key) ? !positive(part) : !text(part))) return null;
  let rows: unknown[] = source['decisions'] as unknown[]; let cars: unknown[];
  if (source['payloadShape'] !== undefined) {
    const shared = source['sharedVersionKeys']; const ids = source['carIds'];
    if (source['payloadShape'] !== 'manual-stock-compact-v1' || own(source, 'cars') || !Array.isArray(shared) || !shared.every(text)
      || new Set(shared).size !== shared.length || shared.some((key) => !own(versions, key) || ['draft', 'context'].includes(key))
      || !Array.isArray(ids) || !ids.every(text) || new Set(ids).size !== ids.length) return null;
    const expanded: unknown[] = [];
    for (const row of rows) {
      if (!object(row) || !object(row['versions']) || shared.some((key) => own(row['versions'] as object, key))) return null;
      expanded.push({ ...row, versions: { ...row['versions'], ...Object.fromEntries(shared.map((key) => [key, versions[key]])) } });
    }
    rows = expanded;
    const byId = new Map(rows.filter(object).map((row) => [row['orderUuid'], row]));
    cars = ids.map((id) => byId.get(id));
    delete source['payloadShape']; delete source['sharedVersionKeys']; delete source['carIds'];
  } else {
    if (!Array.isArray(source['cars']) || own(source, 'carIds') || own(source, 'sharedVersionKeys')) return null;
    cars = source['cars'];
  }
  if (!rows.every((row) => decision(row, versions)) || new Set(rows.map((row) => row.orderUuid)).size !== rows.length
    || new Set(rows.map((row) => row.orderNumber)).size !== rows.length) return null;
  const eligible = rows.filter((row) => row.gateStatus === 'eligible');
  const byId = new Map(rows.map((row) => [row.orderUuid, row]));
  if (cars.length !== source['total'] || cars.length !== eligible.length || !cars.every((car) => object(car)
    && text(car['orderUuid']) && byId.has(car['orderUuid']) && equal(car, byId.get(car['orderUuid'])) && car['gateStatus'] === 'eligible')
    || new Set(cars.map((car) => (car as StockDecision).orderUuid)).size !== cars.length) return null;
  const expectedState = rows.length ? eligible.length ? 'available-stock' : 'no-eligible-stock' : 'empty-stock';
  if (source['state'] !== expectedState && !(source['state'] === 'nothing-released-yet' && !rows.length)) return null;
  const history = source['releaseHistory'];
  if (history !== undefined && (!validStockReleaseHistory(history) || source['runId'] != null && source['runId'] !== history.runId
    || history.history.releasedCarCount < rows.length)) return null;
  if (source['heldOffer'] != null && (!object(source['heldOffer']) || !optionalText(source['heldOffer']['offerId']) || !optionalText(source['heldOffer']['runId']))) return null;
  return { ...source, state: source['state'] as StockPayload['state'], decisions: rows,
    cars: cars.map((car) => byId.get((car as StockDecision).orderUuid)!), total: cars.length,
    versions: versions as StockVersions, ranked: false, browsingReservesStock: false,
    ...(history === undefined ? {} : { releaseHistory: history as StockReleaseHistory }) };
}

const known = (source: StockFact | undefined): StockData => source?.status === 'known' ? source.value : null;
const suppliedText = (value: unknown): string | null => text(value) ? value : null;
function field(key: string, label: string, source?: StockFact, fallback: StockData = null): StockDisplayFact {
  const value = known(source) ?? fallback; const unit = source?.unit === 'insurance-group' ? null : source?.unit ?? null;
  return { key, label, value, status: value === null ? 'unknown' : 'known', unit,
    missingLabel: `Not supplied${unit ? ` (${unit})` : ''}`, provenance: source?.provenance, source };
}
function emission(key: string, label: string, source: StockFact | undefined, expected: RegExp): StockDisplayFact {
  const observation = source?.status === 'known' && object(source.value) ? source.value : source;
  const basis = observation?.['basis'] ?? source?.['basis']; const unit = observation?.['unit'] ?? source?.unit;
  const value = source?.status === 'known' && amount(observation?.['value']) && unit === 'g/km' && typeof basis === 'string' && expected.test(basis)
    ? observation['value'] as number : null;
  return { key, label, value, status: value === null ? 'unknown' : 'known', unit: 'g/km', basis: typeof basis === 'string' && expected.test(basis) ? basis : null,
    missingLabel: 'Not supplied (g/km)', provenance: source?.provenance, source };
}
function car(decision: StockDecision, versions: StockVersions, held: boolean): StockCar {
  const { snapshot, terms, gateStatus } = decision; const facts = snapshot.facts; const display = snapshot.display;
  const identity = { orderUuid: decision.orderUuid, orderNumber: decision.orderNumber, configurationId: decision.configurationId, candidateKey: decision.candidateKey };
  const fields = {
    model: field('model', 'Model', facts['model'] ?? facts['marketingModelRange'] ?? facts['modelRange'], suppliedText(display['model'])),
    body: field('body', 'Body style', facts['body'] ?? facts['bodyType']), engine: field('engine', 'Engine', facts['engine'], suppliedText(display['derivative'])),
    exterior: field('exterior', 'Exterior', facts['exterior'] ?? facts['colour'] ?? facts['colors'], suppliedText(display['colour'])),
    interior: field('interior', 'Interior', facts['interior'] ?? facts['upholsteryCode']), transmission: field('transmission', 'Transmission', facts['transmission']),
    insuranceGroup: field('insuranceGroup', 'Insurance group', facts['insuranceGroup']),
    earliestCollection: field('earliestCollection', 'Earliest collection', facts['earliestCollection'] ?? facts['earliestCollectionDate']),
  };
  const emissions = [emission('nedcCo2', 'NEDC / correlated CO2', facts['nedcCo2'] ?? facts['co2Nedc'] ?? facts['co2NEDC'], /^(NEDC|NEDC-correlated|correlated)$/i),
    emission('wltpCo2', 'WLTP CO2', facts['wltpCo2'] ?? facts['co2Wltp'] ?? facts['co2WLTP'], /^WLTP$/i)];
  const selectedImage = display.images?.find((image) => image.src === display.photo);
  const media = { src: suppliedText(display.photo), alt: suppliedText(selectedImage?.alt) ?? suppliedText(display.name) ?? 'Car',
    caption: suppliedText(selectedImage?.caption), provenance: selectedImage?.provenance, images: display.images ?? [] };
  const allFacts = Object.entries(facts).map(([key, source]) => field(key, key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' '), source));
  const exactFacts = allFacts.filter((row) => ['confirmed-build', 'confirmed-listing', 'synthetic-scenario'].includes(row.provenance?.assurance ?? ''));
  const referenceFacts = allFacts.filter((row) => row.provenance?.assurance === 'model-reference');
  const reviewAvailable = gateStatus === 'eligible' && !!decision.claimInput && !held;
  return { id: decision.orderUuid, identity, gateStatus, name: suppliedText(display.name) ?? 'Car name not supplied', fields, emissions,
    series: field('series', 'Series', facts['series']), media,
    cost: { kind: 'points-monthly', value: terms?.points.value ?? null, allowance: terms?.allowanceInputs['allowance']?.value ?? null },
    contribution: terms?.contribution ?? null, detail: { identity, snapshot, facts: allFacts, exactFacts, referenceFacts,
      unclassifiedFacts: allFacts.filter((row) => !exactFacts.includes(row) && !referenceFacts.includes(row)), media, terms,
      equipment: facts['equipment'] ?? facts['equipments'] ?? null, specifications: facts['specifications'] ?? facts['technicalAndEmission'] ?? null,
      historic: facts['historic'] ?? facts['history'] ?? null },
    review: { ...identity, facts, snapshot, terms, draftVersion: decision.draftVersion, versions, decisionVersions: decision.versions, claimInput: decision.claimInput ?? null },
    reviewAvailable, reviewDisabledReason: gateStatus === 'ineligible' ? 'This car is not eligible.' : gateStatus === 'needs-confirmation'
      ? 'Confirm the missing information before reviewing this car.' : !decision.claimInput ? 'Refresh to review this car.' : held ? 'Decide on your car offer first.' : null,
    evidence: decision };
}

/** Presentation only: no policy calculation, ranking, claim issuance or stock reservation. */
export function projectStock(envelope: unknown): StockProjection {
  const empty = (state: StockState, failure: StockRecord | null = null): StockProjection => ({ state, allCars: [], cars: [],
    counts: { records: 0, eligible: 0 }, source: null, releaseHistory: null, failure, ranked: false, browsingReservesStock: false });
  if (!object(envelope) || envelope['status'] !== 'ok') {
    const failure = object(envelope) && data(envelope) ? structuredClone(envelope) : null;
    const state = failure?.['status'] === 'invalid' ? 'choices-invalid' : ['stale-run', 'stale-version'].includes(failure?.['status'] as string)
      ? 'context-refresh' : object(failure?.['view']) && failure['view']['state'] === 'car-taken' ? 'car-taken' : 'source-unavailable';
    return empty(state, failure);
  }
  const source = validateStockPayload(envelope['value']);
  if (!source) return empty('source-unavailable', { status: 'unavailable', code: 'stock-response-invalid', retryable: true });
  const allCars = source.decisions.map((row) => car(row, source.versions, source.heldOffer != null));
  const byId = new Map(allCars.map((row) => [row.id, row]));
  const history = source.releaseHistory ?? null;
  const state: StockState = !allCars.length ? history?.history.state === 'none-visible' ? 'no-visible-releases'
    : source.state === 'nothing-released-yet' && !history ? 'nothing-released-yet' : 'empty-stock'
    : source.total ? 'available-stock' : 'no-suitable-stock';
  return { state, allCars, cars: source.cars.map((row) => byId.get(row.orderUuid)!), counts: { records: allCars.length, eligible: source.total },
    source, releaseHistory: history, failure: null, ranked: false, browsingReservesStock: false };
}
