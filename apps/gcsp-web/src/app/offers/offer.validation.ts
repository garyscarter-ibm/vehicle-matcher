import {
  OfferDecisionInput,
  OfferDecisionKind,
  OfferDecisionReceipt,
  OfferDeclineReasons,
  OfferExplanation,
  OfferFact,
  OfferFailure,
  OfferFollowupConfirmInput,
  OfferFollowupValue,
  OfferHandoff,
  OfferJsonValue,
  OfferPointAmount,
  OfferProjection,
  OfferProvenance,
  OfferSavedChange,
  OfferSelection,
  OfferSimpleValue,
  OfferTerms,
  OfferVehicleSnapshot,
} from './offer.types';

const authorityKeys = new Set(['runId', 'environmentId', 'employeeId', 'subject', 'principalId', 'policyVersion']);
const factKeys = new Set(['eligibilityModelKey', 'body', 'fuel', 'seats', 'doors', 'boot', 'zeroTo62', 'mileage',
  'evRange', 'mpg', 'cc', 'year', 'sizeClass', 'tags', 'frontIsofix', 'rearIsofix', 'gearbox', 'transmission',
  'colour', 'interior', 'co2', 'power', 'torque', 'electricRange', 'equipment', 'options', 'availableFrom']);
const explanationKeys = ['code', 'text', 'key', 'field', 'keys', 'attribute', 'preference', 'direction', 'expected',
  'actual', 'target', 'desired', 'observed', 'unit', 'allowance', 'monthlyPoints', 'score', 'weight', 'importance',
  'ruleIds', 'requiredBy', 'availableFrom', 'facts', 'fact', 'requirement'];
const comparisonKeys = new Set(['configuration', 'body', 'fuel', 'seats', 'boot', 'mpg', 'zeroTo62', 'points']);
const assurance = new Set(['unknown', 'confirmed-listing', 'confirmed-build', 'model-reference', 'derived', 'synthetic-scenario']);
const actionNames = ['accept', 'decline'] as const;
const failureStatuses = new Set(['invalid', 'unavailable', 'stale-version', 'conflict', 'forbidden', 'denied',
  'not-found', 'stale-run', 'pending', 'unauthenticated', 'unsupported']);

type RecordValue = Record<string, unknown>;
export interface OfferResultIdentity { readonly runId?: string; readonly offerId?: string; readonly decisionId?: string; readonly commandId?: string }

function object(value: unknown): value is RecordValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function only(value: unknown, fields: readonly string[]): value is RecordValue {
  return object(value) && Reflect.ownKeys(value).every((key) => typeof key === 'string' && fields.includes(key));
}

function textFields(value: unknown, fields: readonly string[]): boolean {
  return only(value, fields) && fields.every((key) => text(value[key]));
}

function has(value: RecordValue, key: string): boolean { return Object.hasOwn(value, key); }

function text(value: unknown, maximum = 2048): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function instant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}

function positive(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) > 0; }
function nonnegative(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function scalar(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value);
}

function simple(value: unknown): value is OfferSimpleValue {
  return scalar(value) || Array.isArray(value) && value.every(scalar);
}

function jsonValue(value: unknown, depth = 0): value is OfferJsonValue {
  if (depth > 32) return false;
  if (scalar(value)) return true;
  if (Array.isArray(value)) return value.length <= 4096 && value.every((item) => jsonValue(item, depth + 1));
  return object(value) && Reflect.ownKeys(value).every((key) => typeof key === 'string' && !['__proto__', 'prototype', 'constructor'].includes(key)
    && jsonValue(value[key], depth + 1));
}

function authorityFree(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(authorityFree);
  if (!object(value)) return true;
  return Object.entries(value).every(([key, item]) => !authorityKeys.has(key) && authorityFree(item));
}

function provenance(value: unknown): value is OfferProvenance {
  return only(value, ['sourceRef', 'observedAt', 'version', 'assurance'])
    && ['sourceRef', 'version'].every((key) => text(value[key])) && instant(value['observedAt'])
    && typeof value['assurance'] === 'string' && assurance.has(value['assurance']);
}

function offerFact(value: unknown): value is OfferFact {
  return only(value, ['status', 'value', 'unit', 'provenance'])
    && ['known', 'unknown'].includes(String(value['status'])) && simple(value['value'])
    && (value['status'] !== 'unknown' || value['value'] === null)
    && (value['unit'] === null || text(value['unit'])) && provenance(value['provenance']);
}

