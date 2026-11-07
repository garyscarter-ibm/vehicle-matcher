/** Four read-only shape observations. This cannot admit technical facts or imagery. */
import { createHash } from 'node:crypto';
import { inputDigest } from '../../server/gcsp/repository/core.js';
import { CollectionError, requireValue } from './configuration-key.mjs';
import { createCollectionSession } from './collection-session.mjs';
import { publicBmwEnrichmentObservationOperations, validatePublicBmwEnrichmentObservationPlan } from './public-bmw-source.mjs';

export async function createEnrichmentObserver({ plan: input, statePath, http, now = Date.now, onPhase } = {}) {
  const plan = validatePublicBmwEnrichmentObservationPlan(input);
  const validateState = (state) => {
    requireValue(['pending', 'observed', 'incomplete'].includes(state.observationStatus)
      && state.observations && Object.keys(state.observations).every((name) => ['technical', 'image-manifest'].includes(name)),
    'checkpoint-corrupt', 'Retain only the two observation artifacts.');
    for (const [name, artifact] of Object.entries(state.observations)) {
      const bytes = JSON.stringify(artifact.document) + '\n'; const doc = artifact.document;
      requireValue(artifact.bytes === Buffer.byteLength(bytes) && artifact.sha256 === createHash('sha256').update(bytes).digest('hex')
        && doc.schemaVersion === 'bmw-enrichment-source-observation.v1' && doc.requestScope.operation === name
        && doc.requestScope.role === 'request-input-only' && inputDigest(doc.requestScope.registration) === inputDigest(plan.registration)
        && doc.observation.sourceVersion === plan.source.version && doc.report.admission === false
        && doc.report.status === 'schema-review-required'
        && (name !== 'technical' || doc.report.meaningsQualified === false && doc.report.unitsQualified === false)
        && (name !== 'image-manifest' || doc.report.assetsDownloaded === 0 && doc.report.urlsRetained === false),
      'checkpoint-corrupt', 'Validate the unqualified retained artifact and its exact request scope.');
    }
    requireValue(state.observationStatus !== 'observed' || Object.keys(state.observations).length === 2,
      'checkpoint-corrupt', 'Both artifacts are required for a completed observation.');
  };
  const session = await createCollectionSession({ identity: { planDigest: inputDigest(plan), stage: 'f60-source-observation', version: '1' },
    operations: publicBmwEnrichmentObservationOperations(plan), limits: plan.limits, statePath, http, now, onPhase,
    initialState: { observationStatus: 'pending', observations: {} }, validateState });
  return { session, run: () => session.withCheckpoint(async ({ state, execute, commit }) => {
    const report = () => structuredClone({ status: state.observationStatus, reason: state.halted,
      admission: false, assetsDownloaded: 0, observations: state.observations, counts: state.counts });
    if (state.observationStatus !== 'pending' || state.halted) return report();
    // Bootstrap credentials are deliberately absent from disk. Never obtain them a second time.
    if (state.counts.httpAttempts > 0) {
      state.halted = 'observation-interrupted'; state.observationStatus = 'incomplete'; await commit('observation-stop'); return report();
    }
    try {
      const page = await execute('page', {}); await execute('settings', { path: page.settingsPath });
      for (const name of ['technical', 'image-manifest']) {
        state.observations[name] = await execute(name, {}); await commit('observation-artifact');
      }
      state.observationStatus = 'observed'; await commit('observation-complete');
    } catch (error) {
      if (!(error instanceof CollectionError)) throw error;
      state.halted = error.code; state.observationStatus = 'incomplete'; await commit('observation-stop');
    }
    return report();
  }) };
}
