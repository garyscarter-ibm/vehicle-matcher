/** Evidence-local observation-only caller; the existing executor owns all transport. */
import { createCollectionSession } from '../../../../../scripts/gcsp/collection-session.mjs';
import { validatePublicBmwInventoryPlan, publicBmwInventoryOperations, validatePublicBmwInventoryObservation } from '../../../../../scripts/gcsp/public-bmw-source.mjs';
import { CollectionError, requireValue } from '../../../../../scripts/gcsp/configuration-key.mjs';
import { inputDigest } from '../../../../../server/gcsp/repository/core.js';

export async function createRangeInventory({ plan: input, statePath, http, mode, now = Date.now } = {}) {
  const plan = validatePublicBmwInventoryPlan(input);
  requireValue(['source-fixture', 'live'].includes(mode) && http?.kind === (mode === 'live' ? 'live' : 'fixture'),
    'source-allocation-required', 'Use explicit inventory transport and a separately pinned live allocation.');
  const session = await createCollectionSession({ identity: { planDigest: inputDigest(plan), sourceVersion: plan.source.version,
    stage: 'range-inventory', version: '1', mode }, operations: publicBmwInventoryOperations(plan), limits: plan.limits,
    statePath, http, now, initialState: { inventoryDiagnostic: null, inventoryObservation: null, accepted: [], rejected: [], duplicates: [] },
    validateState: (state) => {
      requireValue(['accepted', 'rejected', 'duplicates'].every(key => Array.isArray(state[key]) && state[key].length === 0),
        'checkpoint-corrupt', 'Range inventory cannot admit configurations.');
      if (state.inventoryDiagnostic !== null) {
        const d = state.inventoryDiagnostic;
        requireValue(d && Object.keys(d).sort().join(',') === 'count,kind,limit,path,schemaVersion,type'
          && d.schemaVersion === 'bmw-inventory-limit.v1' && typeof d.path === 'string' && /^\/[A-Za-z0-9_./+\-]{0,512}$/.test(d.path)
          && ['rows', 'entries', 'bytes'].includes(d.kind) && Number.isSafeInteger(d.count) && d.count >= 0
          && Number.isSafeInteger(d.limit) && d.limit >= 0 && ['object', 'array', 'string', 'number', 'boolean', 'null'].includes(d.type),
        'checkpoint-corrupt', 'Retain only a bounded contract path, count, limit and type.');
      }
      if (state.inventoryObservation !== null) validatePublicBmwInventoryObservation(plan, state.inventoryObservation, mode);
    } });
  return { session, run: () => session.withCheckpoint(async ({ state, execute, commit }) => {
    if (!state.halted && !state.inventoryObservation) {
      if (state.counts.httpAttempts > 0) { state.halted = 'inventory-interrupted'; await commit('inventory-stop'); }
      else try {
        const page = await execute('page', {}); await execute('settings', { path: page.settingsPath });
        state.inventoryObservation = await execute('discover', {}); await commit('inventory-observed');
      } catch (error) {
        if (!(error instanceof CollectionError)) throw error;
        state.inventoryDiagnostic = error.inventoryDiagnostic ? structuredClone(error.inventoryDiagnostic) : null;
        state.halted = error.code; await commit('inventory-stop');
      }
    }
    return structuredClone({ status: state.inventoryObservation && !state.halted ? 'observed' : 'incomplete',
      reason: state.halted || 'source-range-inventory-observed', qualification: 'range-inventory-only', admission: false,
      accepted: state.accepted, rejected: state.rejected, duplicates: state.duplicates, counts: state.counts, inventoryDiagnostic: state.inventoryDiagnostic, inventory: state.inventoryObservation });
  }, { stage: { id: 'range-inventory', version: '1', inputDigest: inputDigest(plan) } }) };
}