function factMap(value: unknown): value is Record<string, OfferFact> {
  return object(value) && Object.entries(value).every(([key, row]) => factKeys.has(key) && offerFact(row));
}

function explanation(value: unknown): value is OfferExplanation {
  if (typeof value === 'string') return true;
  if (!only(value, explanationKeys)) return false;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'facts') {
      if (object(item) ? !factMap(item) : !simple(item)) return false;
    } else if (key === 'fact') {
      if (!offerFact(item)) return false;
    } else if (key === 'requirement') {
      if (!only(item, ['value', 'operator', 'unit']) || !Object.values(item).every(simple)) return false;
    } else if (!simple(item)) return false;
    if (key === 'field' && typeof item === 'string' && factKeys.has(item)) continue;
  }
  return true;
}

function imageUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value, 'https://offer-display.invalid/');
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function image(value: unknown): boolean {
  if (!only(value, ['src', 'alt', 'caption', 'fidelity', 'sourceRef', 'viewpoint', 'label']) || !imageUrl(value['src'])) return false;
  return ['alt', 'caption', 'fidelity', 'sourceRef', 'viewpoint', 'label'].every((key) => value[key] === undefined || typeof value[key] === 'string');
}

function snapshot(value: unknown, orderUuid: string): value is OfferVehicleSnapshot {
  if (!only(value, ['contractVersion', 'identityKind', 'candidateKey', 'sourceNamespace', 'snapshotVersion', 'observedAt', 'sourceKeys', 'display', 'facts'])
    || value['contractVersion'] !== 'vehicle-snapshot-v1' || value['identityKind'] !== 'exact-stock'
    || !['candidateKey', 'sourceNamespace', 'snapshotVersion'].every((key) => text(value[key])) || !instant(value['observedAt'])
    || !only(value['sourceKeys'], ['stockId']) || value['sourceKeys']['stockId'] !== orderUuid) return false;
  const display = value['display'];
  if (!only(display, ['name', 'photo', 'images', 'manufacturer', 'model', 'derivative', 'colour']) || !text(display['name'])
    || !imageUrl(display['photo']) || !Array.isArray(display['images']) || !display['images'].every(image)
    || !['manufacturer', 'model', 'derivative', 'colour'].every((key) => display[key] === undefined || typeof display[key] === 'string')) return false;
  return factMap(value['facts']);
}

function points(value: unknown): value is OfferPointAmount {
  return only(value, ['value', 'unit']) && finite(value['value']) && (value['value'] as number) >= 0 && value['unit'] === 'points';
}

function pointContainer(value: unknown): value is { allowance?: OfferPointAmount } {
  return only(value, ['allowance']) && (value['allowance'] === undefined || points(value['allowance']));
}

function terms(value: unknown): value is OfferTerms {
  if (!only(value, ['kind', 'termsVersion', 'validFrom', 'validUntil', 'points', 'allowanceInputs', 'provenance', 'contribution'])
    || value['kind'] !== 'employee-scheme' || !text(value['termsVersion']) || !instant(value['validFrom']) || !instant(value['validUntil'])
    || !points(value['points']) || !pointContainer(value['allowanceInputs']) || !provenance(value['provenance'])) return false;
  const contribution = value['contribution'];
  return contribution === undefined || contribution === null || only(contribution, ['amount', 'currency', 'period'])
    && finite(contribution['amount']) && contribution['amount'] >= 0 && typeof contribution['currency'] === 'string'
    && /^[A-Z]{3}$/.test(contribution['currency']) && ['month', 'year', 'one-off'].includes(String(contribution['period']));
}

function decision(value: unknown): boolean {
  return only(value, ['gateStatus', 'score', 'reasons', 'tradeOffs', 'blockers', 'unknowns'])
    && ['eligible', 'ineligible', 'needs-confirmation'].includes(String(value['gateStatus']))
    && (value['score'] === null || finite(value['score']))
    && ['reasons', 'tradeOffs', 'blockers', 'unknowns'].every((key) => Array.isArray(value[key]) && value[key].every(explanation));
}

