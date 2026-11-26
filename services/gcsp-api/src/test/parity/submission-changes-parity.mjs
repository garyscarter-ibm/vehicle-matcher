// Offline generator for order-plan-parity/submission-changes.json: the changes Node's submission history reports after a submit
// with deliberately non-canonical draft changes. Never run by the Java tests: node services/gcsp-api/src/test/parity/submission-changes-parity.mjs
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const { fixture, cap, submitOf, TOURING, DERIVATIVES } = await import(join(root, 'server/test/helpers/order-plan-fixture.js'));
const { good } = await import(join(root, 'server/test/helpers/greg-publish-run.js'));
const outPath = join(root, 'services/gcsp-api/src/test/resources/order-plan-parity/submission-changes.json');

const hooks = [];
const f = await fixture({ after: (fn) => hooks.push(fn) });
// Keys and bound rows are in reverse of canonical order, so the stored value shows the canonicalisation.
const input = [{ key: DERIVATIVES, value: cap(await f.active(DERIVATIVES), TOURING, { min: 2 }).reverse() },
  { key: 'orderPlan.budgetMinor', value: 18000000 }];
const preview = good(await f.ops.previewPlan(f.context, { changes: input }));
assert.equal(preview.plan.status, 'feasible');
assert.equal(preview.plan.quantities.find((q) => q.derivativeId === TOURING).quantity, 2);
good(await f.ops.submitPlan(f.context, submitOf(preview.plan, 'parity-submit', { changes: input })));
const [saved] = (await f.repository.query(f.context, 'plan_snapshots')).value.filter((r) => r.provenance?.kind === 'submission');
const expected = good(await f.ops.readPlan(f.context)).replan.changes;
assert.deepEqual(expected, saved.output.changes);
assert.deepEqual(expected.map((c) => c.key), ['orderPlan.budgetMinor', DERIVATIVES]);
await writeFile(outPath, `${JSON.stringify({ input, expected, submittedChanges: saved.output.changes }, null, 2)}\n`);
for (const hook of hooks) await hook();
console.log(`wrote ${outPath}`);
