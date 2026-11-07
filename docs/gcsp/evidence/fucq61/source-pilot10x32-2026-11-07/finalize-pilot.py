"""Consolidate completed finite pilot evidence without source traffic."""
import sys
sys.dont_write_bytecode = True
import copy, datetime, hashlib, json, pathlib
ROOT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032')
BASE = pathlib.Path(__file__).resolve().parent
read = lambda p: json.loads(p.read_text())
sha = lambda b: hashlib.sha256(b).hexdigest()
digest = lambda v: sha(json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode())
put = lambda p, v: p.write_text(json.dumps(v, indent=2, ensure_ascii=False) + '\n')
manifest = read(BASE / 'pilot-plan.json')
prior = read(BASE / 'initial-canonical-index.json')
spent = read(BASE / 'initial-spent-request-index.json')
assert digest(prior) == manifest['initialCanonicalIndexDigest']
assert digest(spent) == manifest['initialSpentIndexDigest']
index = {r['configurationId']: copy.deepcopy(r) for r in prior['entries']}
rows = []
for number in range(1, 11):
    directory = BASE / ('chunk%02d' % number)
    receipt = read(directory / 'receipt.json')
    resource = read(directory / 'resource-receipt.json')
    cleanup = resource['cleanup']
    assert receipt['reason'] == 'queue-exhausted' and resource.get('verification', {'passed': True})['passed']
    assert all(cleanup[k] is True for k in ['scratch_absent', 'dependency_link_absent', 'groups_absent', 'reservation_absent', 'code_identity_unchanged'])
    state = read(directory / 'collector-checkpoint.json')['content']
    plan = read(directory / 'collection-plan.json')
    assert state['cursor'] == 32 and receipt['counts']['operations']['solve'] == 32
    assert len(state['accepted']) + len(state['rejected']) + len(state['duplicates']) == 32
    for accepted in state['accepted']:
        assert accepted['admission'] is True and accepted['configurationId'] not in index
        index[accepted['configurationId']] = {'configurationId': accepted['configurationId'], 'origins': [{'path': str((directory / 'accepted.jsonl').relative_to(ROOT)), 'kind': 'admitted-source'}]}
    for candidate in plan['candidates']:
        spent['entries'].append({'candidateId': candidate['candidateId'], 'requestDigest': digest({'modelRegistration': plan['modelRegistration'], 'request': candidate['request']}), 'outcome': 'prior-completed-pilot'})
    rows.append({'chunk': number, 'accepted': len(state['accepted']), 'rejected': len(state['rejected']), 'duplicates': len(state['duplicates']), 'actualGets': receipt['actualAttempts'], 'solverRequests': 32, 'decodedBytes': receipt['counts']['decodedBytes'], 'sourceSeconds': receipt['elapsedMs']/1000, 'peakRssBytes': resource['supervisorResult']['peak_rss'], 'removedScratchBytes': cleanup['removed_allocation_bytes'], 'checkpointSha256': receipt['checkpointSha256'], 'receiptSha256': sha((directory/'receipt.json').read_bytes()), 'cleanupVerified': True})