function handoff(value: unknown): value is OfferHandoff {
  const keys = ['termsVersion', 'termsDigest', 'wording', 'fictional', 'mode', 'blocker', 'driver', 'returnMileage', 'documentSource', 'declarations', 'contact', 'returnCar'];
  if (!only(value, keys) || value['fictional'] !== true || !['new', 'replacement'].includes(String(value['mode']))
    || !['termsVersion', 'termsDigest', 'wording'].every((key) => value[key] === null || text(value[key]))
    || ![null, 'contact-required', 'driver-review-required', 'return-data-required', 'ordering-terms-unavailable'].includes(value['blocker'] as string | null)
    || !Array.isArray(value['declarations']) || value['declarations'].length > 16
    || !value['declarations'].every((row) => only(row, ['id', 'label']) && text(row['id'], 128) && text(row['label'], 256))
    || new Set(value['declarations'].map((row: RecordValue) => row['id'])).size !== value['declarations'].length) return false;
  const contact = value['contact'];
  if (!(contact === null || only(contact, ['phone', 'email']) && text(contact['phone']) && text(contact['email']))) return false;
  const driver = value['driver'];
  if (driver !== null) {
    if (!only(driver, ['name', 'kind', 'licence']) || ![driver['name'], driver['kind']].every((item) => item === null || text(item))) return false;
    const licence = driver['licence'];
    if (licence !== null && (!only(licence, ['displayNumber', 'categories', 'validFrom', 'validUntil'])
      || ![licence['displayNumber'], licence['validFrom'], licence['validUntil']].every((item) => item === null || text(item))
      || !Array.isArray(licence['categories']) || !licence['categories'].every((item) => text(item)))) return false;
  }
  const mileage = value['returnMileage'];
  if (!(mileage === null || only(mileage, ['maximum', 'unit']) && positive(mileage['maximum']) && valueUnit(mileage['unit'], 'mi'))) return false;
  const source = value['documentSource'];
  if (!(source === null || only(source, ['terms', 'termsVersion', 'recordSource'])
    && (source['terms'] === null || source['terms'] === 'ordering.terms.v1')
    && (source['termsVersion'] === null || text(source['termsVersion'])) && (source['recordSource'] === null || text(source['recordSource'])))) return false;
  const car = value['returnCar'];
  if (!(car === null || only(car, ['model', 'contractEndDate', 'currentOdometer', 'expectedReturnMileage'])
    && (car['model'] === null || text(car['model'])) && (car['contractEndDate'] === null || text(car['contractEndDate']))
    && car['expectedReturnMileage'] === null && (car['currentOdometer'] === null
      || only(car['currentOdometer'], ['value', 'unit']) && finite(car['currentOdometer']['value'])
        && car['currentOdometer']['value'] >= 0 && text(car['currentOdometer']['unit'])))) return false;
  return value['blocker'] !== null || ['termsVersion', 'termsDigest', 'wording'].every((key) => text(value[key]))
    && value['declarations'].length > 0 && contact !== null;
}

function valueUnit(value: unknown, expected: string): boolean { return value === expected; }

function selection(value: unknown): value is OfferSelection {
  return only(value, ['schemaVersion', 'selectionState', 'approved', 'current', 'orderReference', 'orderNumber', 'stages'])
    && value['schemaVersion'] === 1 && ['acknowledged', 'handoff-pending', 'handoff-failed'].includes(String(value['selectionState']))
    && value['approved'] === false && text(value['current']) && Array.isArray(value['stages'])
    && value['stages'].length > 0 && value['stages'].length <= 8
    && value['stages'].every((stage) => only(stage, ['name', 'state']) && text(stage['name'])
      && ['complete', 'waiting', 'not-started', 'pending', 'failed'].includes(String(stage['state'])))
    && (value['orderNumber'] === null || typeof value['orderNumber'] === 'string' && /^\d{7}$/.test(value['orderNumber']))
    && (value['orderReference'] === null || typeof value['orderReference'] === 'string' && /^[A-Za-z0-9-]{1,32}$/.test(value['orderReference']));
}

