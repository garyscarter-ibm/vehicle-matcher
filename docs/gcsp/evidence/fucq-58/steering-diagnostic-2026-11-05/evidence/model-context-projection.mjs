// A diagnostic projection, not a profile or constructibility validator.
const fields = new Map([
  ['modelcode', 'modelCode'], ['agmodelcode', 'agModelCode'],
  ['modelrange', 'modelRange'], ['rawmodelrange', 'rawModelRange'],
  ['steering', 'steering'], ['country', 'country'], ['countrycode', 'countryCode'],
  ['market', 'market'], ['locale', 'locale'], ['language', 'language'],
  ['orderdate', 'orderDate'], ['effectdate', 'effectDate'],
  ['cataloguedate', 'catalogueDate'], ['taxdate', 'taxDate'], ['proddate', 'prodDate'],
]);

function validFact(field, value) {
  if (typeof value !== 'string') return false;
  if (field === 'prodDate') return /^\d{8}$/.test(value);
  if (/Date$/.test(field)) return /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (field === 'locale') return /^[a-z]{2}[-_][A-Z]{2}$/.test(value);
  if (['country', 'countryCode', 'market', 'language'].includes(field)) return /^[A-Za-z]{2,3}$/.test(value);
  return /^[A-Z0-9]{2,8}$/.test(value);
}

export function projectModelContext(tree, target, limits = {}) {
  const { maxFacts = 1024, maxNodes = 30000, maxDepth = 24, maxPairs = 256 } = limits;
  if (!tree || typeof tree !== 'object' || !/^[A-Z0-9]{2,8}$/.test(target?.modelCode || '') || !/^[A-Z0-9]{2,8}$/.test(target?.agModelCode || '')) throw Error('projection-input');
  for (const limit of [maxFacts, maxNodes, maxDepth, maxPairs]) if (!Number.isInteger(limit) || limit < 0) throw Error('projection-limit-input');
  const result = { version: 'fleet-model-context-projection.v1', target: { modelCode: target.modelCode, agModelCode: target.agModelCode }, nodes: [], matches: { model: [], ag: [] }, relations: [], sameObjectObservations: [], omittedPathSegments: 0, visitedNodes: 0, retainedFacts: 0 };
  const stack = [{ value: tree, path: [], sourceKey: null }];
  const safeSegment = key => {
    if (/^[A-Za-z0-9_.-]{1,48}$/.test(key) && !/[A-HJ-NPR-Z0-9]{17}/.test(key)) return key;
    return '[omitted-' + (++result.omittedPathSegments) + ']';
  };
  while (stack.length) {
    const { value, path, sourceKey } = stack.pop();
    if (++result.visitedNodes > maxNodes) throw Error('projection-node-limit');
    if (path.length > maxDepth) throw Error('projection-depth-limit');
    const facts = {};
    const localMatches = { model: [], ag: [] };
    if (sourceKey === target.modelCode) localMatches.model.push({ path, via: 'key' });
    if (sourceKey === target.agModelCode) localMatches.ag.push({ path, via: 'key' });
    for (const [key, entry] of Object.entries(value)) {
      const field = fields.get(key.toLowerCase());
      if (field && validFact(field, entry)) {
        if (Object.hasOwn(facts, field) && facts[field] !== entry) throw Error('projection-ambiguous-field');
        facts[field] = entry;
      }
      if ((field === 'modelCode' || key === 'code') && entry === target.modelCode) localMatches.model.push({ path, via: 'field', field: safeSegment(key) });
      if ((field === 'agModelCode' || key === 'code') && entry === target.agModelCode) localMatches.ag.push({ path, via: 'field', field: safeSegment(key) });
    }
    const sortedFacts = Object.fromEntries(Object.entries(facts).sort(([a], [b]) => a.localeCompare(b)));
    if ((localMatches.model.length && facts.modelCode && facts.modelCode !== target.modelCode) || (localMatches.ag.length && facts.agModelCode && facts.agModelCode !== target.agModelCode)) throw Error('projection-conflicting-identity');
    result.retainedFacts += Object.keys(facts).length;
    if (result.retainedFacts > maxFacts) throw Error('projection-fact-limit');
    if (Object.keys(facts).length || localMatches.model.length || localMatches.ag.length) result.nodes.push({ path, parentPath: path.length ? path.slice(0, -1) : null, facts: sortedFacts });
    result.matches.model.push(...localMatches.model);
    result.matches.ag.push(...localMatches.ag);
    if (localMatches.model.length && localMatches.ag.length) {
      const context = Object.fromEntries(Object.entries(sortedFacts).filter(([key]) => !['modelCode', 'agModelCode'].includes(key)));
      result.sameObjectObservations.push({ path, modelCode: target.modelCode, agModelCode: target.agModelCode, modelMatchVia: localMatches.model.map(item => item.via), agMatchVia: localMatches.ag.map(item => item.via), context });
    }
    const entries = Object.entries(value);
    for (let i = entries.length - 1; i >= 0; i--) {
      const [key, entry] = entries[i];
      if (entry && typeof entry === 'object') stack.push({ value: entry, path: [...path, safeSegment(key)], sourceKey: key });
    }
  }
  for (const model of result.matches.model) for (const ag of result.matches.ag) {
    if (result.relations.length >= maxPairs) throw Error('projection-pair-limit');
    let length = 0;
    while (length < model.path.length && length < ag.path.length && model.path[length] === ag.path[length]) length++;
    const relation = length === model.path.length && length === ag.path.length ? 'same-object' : length === ag.path.length ? 'ag-ancestor-of-model' : length === model.path.length ? 'model-ancestor-of-ag' : 'common-container-only';
    result.relations.push({ modelPath: model.path, agPath: ag.path, commonAncestor: model.path.slice(0, length), relation });
  }
  return result;
}
