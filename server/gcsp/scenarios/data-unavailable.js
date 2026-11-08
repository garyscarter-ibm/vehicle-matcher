import { confirmPaulaBrief, fail } from './brief-start.js';

// Start loader: Paula's confirmed brief through actual services, then the fixture's run-scoped synthetic
// stock fault, set before the next release. It never ticks; the presenter's Next release meets the fault.
export async function startDataUnavailable(services) {
  const start = await confirmPaulaBrief(services);
  if (!start.ok) return start;
  const mode = services.scenario.inputs.syntheticStockFault;
  if (!services.faults?.stock?.set(services.runId, mode)) return fail('stock-fault', 'The synthetic stock fault is not configured.');
  return { status: 'ok', briefVersion: start.briefVersion, now: start.time.now, faults: [services.faults.stock.read(services.runId)] };
}
