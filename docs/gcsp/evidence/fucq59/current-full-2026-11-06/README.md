# Current F59 full-validation plan

Status: **awaiting parent serial reservation; not executed**. The [frozen plan](plan.json) pins the AEE implementation, all 68 test files, supervisor, test-resource helper, Git helper, package manifests/locks and shared installed pg metadata. The supervisor records the final documentation commit and complete file identity at execution and requires it to remain unchanged.

The command is the previously successful explicit expansion of the authored npm script, with concurrency set before its file glob:

```sh
node --test --test-concurrency=1 'server/test/**/*.test.js'
```

Launch through the exact `supervisorCommand` array in the plan, only after the parent grants the serial reservation. One worker, one chunk, 128 MiB scratch, 1 GiB RAM, 300 seconds and a 1 MiB bounded log. Expected duration 75–120 seconds. The resource helper owns the machine reservation, root manifest, child groups, checkpoint and verified teardown. The supervisor owns only the temporary dependency symlink and refuses a preexisting overlay. No installation, source traffic or descendants.

This is the explicit full authored **offline** integration gate. All 68 files are selected; five native PostgreSQL cases are expected to skip because the child database URL is explicitly unset. Report actual totals and skips after the run; no current full result exists yet. It cannot prove native PostgreSQL, the absent downstream F60 version-2 assembly, new-date source qualification, browser/deep links or 200 real configurations.

External receipts and the concise result stay under `/Users/usget/Claude/vehicle-matcher/.claude/dev-poller-resume-20261106/lead59/full-aee-validation/`; the shared impact map is updated atomically from matching evidence. The current 60/60 scoped result remains valid. Historical full evidence for fdb71c2 is not current AEE validation.
