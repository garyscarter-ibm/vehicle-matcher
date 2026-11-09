// Grouped result views over complete exact-car decisions. Pure: no imports, no I/O.
// A view never filters, re-scores or reorders decisions; groups only point at them.

const indexes = new WeakMap(); // view.decisions -> Map(memberKey -> decision)

const fn = (value, name) => {
  if (typeof value !== 'function') throw new TypeError(`policy.${name} must be a function`);
  return value;
};

/**
 * @param {object[]} decisions COMPLETE ordered exact-car decisions, already evaluated and gated.
 * @param {object} policy keyOf(decision, index), groupOf(decision), sample, summarise(allMembers).
 * @param {{ source?: { status?: 'complete'|'partial'|'unknown' } }} [options]
 */
export function buildResultView(decisions, policy = {}, { source } = {}) {
  if (!Array.isArray(decisions)) throw new TypeError('decisions must be an array');
  const keyOf = policy.keyOf === undefined ? (d) => d.candidateKey : fn(policy.keyOf, 'keyOf');
  const groupOf = policy.groupOf === undefined ? () => null : fn(policy.groupOf, 'groupOf');
  const summarise = policy.summarise === undefined ? () => ({}) : fn(policy.summarise, 'summarise');
  const sample = policy.sample ?? Infinity;
  if (typeof sample !== 'number' || !(sample >= 1)) throw new TypeError('policy.sample must be a number of at least 1');
  const status = ['complete', 'partial'].includes(source?.status) ? source.status : 'unknown';

  const all = Object.freeze(Array.from(decisions));
  const byKey = new Map();
  const grouped = new Map();
  all.forEach((decision, index) => {
    const key = keyOf(decision, index);
    if (typeof key !== 'string' || key === '') throw new TypeError(`keyOf must return a non-empty string (index ${index})`);
    if (byKey.has(key)) throw new TypeError(`duplicate member key: ${key}`);
    byKey.set(key, decision);
    const groupKey = groupOf(decision);
    const slot = groupKey === null || groupKey === undefined ? `m:${key}` : `g:${groupKey}`;
    if (!grouped.has(slot)) {
      grouped.set(slot, { key: slot.startsWith('m:') ? `member:${key}` : String(groupKey), keys: [], all: [] });
    }
    const group = grouped.get(slot);
    group.keys.push(key);
    group.all.push(decision);
  });
  indexes.set(all, byKey);

  const publicKeys = new Set();
  const groups = [...grouped.values()].map((g) => {
    if (publicKeys.has(g.key)) throw new TypeError(`duplicate group key: ${g.key}`);
    publicKeys.add(g.key);
    const members = g.all.slice(0, sample);
    return Object.freeze({
      key: g.key,
      representativeKey: g.keys[0],
      selectedKey: g.keys[0],
      memberKeys: Object.freeze(g.keys),
      members: Object.freeze(members),
      count: Object.freeze({ total: g.all.length, sampled: members.length, complete: g.all.length === members.length }),
      aggregate: Object.freeze({ scope: 'group-availability', ...summarise(g.all) }),
    });
  });

  return Object.freeze({
    decisions: all, source: Object.freeze({ status }), candidateCount: all.length, groups: Object.freeze(groups),
  });
}

/** One decision from the COMPLETE set (not just displayed samples), or undefined. */
export function findDecision(view, key) {
  const index = indexes.get(view?.decisions);
  if (!index) throw new TypeError('not a result view');
  return index.get(key);
}

/** The group's selected member decision. */
export function selectedDecision(view, groupKey) {
  const group = view.groups.find((g) => g.key === groupKey);
  return group ? findDecision(view, group.selectedKey) : undefined;
}

/** Select a member of one group. An unknown group or foreign member leaves the view unchanged (same object). */
export function selectMember(view, groupKey, memberKey) {
  const at = view.groups.findIndex((g) => g.key === groupKey);
  if (at < 0 || !view.groups[at].memberKeys.includes(memberKey)) return view;
  if (view.groups[at].selectedKey === memberKey) return view;
  const groups = view.groups.map((g, i) => (i === at ? Object.freeze({ ...g, selectedKey: memberKey }) : g));
  return Object.freeze({ ...view, groups: Object.freeze(groups) });
}

/**
 * Availability over the COMPLETE decisions: 'available' if any matches; 'unavailable'
 * only when the source is complete; otherwise 'unknown'. Never inferred from displayed cards.
 */
export function availability(view, predicate) {
  if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
  if (view.decisions.some((decision) => predicate(decision))) return 'available';
  return view.source.status === 'complete' ? 'unavailable' : 'unknown';
}