function currentCarComparison(value: unknown): boolean {
  if (!only(value, ['status', 'reason', 'comparisonAvailable', 'currentCar', 'unknowns'])
    || !['unavailable', 'partial', 'available'].includes(String(value['status'])) || !text(value['reason'])
    || typeof value['comparisonAvailable'] !== 'boolean' || !Array.isArray(value['unknowns'])
    || !value['unknowns'].every((key) => typeof key === 'string' && comparisonKeys.has(key))
    || new Set(value['unknowns']).size !== value['unknowns'].length) return false;
  if (value['status'] === 'unavailable') return value['comparisonAvailable'] === false && value['currentCar'] === null;
  const car = value['currentCar'];
  if (value['comparisonAvailable'] !== true || !only(car, ['model', 'source', 'facts']) || !text(car['model'])
    || !only(car['source'], ['mode', 'sourceVersion', 'observedAt'])
    || !['synthetic', 'dated-snapshot', 'authorised-live'].includes(String(car['source']['mode']))
    || !text(car['source']['sourceVersion']) || !instant(car['source']['observedAt'])) return false;
  if (car['facts'] !== undefined && (!object(car['facts']) || Object.entries(car['facts']).some(([key, fact]) =>
    !comparisonKeys.has(key) || !only(fact, ['value', 'unit']) || !(typeof fact['value'] === 'string' || finite(fact['value']))
      || fact['unit'] !== null && !text(fact['unit'])))) return false;
  return value['status'] === (value['unknowns'].length ? 'partial' : 'available');
}

function revisionPins(value: unknown): value is Record<string, string | number> & { quote: number } {
  const keys = ['quote', 'brief', 'facts', 'policy', 'stock', 'snapshot', 'terms', 'clock', 'availability', 'feedback'];
  return only(value, keys) && positive(value['quote']) && Object.entries(value).every(([key, pin]) => key === 'quote'
    || typeof pin === 'string' && text(pin) || finite(pin));
}

export function isOfferProjection(value: unknown, expected: { readonly offerId: string; readonly runId: string }): value is OfferProjection {
  const keys = ['schemaVersion', 'offerId', 'runId', 'state', 'reason', 'serverNow', 'clockVersion', 'expiresAt', 'offerVersion',
    'holdVersion', 'offerState', 'holdState', 'availableActions', 'followup', 'handoff', 'selection', 'quote', 'comparison'];
  if (!only(value, keys) || value['schemaVersion'] !== 1 || value['offerId'] !== expected.offerId || value['runId'] !== expected.runId
    || !['pending', 'accepted', 'declined', 'expired', 'superseded'].includes(String(value['state'])) || !text(value['reason'])
    || !instant(value['serverNow']) || !text(value['clockVersion']) || !instant(value['expiresAt'])
    || !positive(value['offerVersion']) || !positive(value['holdVersion']) || !text(value['offerState']) || !text(value['holdState'])
    || !Array.isArray(value['availableActions']) || !value['availableActions'].every((action) => actionNames.includes(action as OfferDecisionKind))
    || new Set(value['availableActions']).size !== value['availableActions'].length
    || (value['availableActions'].includes('accept') && !value['availableActions'].includes('decline'))
    || value['state'] !== 'pending' && value['availableActions'].length !== 0) return false;
  const followup = value['followup'];
  if (!(followup === null || only(followup, ['decisionId']) && typeof followup['decisionId'] === 'string'
    && /^offer-decision:[a-f0-9]{64}$/.test(followup['decisionId'])
    && value['state'] === 'declined' && ['rejected', 'declined'].includes(String(value['offerState'])) && value['holdState'] === 'released')) return false;
  if (!(value['handoff'] === null || handoff(value['handoff'])) || !(value['selection'] === null || selection(value['selection']))
    || value['handoff'] !== null && value['state'] !== 'pending' || value['selection'] !== null && value['state'] !== 'accepted'
    || value['availableActions'].includes('accept') && (!value['handoff'] || value['handoff']['blocker'] !== null)) return false;
  const quote = value['quote'];
  if (!only(quote, ['quoteId', 'configurationId', 'orderUuid', 'orderNumber', 'briefVersion', 'policyVersion', 'quotedAt', 'validUntil', 'revisions', 'facts', 'decision', 'terms', 'allowance'])
    || !['quoteId', 'configurationId', 'orderUuid', 'policyVersion'].every((key) => text(quote[key])) || !positive(quote['briefVersion'])
    || !(quote['orderNumber'] === null || typeof quote['orderNumber'] === 'string' && /^\d{7}$/.test(quote['orderNumber']))
    || !instant(quote['quotedAt']) || !instant(quote['validUntil']) || !revisionPins(quote['revisions'])
    || !snapshot(quote['facts'], quote['orderUuid'] as string) || !decision(quote['decision']) || !terms(quote['terms'])
    || !pointContainer(quote['allowance']) || JSON.stringify(quote['allowance']) !== JSON.stringify(quote['terms']['allowanceInputs'])) return false;
  return currentCarComparison(value['comparison']);
}

