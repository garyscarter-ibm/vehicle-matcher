"""Offline retained-evidence and cleanup checks; never requests source traffic."""
import sys
sys.dont_write_bytecode = True
import hashlib, json, pathlib

ROOT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-032')
BASE = pathlib.Path(__file__).resolve().parent
number = int(sys.argv[1])
directory = BASE / ('chunk%02d' % number)
supervisor = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/pilot10x32') / directory.name
read = lambda path: json.loads(path.read_text())
sha = lambda value: hashlib.sha256(value).hexdigest()
digest = lambda value: sha(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode())
lines = lambda path: [json.loads(line) for line in path.read_text().splitlines()]
put = lambda path, value: path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

receipt = read(directory / 'receipt.json')
result = read(supervisor / 'live-result.json')
cleanup = read(supervisor / 'live-cleanup.json')
allocation = read(directory / 'execution-plan.json')
plan = read(directory / 'collection-plan.json')
prior = read(directory / 'prior-canonical-index.json')
spent = read(directory / 'spent-request-index.json')
primary = (directory / 'collector-checkpoint.json').read_bytes()
assert primary == (directory / 'collector-state.json').read_bytes(), 'primary/export mismatch'
envelope = json.loads(primary)
state = envelope['content']
assert digest(state) == envelope['contentDigest']
assert sha(primary) == receipt['checkpointSha256'] == cleanup['checkpointExport']['checkpointSha256']
assert digest(plan) == allocation['planDigest']
assert digest(prior) == allocation['priorIndexDigest']
assert digest(spent) == allocation['spentIndexDigest']
assert (directory / 'execution-once.json').is_file()
assert read(directory / 'execution-once.json')['planDigest'] == allocation['planDigest']
assert not (directory / 'checkpoint-export-failure.json').exists()
assert not list(directory.glob('collector-checkpoint.json.writer-*.json'))
assert all(cleanup[key] is True for key in ['scratch_absent', 'dependency_link_absent', 'groups_absent', 'reservation_absent', 'code_identity_unchanged', 'primaryExists'])
assert cleanup['retainedWriterMetadata'] == [] and cleanup['compatibility_exception'] is None
assert result['rc'] == 0 and result['issue'] is None
assert receipt['reason'] == 'queue-exhausted' and receipt['status'] in ['complete', 'incomplete']
assert receipt['f61Acceptance'] is False and receipt['retries'] == 0
assert state['cursor'] == len(plan['candidates']) == receipt['processedCandidates']
assert lines(directory / 'accepted.jsonl') == state['accepted']
assert len(state['accepted']) == receipt['newlyAccepted']
assert len(state['rejected']) == receipt['rejected']
assert len(state['duplicates']) == receipt['duplicates']
assert len(state['accepted']) + len(state['rejected']) + len(state['duplicates']) == state['cursor']
assert state['counts'] == receipt['counts']
assert all(state['counts'][key] == 0 for key in ['failures', 'timeouts', 'substitutions', 'cacheEvictions'])
assert len(state['sourceCaptures']) == receipt['retainedSolverCaptures']
for capture in state['sourceCaptures']:
    retained = (directory / 'solver' / (capture['candidateId'] + '.json')).read_bytes()
    assert sha(retained) == capture['solver']['sha256'] and len(retained) == capture['solver']['bytes']
    assert json.loads(retained) == capture['solver']['document']
for name, capture in state['batchEvidence'].items():
    retained = (directory / (name + '.json')).read_bytes()
    assert sha(retained) == capture['sha256'] and len(retained) == capture['bytes']
    assert json.loads(retained) == capture['document']