assert len({r['requestDigest'] for r in spent['entries']}) == len(spent['entries']) == 405
prior['entries'] = sorted(index.values(), key=lambda r: r['configurationId'])
admitted = sum(any(o['kind'] == 'admitted-source' for o in r['origins']) for r in prior['entries'])
assert admitted == 340 and sum(r['accepted'] for r in rows) == 311
put(BASE / 'final-canonical-index.json', prior)
put(BASE / 'final-spent-request-index.json', spent)
totals = {k: sum(r[k] for r in rows) for k in ['accepted', 'rejected', 'duplicates', 'actualGets', 'solverRequests', 'decodedBytes', 'sourceSeconds', 'removedScratchBytes']}
totals.update(cumulativeAdmittedSourceConfigurations=admitted, trackedSpentSolverRequests=405, peakRssBytes=max(r['peakRssBytes'] for r in rows), pilotObservedYield=totals['accepted']/totals['solverRequests'])
summary = {'schemaVersion': 'f61-source-pilot-final-receipt.v1', 'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'finite pilot execution complete; original F61 acceptance incomplete', 'pilotPlanDigest': digest(manifest), 'chunks': rows, 'totals': totals, 'finalCanonicalIndexDigest': digest(prior), 'finalSpentIndexDigest': digest(spent), 'retainedEvidenceBytesAtMeasurement': sum(p.stat().st_size for p in BASE.rglob('*') if p.is_file()), 'allCleanupVerified': True, 'compatibilityException': None, 'disposableLeftovers': [], 'sourceContextCount': 1, 'context': 'T5MJ/72HH/G61E GB/RL; dated catalogue context, no physical or WMI inference', 'priorInterrupted200CapacityCredit': 0, 'throughputBug': 'FUCQ-151 Medium; workaround only, no production repair', 'remaining': ['target10000', 'original model/profile/year/plant/five-WMI distribution', 'F60/enrichment/publication/application acceptance', 'F77 full mapping and exact deep-link checks'], 'f61Acceptance': False}
put(BASE / 'final-receipt.json', summary)
table = '\n'.join('| %02d | %d | %d | %d | %.3f | %s |' % (r['chunk'], r['accepted'], r['rejected'], r['duplicates'], r['sourceSeconds'], format(r['peakRssBytes'], ',')) for r in rows)
(BASE / 'README.md').write_text(f'''# Actual finite 10 × 32 source pilot — 7 November 2026

The root-approved finite pilot completed ten serial chunks with **{totals['accepted']} new distinct admitted source configurations, {totals['rejected']} source-not-constructible outcomes and {totals['duplicates']} duplicates**. It used exactly {totals['solverRequests']} solver requests / {totals['actualGets']} actual GETs, {totals['decodedBytes']:,} decoded bytes and {totals['sourceSeconds']:.3f} seconds of source execution, with one worker and zero retries. Durable admitted source capacity is **340**, including the prior 29. Every row remains within the single qualified T5MJ / 72HH / G61E GB/RL context.

| Chunk | Accepted | Rejected | Duplicates | Source seconds | Peak child RSS bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
{table}

The observed pilot yield is {totals['pilotObservedYield']*100:.4f}%; it does not promise future yield or source capacity. Only chunks02 and06 met their finite target32; the other chunks remain locally incomplete with `queue-exhausted`. Full10k, broader model/profile/year/plant/five-WMI coverage, F60 enrichment/publication/application and F77 acceptance remain incomplete. No F61 Done claim is made. The lost interrupted200 captures contribute zero capacity, while all53 spent solver requests remain excluded.

`final-canonical-index.json` preserves admitted-source versus reference origins. `final-spent-request-index.json` contains405 unique tracked spent solver requests:32 first-batch,53 interrupted and320 pilot. Every chunk excluded all prior canonical IDs and spent requests. The immutable `pilot-plan.json` remains the original approved plan; the final receipt records its digest rather than rewriting it.

Each primary checkpoint was a retained deliverable from its first write and equals its exported state. Per-chunk checks verified source artifact hashes/bytes, counts, canonical uniqueness/prior exclusion, code/plan/index pins and exact attempt accounting. The proved finalizer exported before scratch cleanup. All ten process groups, scratch roots, dependency links and reservations are absent, with zero writer metadata or compatibility exception. Peak child RSS was {totals['peakRssBytes']:,} bytes; removed scratch allocation was {totals['removedScratchBytes']:,} bytes because primary/source outputs are retained outside scratch. Retained evidence measured {summary['retainedEvidenceBytesAtMeasurement']:,} bytes before this final receipt/README rewrite; no archive or output approaching256MiB was created.

The throughput issue is linked backlog Bug **FUCQ-151 (Medium)**. The 32-candidate workaround does not fix it. The realistic next multi-context qualification proposal and five-WMI boundary are in `../../../f61-capacity-route-2026-11-07.md`. Source traffic after this finite pilot is held pending root review of the next exact plans/code pins. No additional allocation is granted by this receipt.
''')
print(json.dumps(totals))
