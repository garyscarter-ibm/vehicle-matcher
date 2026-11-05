// Tiny browser snapshots generated through the real BriefService and activity reader.
import { createMemoryRepository, createMemoryStore, result } from '../../gcsp/repository/index.js';
import { createPolicyService } from '../../gcsp/policy/index.js';
import { createDemoRuntime } from '../../gcsp/clock/index.js';
import { createBriefService } from '../../gcsp/brief/index.js';
import { createActivityService } from '../../gcsp/brief/activity.js';
import { preference, essential } from './employee-recommendation.js';

const checked = (out) => { if (out.status !== 'ok') throw new Error(`Activity fixture: ${out.status}`); return out.value; };
function snapshot(out) {
  const v = checked(out);
  return { status: 'ok', value: Object.fromEntries(['asOf', 'briefVersion', 'permission', 'state', 'lastSuccessfulCheck',
    'searchEvidence', 'sourceStatus', 'offers', 'stateChanges', 'stateChangesEvidence'].map((key) => [key, v[key]])) };
}
export async function createActivityFixtures() {
  const repository = createMemoryRepository({ store: createMemoryStore() }); checked(await repository.open());
  try {
    const policy = createPolicyService();
    const { identity, clock } = checked(await createDemoRuntime({ repository, policy, environmentId: 'activity-body-fixture',
      environmentKind: 'synthetic', policyAsOf: '2026-11-05T00:00:00.000Z', commandId: 'bootstrap',
      sessionNow: () => '2026-11-05T00:00:00.000Z' }));
    const presenter = checked(await identity.createPresenterSession('presenter'));
    const { context } = checked(await identity.switchPrincipal(presenter.context, 'demo-paula', 'paula'));
    const brief = createBriefService({ repository, policy, identity, clock });
    const reader = createActivityService({ repository, identity, clock });
    checked(await brief.saveDraft(context, { commandId: 'draft', expectedBriefVersion: 0, expectedDraftVersion: 0,
      brief: { schemaVersion: 1, preferences: { body: preference('estate') }, essentials: { seats: essential(5) } } }));
    checked(await brief.confirm(context, { commandId: 'confirm', expectedBriefVersion: 0, expectedDraftVersion: 1,
      consent: { search: true, hold: false } }));
    const never = snapshot(await reader.readActivity(context));
    checked(await brief.pause(context, { commandId: 'pause', expectedBriefVersion: 1 }));
    const paused = snapshot(await reader.readActivity(context));
    const unavailable = await createActivityService({ identity, clock, repository: {
      query: async () => result('unavailable', { code: 'synthetic-fixture-outage', reason: 'Activity could not be loaded.', retryable: true }),
    } }).readActivity(context);
    return { source: 'Real BriefService and createActivityService; synthetic demo run; no search-check producer',
      snapshots: { 'never-checked': never, paused, unavailable } };
  } finally { await repository.close(); }
}

if (process.argv.includes('--write-activity-fixtures')) {
  const { writeFile } = await import('node:fs/promises');
  const value = await createActivityFixtures();
  await writeFile(new URL('../../../blocks/gcsp/activity/activity-fixtures.js', import.meta.url),
    `// Generated synthetic snapshots. Regenerate through server/test/helpers/activity-fixtures.js.\nexport const activityFixtures = ${JSON.stringify(value, null, 2)};\n`);
}
