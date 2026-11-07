import { readFile } from 'node:fs/promises';
import { inputDigest } from '../repository/core.js';

const text = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const only = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const finiteJson = (value) => value === null || typeof value === 'string' || typeof value === 'boolean'
  || typeof value === 'number' && Number.isFinite(value)
  || Array.isArray(value) && value.every(finiteJson)
  || object(value) && Object.values(value).every(finiteJson);
const freeze = (value) => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const validDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

// Reviewed, immutable server artifacts are the only source of new keyed assumptions.
export function validateReviewedDefinitionSet(bundle) {
  try {
    if (!only(bundle, ['schemaVersion', 'definitionSetId', 'revision', 'definitions', 'digest']) || bundle.schemaVersion !== 1
      || !text(bundle.definitionSetId) || !text(bundle.revision) || !Array.isArray(bundle.definitions)
      || bundle.definitions.length === 0 || bundle.definitions.length > 100 || !finiteJson(bundle)) return false;
    const keys = new Set();
    for (const row of bundle.definitions) {
      if (!only(row, ['key', 'value', 'unit', 'basis', 'source', 'sourceDate', 'status'])
        || !['key', 'unit', 'basis', 'source'].every((key) => text(row[key])) || keys.has(row.key)
        || !validDay(row.sourceDate) || !['assumed', 'verified'].includes(row.status)) return false;
      keys.add(row.key);
    }
    const { digest, ...definition } = bundle;
    return typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest) && inputDigest(definition) === digest;
  } catch { return false; }
}

const presenter = JSON.parse(await readFile(new URL('./reviewed/presenter-controls-v1.json', import.meta.url), 'utf8'));
if (!validateReviewedDefinitionSet(presenter)) throw new TypeError('The reviewed presenter assumption definition is invalid.');
const gregEditor = JSON.parse(await readFile(new URL('./reviewed/greg-publish-editor-v1.json', import.meta.url), 'utf8'));
if (!validateReviewedDefinitionSet(gregEditor)) throw new TypeError('The reviewed Greg editor assumption definition is invalid.');
const learning = JSON.parse(await readFile(new URL('../predict/records/policy-definitions.json', import.meta.url), 'utf8'));
if (!validateReviewedDefinitionSet(learning)) throw new TypeError('The reviewed learning assumption definition is invalid.');
const offerDeclineReasons = JSON.parse(await readFile(new URL('./reviewed/offer-decline-reasons-v1.json', import.meta.url), 'utf8'));
if (!validateReviewedDefinitionSet(offerDeclineReasons)) throw new TypeError('The reviewed offer decline assumption definition is invalid.');
const choiceModel = JSON.parse(await readFile(new URL('./reviewed/fucq115-choice-model-v1.json', import.meta.url), 'utf8'));
if (!validateReviewedDefinitionSet(choiceModel)) throw new TypeError('The reviewed choice model assumption definition is invalid.');
const offerFollowupQuestions = JSON.parse(await readFile(new URL('./reviewed/offer-followup-questions-v1.json', import.meta.url), 'utf8'));
if (!validateReviewedDefinitionSet(offerFollowupQuestions)) throw new TypeError('The reviewed offer follow-up question definition is invalid.');
// The demo offer journey adopts both offer sets in one publication; their rows stay in their own files.
const offerJourneyDefinition = { schemaVersion: 1, definitionSetId: 'offer-journey-v1', revision: '1',
  definitions: [...offerDeclineReasons.definitions, ...offerFollowupQuestions.definitions] };
const offerJourney = { ...offerJourneyDefinition, digest: inputDigest(offerJourneyDefinition) };
if (!validateReviewedDefinitionSet(offerJourney)) throw new TypeError('The combined offer journey definition is invalid.');
const registry = freeze({ [presenter.definitionSetId]: presenter, [gregEditor.definitionSetId]: gregEditor,
  [learning.definitionSetId]: learning, [offerDeclineReasons.definitionSetId]: offerDeclineReasons,
  [choiceModel.definitionSetId]: choiceModel, [offerFollowupQuestions.definitionSetId]: offerFollowupQuestions,
  [offerJourney.definitionSetId]: offerJourney });
export const getReviewedDefinitionSet = (definitionSetId) => Object.hasOwn(registry, definitionSetId) ? registry[definitionSetId] : null;