export function isOfferDeclineReasons(value: unknown): value is OfferDeclineReasons {
  if (!only(value, ['schemaVersion', 'key', 'policyVersion', 'reasons', 'provenance']) || value['schemaVersion'] !== 1
    || value['key'] !== 'offer.declineReasons.v1' || !text(value['policyVersion']) || !Array.isArray(value['reasons'])
    || value['reasons'].length === 0 || value['reasons'].length > 128
    || !textFields(value['provenance'], ['status', 'basis', 'source', 'sourceDate'])) return false;
  return value['reasons'].every((row) => only(row, ['code', 'label', 'attribute'])
    && text(row['code'], 128) && text(row['label'], 128) && text(row['attribute'], 128))
    && new Set(value['reasons'].map((row: RecordValue) => row['code'])).size === value['reasons'].length;
}

function safeAnswer(value: unknown): boolean { return jsonValue(value) && authorityFree(value); }

export function isOfferDecisionInput(value: unknown): value is OfferDecisionInput {
  const keys = ['offerId', 'runId', 'commandId', 'decision', 'reasonCode', 'expectedOfferVersion', 'expectedHoldVersion',
    'expectedQuoteVersion', 'termsDigest', 'declarations', 'expectedReturnMileage'];
  if (!only(value, keys) || !text(value['offerId'], 128) || !text(value['runId'], 128) || !text(value['commandId'], 128)
    || !positive(value['expectedOfferVersion']) || !positive(value['expectedHoldVersion']) || !positive(value['expectedQuoteVersion'])
    || !['accept', 'decline'].includes(String(value['decision']))) return false;
  if (value['decision'] === 'decline') return text(value['reasonCode'], 128)
    && !has(value, 'termsDigest') && !has(value, 'declarations') && !has(value, 'expectedReturnMileage');
  const declarations = value['declarations'];
  return !has(value, 'reasonCode') && text(value['termsDigest'], 128) && object(declarations)
    && Object.keys(declarations).length > 0 && Object.keys(declarations).length <= 16
    && Object.entries(declarations).every(([id, accepted]) => text(id, 128) && accepted === true)
    && (value['expectedReturnMileage'] === undefined || nonnegative(value['expectedReturnMileage']));
}

export function isOfferFollowupConfirmInput(value: unknown): value is OfferFollowupConfirmInput {
  return only(value, ['commandId', 'decisionId', 'expectedBriefVersion', 'questionVersion', 'value'])
    && text(value['commandId'], 128) && text(value['decisionId'], 128) && positive(value['expectedBriefVersion'])
    && text(value['questionVersion'], 128) && has(value, 'value') && safeAnswer(value['value']);
}

function questionControl(value: unknown): boolean {
  if (!object(value)) return false;
  if (value['kind'] === 'options') return only(value, ['kind', 'options']) && Array.isArray(value['options'])
    && value['options'].length > 0 && value['options'].every((option) => only(option, ['value', 'label'])
      && text(option['value'], 256) && text(option['label'], 128))
    && new Set(value['options'].map((option: RecordValue) => option['value'])).size === value['options'].length;
  if (value['kind'] === 'slider') return only(value, ['kind', 'unit', 'minimum', 'maximum']) && value['unit'] === 'percent'
    && nonnegative(value['minimum']) && nonnegative(value['maximum']) && value['minimum'] <= value['maximum'];
  return value['kind'] === 'equipment' && only(value, ['kind', 'maximumItems', 'maximumItemLength'])
    && positive(value['maximumItems']) && value['maximumItems'] <= 100
    && positive(value['maximumItemLength']) && value['maximumItemLength'] <= 256;
}

function savedChange(value: unknown, decisionId?: string): value is OfferSavedChange {
  if (!only(value, ['schemaVersion', 'state', 'decisionId', 'briefVersion', 'policyVersion', 'event', 'change'])
    || value['schemaVersion'] !== 1 || value['state'] !== 'change-saved' || !text(value['decisionId'], 128)
    || decisionId !== undefined && value['decisionId'] !== decisionId || !positive(value['briefVersion']) || !text(value['policyVersion'])) return false;
  const event = value['event']; const change = value['change'];
  return only(event, ['receiptReference', 'eventType', 'briefVersion', 'occurredAt']) && text(event['receiptReference'])
    && event['eventType'] === 'brief-changed' && event['briefVersion'] === value['briefVersion'] && instant(event['occurredAt'])
    && only(change, ['path', 'before', 'after']) && text(change['path']) && jsonValue(change['before']) && jsonValue(change['after']);
}

