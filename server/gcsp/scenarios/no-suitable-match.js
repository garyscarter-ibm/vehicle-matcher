import { confirmScenarioBrief } from './brief-start.js';

// Start loader: every brief in the catalogue inputs (Paula nine seats, Alex default), confirmed through actual services.
// It never ticks or writes outcomes; the presenter's Next release lets allocation find the no-match.
export async function startNoSuitableMatch(services) {
  const briefs = {}; let now;
  for (const { principalId } of services.scenario.inputs.briefs) {
    const start = await confirmScenarioBrief(services, principalId);
    if (!start.ok) return start;
    briefs[principalId] = start.briefVersion; now = start.time.now;
  }
  return { status: 'ok', briefs, now };
}