prior_ids = {entry['configurationId'] for entry in prior['entries']}
accepted_ids = [entry['configurationId'] for entry in state['accepted']]
assert len(set(accepted_ids)) == len(accepted_ids) and not (set(accepted_ids) & prior_ids)
assert all(entry['admission'] is True and entry['sourceKind'] == 'dated-snapshot' for entry in state['accepted'])
spent_digests = {entry['requestDigest'] for entry in spent['entries']}
assert len(spent_digests) == len(spent['entries'])
assert all(digest({'modelRegistration': plan['modelRegistration'], 'request': candidate['request']}) not in spent_digests for candidate in plan['candidates'])
events = lines(directory / 'source-events.jsonl')
started = [event for event in events if event['phase'] == 'started']
solver_started = [event for event in started if '/rulesolver/' in event['url']]
assert len(started) == receipt['actualAttempts'] == state['counts']['httpAttempts']
assert len(solver_started) == state['counts']['operations']['solve'] == len(plan['candidates'])
assert all(event.get('status') == 200 for event in events if event['phase'] == 'headers-received')
assert not any(event['phase'] == 'transport-refused' for event in events)
assert all(sha((ROOT / path).read_bytes()) == expected for path, expected in allocation['codePins'].items())

total = receipt['priorAdmittedSourceConfigurations'] + receipt['newlyAccepted']
target_result = ('The finite chunk target was met.' if receipt['status'] == 'complete' else f"Target {len(plan['candidates'])} was unmet; this chunk remains incomplete with `queue-exhausted`.")
checks = ['retained primary/export equality and checkpoint digest', 'all retained source artifact hashes, bytes and document equality', 'accepted/rejected/duplicate/cursor reconciliation', 'canonical uniqueness and prior-ID exclusion', 'exact plan/prior/spent/code pins and spent-request exclusion', 'source attempt and solver accounting', 'supervisor process/link/scratch/reservation absence']
put(directory / 'resource-receipt.json', {'scope': 'scoped actual source chunk plus postcleanup retained artifact integrity', 'selectedChecks': checks, 'excluded': 'No rerun of unchanged capability tests, full suite, UI/runtime or full F61 acceptance', 'verification': {'passed': True, 'sourceCaptures': len(state['sourceCaptures']), 'cumulativeAdmitted': total, 'spentSolverRequestsBefore': len(spent['entries']), 'spentSolverRequestsAfter': len(spent['entries']) + len(solver_started)}, 'supervisorResult': result, 'cleanup': cleanup})
(directory / 'README.md').write_text(f'''# Actual pilot chunk {number:02d} — 7 November 2026

Retained {receipt['newlyAccepted']} new distinct source-qualified admitted configurations in {receipt['elapsedMs']/1000:.3f} seconds using {receipt['actualAttempts']} serial actual GETs and {state['counts']['decodedBytes']:,} decoded bytes. {receipt['rejected']} requests were source-not-constructible; {receipt['duplicates']} were duplicates. No HTTP failure, timeout, substitution or retry occurred. Cumulative durable source capacity is {total}. {target_result} No full10k, five-WMI, profile or F61 Done/runtime acceptance is inferred.

The atomic primary `collector-checkpoint.json` lived in this retained directory from its first write and equals exported `collector-state.json`. Fresh tree/options and all {len(state['sourceCaptures'])} solver captures remain retrievable. Offline checks passed for primary and artifact digests/bytes, counts, canonical uniqueness/prior-ID exclusion, immutable plan/code pins, spent-request exclusion and exact source accounting. The prior canonical and cumulative spent indexes preserve their evidence labels.

The proved finalizer exported before scratch cleanup. Child RSS peaked at {result['peak_rss']:,} bytes; owned scratch allocation was {result['peak_scratch']:,} bytes. Scratch directory, process groups, dependency link and reservation are absent; no writer metadata or compatibility exception remains. `resource-receipt.json` retains the scoped check and cleanup evidence.
''')
print(json.dumps({'chunk': number, 'accepted': len(state['accepted']), 'rejected': len(state['rejected']), 'duplicates': len(state['duplicates']), 'cumulativeAdmitted': total, 'spentSolverRequests': len(spent['entries']) + len(solver_started), 'seconds': receipt['elapsedMs']/1000, 'peakRss': result['peak_rss'], 'checkpointSha256': sha(primary), 'cleanup': 'verified'}))