function scoreBasis(value: unknown): boolean {
  return only(value, ['kind', 'briefVersion', 'policyVersion', 'quotedAt']) && value['kind'] === 'historical-quote'
    && positive(value['briefVersion']) && text(value['policyVersion']) && instant(value['quotedAt']);
}

function followupComparison(value: unknown): boolean {
  if (!only(value, ['schemaVersion', 'currentBriefVersion', 'requirements', 'previous', 'next']) || value['schemaVersion'] !== 1
    || !positive(value['currentBriefVersion']) || !Array.isArray(value['requirements'])) return false;
  const validFacts = (facts: unknown) => object(facts) && Object.entries(facts).every(([key, fact]) => text(key, 128)
    && (only(fact, ['status', 'value', 'unit', 'provenance']) && ['known', 'unknown'].includes(String(fact['status']))
      && safeAnswer(fact['value']) && (fact['unit'] === null || text(fact['unit']))
      && (fact['provenance'] === null || provenance(fact['provenance']))));
  const validRequirement = (row: unknown) => {
    if (!object(row)) return false;
    const preference = row['kind'] === 'preference';
    return only(row, preference ? ['kind', 'key', 'value', 'importance', 'previousFacts', 'nextFacts']
      : ['kind', 'key', 'value', 'operator', 'unit', 'previousFacts', 'nextFacts'])
      && (preference || row['kind'] === 'essential') && text(row['key'], 128) && safeAnswer(row['value'])
      && (preference ? finite(row['importance']) : text(row['operator']) && (row['unit'] === null || text(row['unit'])))
      && validFacts(row['previousFacts']) && validFacts(row['nextFacts']);
  };
  if (!value['requirements'].every(validRequirement)) return false;
  return ['previous', 'next'].every((key) => only(value[key], ['offer', 'scoreBasis']) && object(value[key]['offer'])
    && jsonValue(value[key]['offer']) && scoreBasis(value[key]['scoreBasis']));
}

export function isOfferFollowupValue(value: unknown, expectedDecisionId: string): value is OfferFollowupValue {
  if (!object(value) || value['schemaVersion'] !== 1 || value['decisionId'] !== expectedDecisionId) return false;
  if (value['state'] === 'question') {
    if (!only(value, ['schemaVersion', 'state', 'decisionId', 'briefVersion', 'question']) || !positive(value['briefVersion'])) return false;
    const question = value['question'];
    if (!only(question, ['schemaVersion', 'reasonCode', 'path', 'prompt', 'control', 'currentValue', 'policyVersion', 'questionVersion', 'provenance'])
      || question['schemaVersion'] !== 1 || !text(question['reasonCode'], 128) || !text(question['path'], 256)
      || !text(question['prompt'], 240) || !questionControl(question['control']) || !safeAnswer(question['currentValue'])
      || !text(question['policyVersion']) || !text(question['questionVersion'], 128)
      || !only(question['provenance'], ['key', 'status', 'basis', 'source', 'sourceDate'])
      || question['provenance']['key'] !== 'offer.followupQuestions.v1'
      || !textFields(question['provenance'], ['key', 'status', 'basis', 'source', 'sourceDate'])) return false;
    return true;
  }
  if (value['state'] === 'change-saved') return savedChange(value, expectedDecisionId);
  if (value['state'] === 'waiting') return only(value, ['schemaVersion', 'state', 'decisionId', 'savedChange'])
    && savedChange(value['savedChange'], expectedDecisionId);
  if (value['state'] === 'no-match') {
    const evaluation = value['evaluation'];
    return only(value, ['schemaVersion', 'state', 'decisionId', 'savedChange', 'evaluation'])
      && savedChange(value['savedChange'], expectedDecisionId) && only(evaluation, ['evaluatedAt', 'carsChecked', 'suitable'])
      && instant(evaluation['evaluatedAt']) && nonnegative(evaluation['carsChecked']) && evaluation['suitable'] === 0;
  }
  if (value['state'] === 'ready') return only(value, ['schemaVersion', 'state', 'decisionId', 'savedChange', 'comparison'])
    && savedChange(value['savedChange'], expectedDecisionId) && followupComparison(value['comparison']);
  return false;
}

