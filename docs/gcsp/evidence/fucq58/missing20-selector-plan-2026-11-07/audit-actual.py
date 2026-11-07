"""Read-only audit of the consumed selector allocation; never invokes its runner."""
import sys
sys.dont_write_bytecode = True
import datetime, hashlib, importlib.util, json, os, pathlib

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(pathlib.Path(p).read_text())
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
plan = read(BASE / 'execution-plan.json')
out, control = pathlib.Path(plan['outputRoot']), pathlib.Path(plan['controlRoot'])
checks = []
def check(name, condition):
    checks.append({'name': name, 'pass': bool(condition)})
    assert condition, name

plan_sha = sha(BASE / 'execution-plan.json')
release = read(BASE / 'parent-release.json')
once = read(out / 'execution-once.json')
receipt, result, cleanup = [read(out / name) for name in ['receipt.json', 'result.json', 'cleanup.json']]
events = [json.loads(line) for line in (out / 'source-events.jsonl').read_text().splitlines()]
ownership = read(cleanup['ownershipManifest'])
durable = read(control / 'durable-output-ownership.json')
spec = importlib.util.spec_from_file_location('resources', ROOT / '_tools/test_resources.py')
resources = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resources)
host = resources.HostBudget(resources.Policy({}))
check('exact-frozen-plan', plan_sha == '32356455215c150123ca624caec42c1eed437c7fe5434c0dcbad380739a2ace3')
check('exact-parent-release', release['status'] == 'released-once' and release['allocationId'] == plan['id'] and release['planSha256'] == plan_sha and release['sourceRequestCeiling'] == 1 and release['solverRequestCeiling'] == 0)
check('consumed-once-marker', once['allocationId'] == plan['id'] and once['state'] == 'consumed' and once['planSha256'] == plan_sha)
for path, digest in {**plan['codePins'], **plan['inputPins']}.items():
    check('unchanged-pin:' + path, sha(ROOT / path) == digest)
check('unchanged-node-runtime', sha(plan['runtime']['path']) == plan['runtime']['sha256'])
check('one-start-one-stop-no-headers', len(events) == 2 and [e['phase'] for e in events] == ['started', 'stopped'] and all(e['attempt'] == 1 and e['method'] == 'GET' for e in events) and events[-1]['reason'] == 'selector-request-timeout')
check('actual-receipt-no-credit', receipt['allocationId'] == plan['id'] and receipt['method'] == 'GET' and receipt['url'] == plan['request']['url'] and receipt['sourceRequests'] == 1 and receipt['solverRequests'] == receipt['newAdmissions'] == receipt['capacityCredit'] == 0 and receipt['acceptance'] is False and receipt['status'] == 'stopped' and receipt['reason'] == 'selector-request-timeout')
check('actual-child-failed-within-bound', result['rc'] == 1 and result['issue'] is None and 10 <= result['wall'] < plan['limits']['childSeconds'] and result['peak_rss'] < plan['limits']['RAMBytes'] and result['peak_scratch'] == 0)
check('control-result-and-cleanup-match', result == read(control / 'result.json') and cleanup == read(control / 'cleanup.json'))
check('ownership-removed', ownership['state'] == 'removed' and ownership['root'] == cleanup['scratchRoot'] and ownership['token'] == cleanup['reservationToken'] and ownership['groups'] == cleanup['groups'])
check('durable-ownership-matches', durable['root'] == str(out) and durable['allocationId'] == plan['id'] and durable['reservationToken'] == ownership['token'] and read(out / 'output-ownership.json')['ownerManifest'] == str(control / 'durable-output-ownership.json'))
check('scratch-independently-absent', not os.path.lexists(cleanup['scratchRoot']))
check('groups-independently-absent', all(resources.group_has_live_members(g) is False for g in cleanup['groups']))
check('reservation-independently-absent', cleanup['reservationToken'] not in (resources.read_json(host.path, {}) or {}))
check('dependency-link-independently-absent', not os.path.lexists(ROOT / 'server/node_modules'))
check('cleanup-no-leftovers-or-exception', all(cleanup[k] is True for k in ['scratchAbsent', 'groupsAbsent', 'reservationAbsent', 'identityUnchanged']) and cleanup['dependencyPathTouched'] is False and cleanup['compatibilityException'] is None and cleanup['leftovers'] == [] and cleanup['removedAllocationBytes'] == 0)
files = {p.name: {'bytes': p.stat().st_size, 'sha256': sha(p)} for p in sorted(out.iterdir()) if p.is_file()}
check('exact-retained-file-set', set(files) == {'cleanup.json', 'execution-once.json', 'output-ownership.json', 'receipt.json', 'result.json', 'source-events.jsonl'})
print(json.dumps({'schemaVersion': 'missing20-selector-actual-audit.v1', 'auditedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'scope': 'read-only metadata, frozen hashes, source events and independent current cleanup checks; no source or test replay', 'auditorSha256': sha(__file__), 'planSha256': plan_sha, 'parentReleaseSha256': sha(BASE / 'parent-release.json'), 'allocationId': plan['id'], 'status': 'failed-source-observation-audited', 'checks': checks, 'passed': len(checks), 'failed': 0, 'sourceRequests': 1, 'solverRequests': 0, 'headersReceived': 0, 'literalLeads': 0, 'newAdmissions': 0, 'capacityCredit': 0, 'acceptance': False, 'noReplay': True, 'receipt': receipt, 'processResult': result, 'sourceEvents': events, 'sourceFiles': files, 'actualRetainedFileBytes': sum(f['bytes'] for f in files.values()), 'cleanupReportedRetainedBytes': cleanup['retainedLogicalBytes'], 'cleanupReportedRetainedBytesNote': 'Supervisor measured before writing final result/cleanup files; actualRetainedFileBytes sums the final six retained files.', 'cleanup': cleanup, 'leftovers': []}, indent=2))
