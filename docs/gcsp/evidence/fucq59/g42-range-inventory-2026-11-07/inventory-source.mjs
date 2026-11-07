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
    statePath, http, now, initialState: { inventoryObservation: null, accepted: [], rejected: [], duplicates: [] },
    validateState: (state) => {
      requireValue(['accepted', 'rejected', 'duplicates'].every(key => Array.isArray(state[key]) && state[key].length === 0),
        'checkpoint-corrupt', 'Range inventory cannot admit configurations.');
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
        state.halted = error.code; await commit('inventory-stop');
      }
    }
    return structuredClone({ status: state.inventoryObservation && !state.halted ? 'observed' : 'incomplete',
      reason: state.halted || 'source-range-inventory-observed', qualification: 'range-inventory-only', admission: false,
      accepted: state.accepted, rejected: state.rejected, duplicates: state.duplicates, counts: state.counts, inventory: state.inventoryObservation });
  }, { stage: { id: 'range-inventory', version: '1', inputDigest: inputDigest(plan) } }) };
}
