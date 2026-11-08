// The latest tick's release-pull outcome (FUCQ-130), so a failed or stale pull reads as unavailable, never as zero.
export async function readStockSourceStatus(repository, context) {
  try {
    const run = await repository.read(context, { table: 'runs', key: { runId: context.runId } });
    if (run.status !== 'ok') return { status: 'evidence-unavailable' };
    const tickId = run.value.versions?.lastTickId; if (!tickId) return { status: 'not-checked' };
    const tick = await repository.read(context, { table: 'tick_runs', key: { runId: context.runId, tickId } });
    if (tick.status !== 'ok' || !Array.isArray(tick.value.handlerOrder) || !Array.isArray(tick.value.outcomes)) return { status: 'evidence-unavailable' };
    const entry = tick.value.handlerOrder.find((row) => row.stage === 'release-pull');
    if (!entry) return { status: 'not-checked' };
    const outcome = tick.value.outcomes.find((row) => row.handlerId === entry.handlerId)?.outcome;
    if (!outcome) return { status: ['pending', 'running'].includes(tick.value.state) ? 'delayed' : 'unavailable' };
    if (outcome.status === 'ok') return { status: 'ok' };
    return { status: 'unavailable', ...(outcome.code === 'stock-source-stale' ? { reason: 'stale' } : {}) };
  } catch { return { status: 'evidence-unavailable' }; }
}
