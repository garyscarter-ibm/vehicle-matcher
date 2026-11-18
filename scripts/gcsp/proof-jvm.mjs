// One JVM limit set for the connected proof scripts' API jar spawns.
// PROOF_API_HEAP (for example 1g) overrides the per-script heap. No metaspace cap: 384m and 1g failed.
const HEAP_PATTERN = /^\d+[mg]$/;

export function apiJvmArgs({ heap = '768m' } = {}) {
  const chosen = process.env.PROOF_API_HEAP ?? heap;
  if (!HEAP_PATTERN.test(chosen)) throw new Error(`PROOF_API_HEAP must look like 768m or 1g, got: ${chosen}`);
  return ['-Xms64m', `-Xmx${chosen}`, '-XX:+UseSerialGC', '-XX:ReservedCodeCacheSize=128m'];
}

export function jvmLimitsReceipt(args) {
  const heap = args.find((arg) => arg.startsWith('-Xmx'));
  return { jvmArgs: [...args], maximumHeap: heap ? heap.slice(4) : null };
}
