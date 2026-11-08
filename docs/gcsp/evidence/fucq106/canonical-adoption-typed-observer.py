"""Outside observer: retain bounded original output and audit one granted supervisor.

It imports no feature code, changes no reviewed harness, and launches no retry.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import time

ROOT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-074')
SHARED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher')
GRANT = 'fucq106-typed-90cb70c-0033'
AUDIT = Path(__file__).resolve().parent
RUN = SHARED / '.claude/test-runs/fucq106' / GRANT
EVIDENCE = ROOT / 'docs/gcsp/evidence/fucq106'
CAP = 2 * 1024 * 1024


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def sha(data):
    return hashlib.sha256(data).hexdigest()


def save(name, value):
    (AUDIT / name).write_text(json.dumps(value, indent=2) + '\n')


G = module('fucq106_once_git', ROOT / '_tools/scaffold_git.py')
R = module('fucq106_once_resources', ROOT / '_tools/test_resources.py')
selected = json.loads((EVIDENCE / 'canonical-adoption-source-plan.json').read_text())
assert sha((EVIDENCE / 'canonical-adoption-source-plan.json').read_bytes()) == 'db0dfa478ddef3594abe5c74c0aaeddeefc61e9bd8fcedee4c0ba832ec178746'
assert G.git(ROOT, ['rev-parse', 'HEAD'])[1].strip() == '90cb70ce951a4c9de934e792b8b7fbee0665d934'
assert not G.status_lines(ROOT)
assert not RUN.exists()
with (AUDIT / 'launch-claim.json').open('x') as file:
    json.dump({'grant': GRANT, 'observerPid': os.getpid(), 'observerStart': R.process_identity(os.getpid()),
               'at': datetime.now(timezone.utc).isoformat(), 'supervisorLaunchesAllowed': 1}, file)


def source_snapshot():
    rows = []
    for entry in selected['modules'] + selected['files']:
        content = G.show(ROOT, entry['source'], entry['path']).encode()
        rows.append({'path': entry['path'], 'source': entry['source'], 'sha256': sha(content),
                     'bytes': len(content), 'matches': sha(content) == entry['sha256'] and len(content) == entry['bytes']})
    for entry in selected['harness']:
        content = (ROOT / entry['path']).read_bytes()
        rows.append({'path': entry['path'], 'source': 'reviewed-worktree', 'sha256': sha(content),
                     'bytes': len(content), 'matches': sha(content) == entry['sha256'] and len(content) == entry['bytes']})
    for entry in selected['approvalEvidence']:
        content = Path(entry['path']).read_bytes()
        rows.append({'path': entry['path'], 'source': 'accepted-receipt', 'sha256': sha(content),
                     'bytes': len(content), 'matches': sha(content) == entry['sha256']})
    return {'at': datetime.now(timezone.utc).isoformat(), 'pins': rows, 'allMatch': all(row['matches'] for row in rows),
            'sourcePlanSha256': sha((EVIDENCE / 'canonical-adoption-source-plan.json').read_bytes())}


start = time.monotonic()
before = source_snapshot()
save('source-before.json', before)
assert before['allMatch']
command = [sys.executable, '-I', '-B', str(EVIDENCE / 'canonical-adoption-supervisor.proposal.py'), GRANT]
save('observer-plan.json', {'grant': GRANT, 'command': command, 'observerSha256': sha(Path(__file__).read_bytes()),
     'selection': 'exact reviewed supervisor once; three consumer cases only', 'outputCapBytes': CAP,
     'scratchCreatedByObserver': False, 'limits': selected['limits'],
     'retention': 'Open and tail the original owned checks.log, retaining its exact bytes even after supervisor cleanup; no source rewrite or feature import.'})
process = None
log_handle = None
original_log = AUDIT / 'original-checks.log'
copied = 0
truncated = False
manifest_path = None
failure = None
launch_at = None


def drain_log():
    global copied, truncated
    if log_handle is None:
        return
    while True:
        chunk = log_handle.read(65536)
        if not chunk:
            break
        room = CAP - copied
        if len(chunk) > room:
            truncated = True
        with original_log.open('ab') as output:
            output.write(chunk[:max(0, room)])
        copied += min(len(chunk), max(0, room))


try:
    with R.handled_termination():
        with (AUDIT / 'supervisor.stdout.log').open('wb') as stdout:
            launch_at = time.monotonic()
            process = subprocess.Popen(command, cwd=ROOT, stdout=stdout, stderr=subprocess.STDOUT, start_new_session=True)
            save('supervisor-identity.json', {'pid': process.pid, 'start': R.process_identity(process.pid),
                 'group': process.pid, 'command': command})
            while True:
                if manifest_path is None:
                    manifests = list((RUN / 'ownership').glob('*.json'))
                    if manifests:
                        assert len(manifests) == 1
                        manifest_path = manifests[0]
                if log_handle is None and manifest_path is not None:
                    record = json.loads(manifest_path.read_text())
                    candidate = Path(record['root']) / 'checks.log'
                    try:
                        log_handle = candidate.open('rb')
                    except FileNotFoundError:
                        pass
                drain_log()
                if process.poll() is not None:
                    break
                if time.monotonic() - launch_at > 300:
                    raise TimeoutError('Supervisor overall watchdog, separate from 120-second child execution budget')
                if (AUDIT / 'supervisor.stdout.log').stat().st_size > CAP:
                    raise RuntimeError('Supervisor retained-output cap exceeded')
                time.sleep(0.003)
            process.wait()
            drain_log()
except BaseException as error:
    failure = type(error).__name__
finally:
    if process is not None and process.poll() is None:
        R.stop_group(process)
    if log_handle is not None:
        drain_log()
        log_handle.close()

after_run_at = time.monotonic()
after = source_snapshot()
save('source-after.json', after)
result_path = RUN / 'result.json'
result = json.loads(result_path.read_text()) if result_path.exists() else {}
plan = json.loads((RUN / 'plan.json').read_text()) if (RUN / 'plan.json').exists() else {}
if manifest_path is None:
    manifests = list((RUN / 'ownership').glob('*.json'))
    manifest_path = manifests[0] if len(manifests) == 1 else None
record = json.loads(manifest_path.read_text()) if manifest_path is not None else {}
log_bytes = original_log.read_bytes() if original_log.exists() else b''
text = log_bytes.decode('utf8', errors='replace')
totals = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|skipped|cancelled|suites) (\d+)\s*$', text, re.M)}
totals_match = all(totals.get(key) == value for key, value in {'tests': 3, 'pass': 3, 'fail': 0, 'skipped': 0, 'cancelled': 0}.items())
save('totals.json', {'totals': totals, 'expected': {'tests': 3, 'pass': 3, 'fail': 0, 'skipped': 0, 'cancelled': 0}, 'pass': totals_match,
                    'originalLogSha256': sha(log_bytes), 'bytes': len(log_bytes), 'fullBoundedOriginalRetained': log_handle is not None and not truncated})
processes = record.get('processes', [])
live = [row for row in processes if row.get('start') is not None and R.process_identity(row['pid']) == row['start']]
group_states = [{'group': group, 'hasLiveMembers': R.group_has_live_members(group)} for group in record.get('groups', [])]
resource_policy = R.Policy({'chunk_seconds': 120, 'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'log_mib': 2})
host = R.HostBudget(resource_policy)
reservations = R.read_json(host.path, {})
dep = selected['dependency']
dep_path = Path(dep['path'])
dependency_matches = sha(dep_path.read_bytes()) == dep['sha256'] and (dep_path.stat().st_dev, dep_path.stat().st_ino) == (dep['device'], dep['inode'])
scratch_absent = bool(record.get('root')) and not os.path.lexists(record['root'])
supervisor_identity = json.loads((AUDIT / 'supervisor-identity.json').read_text()) if (AUDIT / 'supervisor-identity.json').exists() else {}
supervisor_absent = process is not None and process.poll() is not None and R.process_identity(process.pid) != supervisor_identity.get('start')
journal = json.loads((RUN / 'observed-modules.json').read_text()) if (RUN / 'observed-modules.json').exists() else []
expected_modules = {row['path']: row['sha256'] for row in selected['modules']}
expected_modules[selected['test']['canonicalPath']] = selected['test']['sha256']
journal_matches = {row['path'] for row in journal} == set(expected_modules) and all(row['sha256'] == expected_modules.get(row['path']) for row in journal)
journal_unique = len({(row['pid'], row['path']) for row in journal}) == len(journal)
cleanup = {'scratchRoot': record.get('root'), 'scratchAbsent': scratch_absent, 'processIdentities': processes,
           'liveOwnedProcesses': live, 'groups': group_states, 'supervisorAbsentAndReaped': supervisor_absent,
           'reservationReleased': bool(record.get('token')) and record['token'] not in reservations,
           'existingDependencyPreserved': dependency_matches, 'dependencyLinksCreated': 0,
           'openFileAudit': {'status': 'not-established', 'limitation': 'Reviewed supervisor invokes lsof only after scratch deletion and ignores its return status. Its empty output is not a successful independent open-file scan. Recorded processes/groups and scratch absence are independently checked here; observer log descriptor was closed before this audit.'}}
save('independent-resource-audit.json', cleanup)
passed = (failure is None and process is not None and process.returncode == 0 and result.get('rc') == 0 and not result.get('issue')
          and not result.get('failure') and totals_match and copied > 0 and not truncated and journal_matches and journal_unique
          and before['allMatch'] and after['allMatch'] and not live and all(row['hasLiveMembers'] is False for row in group_states)
          and scratch_absent and supervisor_absent and cleanup['reservationReleased'] and dependency_matches)
summary = {'schemaVersion': 1, 'grant': GRANT, 'status': 'PASS' if passed else 'INCOMPLETE', 'supervisorRuns': 1,
           'supervisorExit': None if process is None else process.returncode, 'observerFailure': failure,
           'totals': totals, 'totalsExactlyThreePass': totals_match,
           'sourceBeforeAfterMatch': before['allMatch'] and after['allMatch'], 'moduleJournalMatches43': journal_matches,
           'moduleJournalUniquePerProcess': journal_unique, 'observedCanonicalPaths': len({row['path'] for row in journal}),
           'log': {'path': str(original_log), 'bytes': copied, 'sha256': sha(log_bytes), 'fullOriginalRetained': log_handle is not None and not truncated},
           'timing': {'totalWallIncludingIndependentSourcePreparationAndFinalAuditSeconds': time.monotonic() - start,
                      'supervisorWallIncludingImmutablePreparationSeconds': None if launch_at is None else after_run_at - launch_at,
                      'childExecutionSeconds': result.get('wall')},
           'measuredChild': {'peakRssBytes': result.get('peak_rss'), 'peakScratchBytes': result.get('peak_scratch')},
           'sourcePlanSha256': sha((EVIDENCE / 'canonical-adoption-source-plan.json').read_bytes()),
           'resources': cleanup, 'resultPath': str(result_path), 'manifestPath': str(manifest_path),
           'observerPid': os.getpid(), 'observerStart': R.process_identity(os.getpid()),
           'limit': 'No successful independent open-file scan is claimed. Child 120-second budget excludes immutable preparation. No retry is authorized or launched.'}
save('summary.json', summary)
print(json.dumps({'status': summary['status'], 'totals': totals, 'timing': summary['timing'], 'summary': str(AUDIT / 'summary.json')}))
sys.exit(0 if passed else 1)