function currentHint(value: unknown): value is Record<string, OfferJsonValue> {
  return object(value) && jsonValue(value);
}

export function parseOfferFailure(value: unknown, expected: OfferResultIdentity = {}): OfferFailure | null {
  const keys = ['status', 'code', 'reason', 'retryable', 'operationId', 'operationType', 'runId', 'offerId', 'decisionId', 'commandId',
    'reasons', 'expectedVersion', 'currentVersion', 'current', 'currentVersions', 'action', 'resource', 'resourceType', 'contractVersion', 'savedChange'];
  if (!only(value, keys) || typeof value['status'] !== 'string' || !failureStatuses.has(value['status']) || value['status'] === 'ok') return null;
  for (const key of ['code', 'reason', 'operationId', 'operationType', 'runId', 'offerId', 'decisionId', 'commandId', 'action', 'resourceType', 'contractVersion']) {
    if (value[key] !== undefined && !text(value[key])) return null;
  }
  if (value['retryable'] !== undefined && typeof value['retryable'] !== 'boolean'
    || value['expectedVersion'] !== undefined && !positive(value['expectedVersion'])
    || value['currentVersion'] !== undefined && !positive(value['currentVersion'])
    || value['current'] !== undefined && !currentHint(value['current'])
    || value['currentVersions'] !== undefined && !currentHint(value['currentVersions'])) return null;
  if (value['reasons'] !== undefined && (!Array.isArray(value['reasons']) || value['reasons'].length > 128
    || !value['reasons'].every((row) => only(row, ['field', 'reason']) && text(row['field'], 256) && text(row['reason'], 1024)))) return null;
  const resource = value['resource'];
  if (resource !== undefined && !(text(resource) || currentHint(resource))) return null;
  if (value['savedChange'] !== undefined && !savedChange(value['savedChange'], expected.decisionId)) return null;
  for (const key of ['runId', 'offerId', 'decisionId', 'commandId'] as const) {
    if (value[key] !== undefined && expected[key] !== undefined && value[key] !== expected[key]) return null;
  }
  if (value['status'] === 'pending' && !text(value['operationId'])) return null;
  const out: RecordValue = { status: value['status'] };
  for (const key of keys.slice(1)) if (value[key] !== undefined) out[key] = value[key];
  return structuredClone(out) as unknown as OfferFailure;
}

const acceptanceStates = new Set(['accepted']);
const declinedStates = new Set(['declined']);

export function isOfferDecisionReceipt(value: unknown, expected: OfferDecisionInput): value is OfferDecisionReceipt {
  const keys = ['schemaVersion', 'runId', 'offerId', 'commandId', 'requestedDecision', 'decisionId', 'state', 'reason', 'offerState',
    'holdState', 'offerVersion', 'holdVersion', 'quoteVersion', 'quoteId', 'policyVersion', 'expiresAt', 'serverNow', 'clockVersion',
    'availableActions', 'operationId', 'reconciliationRequired', 'selection'];
  if (!only(value, keys) || value['schemaVersion'] !== 1 || value['runId'] !== expected.runId || value['offerId'] !== expected.offerId
    || value['commandId'] !== expected.commandId || value['requestedDecision'] !== expected.decision
    || !text(value['decisionId'], 128) || !['accepted', 'declined'].includes(String(value['state']))
    || value['state'] !== (expected.decision === 'accept' ? 'accepted' : 'declined') || !text(value['reason'])
    || !text(value['offerState']) || !text(value['holdState']) || !positive(value['offerVersion']) || !positive(value['holdVersion'])
    || !positive(value['quoteVersion']) || !text(value['quoteId']) || !text(value['policyVersion'])
    || !instant(value['expiresAt']) || !instant(value['serverNow']) || !text(value['clockVersion'])
    || !Array.isArray(value['availableActions']) || value['availableActions'].length !== 0
    || !(value['operationId'] === null || text(value['operationId'])) || value['reconciliationRequired'] !== false) return false;
  if (expected.decision === 'accept' ? !acceptanceStates.has(String(value['state'])) || value['offerState'] !== 'accepted' || value['holdState'] !== 'allocated'
    : !declinedStates.has(String(value['state'])) || !['rejected', 'declined'].includes(String(value['offerState'])) || value['holdState'] !== 'released') return false;
  return value['selection'] === undefined || value['selection'] === null && expected.decision === 'accept'
    || selection(value['selection']) && expected.decision === 'accept';
}
