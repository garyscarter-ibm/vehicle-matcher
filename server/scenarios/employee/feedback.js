import { createFeedbackState, reduceFeedback, applyConfirmedFeedbackChange, candidateSurvivesFeedback } from '../../../blocks/vehicle-matcher/feedback-actions.js';
import { validateBrief, evaluateEssentials, scorePreferences, chargingGates, confirmedFact } from './index.js';

const clone = (value) => structuredClone(value);
const unavailable = (code) => ({ status: 'unavailable', code, retryable: true });
const localGate = (entry) => !entry.authority && ['essential-met', 'essential-unmet', 'essential-unconfirmed', 'equipment-unconfirmed',
  'charging-ready', 'charging-unavailable', 'charging-unconfirmed', 'fuel-unconfirmed', 'preference-fit', 'preference-unconfirmed', 'preference-fact-unknown'].includes(entry.code);

/** Ephemeral draft only. The caller supplies the COMPLETE authorised decisions,
 * never the capped recommendations. No repository, offer or hold is written.
 */
export function createEmployeeFeedbackDraft(brief, scope) {
  if (scope?.kind !== 'employee-draft') throw TypeError('Use an employee draft scope.');
  return { baseBrief: clone(brief), brief: clone(brief), feedback: createFeedbackState(scope, brief.briefVersion) };
}

export function reduceEmployeeDraft(state, action, { source, config, slider, chargingRequired, chargingDefinition } = {}) {
  if (!['confirm-change', 'exclude-candidate', 'exclude-group', 'undo', 'reset'].includes(action?.type)) return { status: 'invalid', code: 'unsupported-employee-action' };
  const reduced = reduceFeedback(state.feedback, action); if (reduced.status !== 'ok') return reduced;
  if (action.type === 'confirm-change') {
    const changed = applyConfirmedFeedbackChange(state.brief, action, state.feedback.version);
    if (changed.status !== 'ok') return changed;
  }
  if (source?.status !== 'ok' || !Array.isArray(source.value?.decisions) || !config || !slider || typeof chargingRequired !== 'boolean') return unavailable('complete-authorised-input-required');
  if (source.value.versions?.brief !== state.baseBrief.briefVersion) return unavailable('candidate-brief-mismatch');
  try {
    let brief = clone(state.baseBrief);
    for (const change of reduced.state.actions.filter((a) => a.type === 'confirm-change')) {
      const applied = applyConfirmedFeedbackChange(brief, { ...change, expectedVersion: brief.briefVersion });
      if (applied.code === 'unchanged-value') continue;
      if (applied.status !== 'ok') return applied;
      brief = applied.brief;
    }
    brief.briefVersion = reduced.nextVersion;
    const charging = brief.essentials.charging;
    const retainedSourceCharging = charging?.value === state.baseBrief.essentials.charging?.value && typeof charging?.value === 'string'
      && source.value.decisions.every((d) => confirmedFact(d.employeeFacts?.charging, config) && d.employeeFacts.charging.value === charging.value);
    if (charging && (!chargingDefinition || charging.operator !== chargingDefinition.operator || charging.unit !== chargingDefinition.unit
      || !['confirmed', 'needs-confirmation'].includes(charging.state)
      || (charging.value === null ? charging.state !== 'needs-confirmation' : !chargingDefinition.values.includes(charging.value) && !retainedSourceCharging))) return { status: 'invalid', code: 'invalid-charging' };
    const projected = { ...brief, essentials: Object.fromEntries(Object.entries(brief.essentials).filter(([key]) => key !== 'charging')) };
    const errors = validateBrief(projected, config, slider);
    if (errors.length) return { status: 'invalid', code: 'invalid-brief', reasons: errors };
    const decisions = []; const seen = new Set();
    for (const original of source.value.decisions) {
      if (!original.candidateKey || !original.configurationId || seen.has(original.candidateKey)) return unavailable('invalid-authorised-candidates');
      seen.add(original.candidateKey);
      const candidate = clone(original);
      const employeeFacts = clone(candidate.employeeFacts);
      if (charging) employeeFacts.charging = { status: charging.state === 'confirmed' && charging.value !== null ? 'known' : 'unknown', value: charging.value,
        unit: charging.unit, provenance: { sourceRef: charging.source, version: String(brief.briefVersion), observedAt: charging.confirmedAt ?? candidate.evaluatedAt,
          assurance: charging.state === 'confirmed' ? 'synthetic-scenario' : 'unknown' } };
      const gates = [evaluateEssentials(candidate.snapshot, projected, config), chargingGates(candidate.snapshot, employeeFacts, config, chargingRequired)];
      const blockers = candidate.blockers.filter((e) => !localGate(e));
      const unknowns = candidate.unknowns.filter((e) => !localGate(e));
      const reasons = candidate.reasons.filter((e) => !localGate(e));
      for (const gate of gates) { blockers.push(...gate.blockers); unknowns.push(...gate.unknowns); reasons.push(...gate.reasons); }
      const kept = candidateSurvivesFeedback(reduced.state, { candidateId: candidate.candidateKey, groupId: candidate.configurationId });
      if (!kept) blockers.push({ code: 'locally-excluded', scope: clone(state.feedback.scope) });
      const gateStatus = blockers.length ? 'ineligible' : unknowns.length ? 'needs-confirmation' : 'eligible';
      const scored = gateStatus === 'eligible' ? scorePreferences(candidate.snapshot, projected, employeeFacts, config, slider)
        : { score: null, components: [], reasons: [], tradeOffs: [], unknowns: [] };
      decisions.push({ ...candidate, gateStatus, suitable: gateStatus === 'eligible', score: scored.score, components: scored.components,
        blockers, unknowns: [...unknowns, ...scored.unknowns], reasons: [...reasons, ...scored.reasons], tradeOffs: scored.tradeOffs,
        brief: clone(brief), employeeFacts, versions: { ...candidate.versions, brief: reduced.nextVersion } });
    }
    const ranked = decisions.filter((d) => d.suitable).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.orderUuid.localeCompare(b.orderUuid));
    return { status: 'ok', nextVersion: reduced.nextVersion, state: { ...clone(state), brief, feedback: reduced.state },
      outcome: { state: !decisions.length ? 'no-stock' : ranked.length ? 'recommendations'
        : decisions.some((d) => d.gateStatus === 'needs-confirmation') ? 'needs-confirmation' : 'no-match',
      decisions, recommendations: ranked.slice(0, config.displayLimit), eligibleCount: ranked.length } };
  } catch { return unavailable('employee-draft-data-unavailable'); }
}
