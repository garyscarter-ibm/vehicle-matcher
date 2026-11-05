"""Bounded offline FUCQ-103 proofs. One reserved child group and no dependency installation."""
from pathlib import Path
import atexit
import hashlib
import json
import os
import shlex
import signal
import subprocess
import sys
import time
import uuid

project = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(project / '_tools'))
import test_resources as resources

shared = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs')
run = 'fucq103-backend-' + uuid.uuid4().hex
mode = sys.argv[1] if len(sys.argv) > 1 else 'publish'
checks = {
    'activation': ['server/test/gcsp-policy-activation.test.js'],
    'activation-http': ['server/test/gcsp-greg-publish-http.test.js'],
    'identity-clock': ['server/test/gcsp-identity.test.js', 'server/test/gcsp-clock-reset.test.js', 'server/test/gcsp-presenter-controls.test.js'],
    'employee-boundaries': ['server/test/employee-recommendation-api.test.js', 'server/test/gcsp-brief-editor.test.js'],
    'publish': ['server/test/gcsp-greg-publish.test.js'],
    'scoring': ['server/test/employee-recommendation.test.js', 'server/test/feedback-actions.test.js', 'server/test/employee-recommendation-api.test.js', 'server/test/shared-kit-contracts.test.js'],
    'policy-demand': ['server/test/gcsp-policy-service.test.js', 'server/test/gcsp-policy-versions.test.js', 'server/test/gcsp-greg-demand.test.js'],
}
if mode not in checks:
    raise SystemExit('Unknown scoped check')
command = ['node', '--test', '--test-concurrency=1', *checks[mode]]
policy = resources.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120, 'log_mib': 2})
host = resources.HostBudget(policy)

class OwnedScratch(resources.Scratch):
    def __exit__(self, kind, value, traceback):
        stop_owned()
        return super().__exit__(kind, value, traceback)

scratch = OwnedScratch(shared, project, policy, expected=128 * resources.MIB)
scratch.manifest = shared / 'ownership' / (run + '-manifest.json')
summary_path = shared / 'ownership' / (run + '-summary.json')
tracked = {}
reserved = False
finished = False
adopted_links = []
report = {'run': run, 'project': str(project), 'command': command, 'scope': 'scoped',
          'impact': 'Greg projection/preview/publish and PolicyService snapshot; employee scoring and feedback callers. Run/context activation and ordinary HTTP employee consumption; no native/database/UI proof.',
          'limits': {'seconds': 120, 'rssMiB': 768, 'scratchMiB': 128, 'logMiB': 2, 'workers': 1},
          'selection': 'Affected selector dry-run has no plug-in for unspecified JavaScript and proposes npm test. Reviewed and rejected broad fallback; explicit regression/caller commands selected.',
          'excluded': 'Full suite, PostgreSQL, browser and external integration; parent owns integration checkpoint.',
          'supervisor': str(Path(__file__).resolve()), 'manifest': str(scratch.manifest)}
source_paths = ['server/index.js', 'server/gcsp/policy/activation.js', 'server/test/helpers/greg-publish-run.js', 'server/test/helpers/employee-recommendation-http.js', 'server/gcsp/policy/index.js', 'server/gcsp/policy/publish.js', 'server/scenarios/employee/index.js', *checks[mode],
                *[str(p.relative_to(project)) for p in (project / 'server/gcsp/greg/publish').glob('*.js')]]
source_paths.extend([str(Path(__file__).relative_to(project)), '_tools/test_resources.py', 'server/gcsp/greg/index.js', 'server/gcsp/policy/seed-v1.json',
                     'server/test/helpers/greg-demand-run.js', 'server/test/helpers/employee-recommendation.js'])
for directory in ('server/gcsp/repository', 'server/gcsp/identity', 'server/gcsp/clock', 'server/gcsp/recommendation', 'server/scenarios/employee'):
    source_paths.extend(str(path.relative_to(project)) for path in (project / directory).glob('*.js'))
source_paths = sorted(set(source_paths))
report['pins'] = {name: hashlib.sha256((project / name).read_bytes()).hexdigest() for name in source_paths}
scratch.record.update(supervisorFinalizer=__file__, command=command, impact=report['impact'], retainedDependencies=[])

def stop_owned():
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for pid, identity in tracked.items():
            if identity and resources.process_identity(pid) == identity:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        if sig == signal.SIGTERM:
            time.sleep(0.1)
    for group in scratch.record['groups']:
        for sig in (signal.SIGTERM, signal.SIGKILL):
            if resources.group_has_live_members(group) is False:
                break
            try:
                os.killpg(group, sig)
            except ProcessLookupError:
                break
            deadline = time.monotonic() + 3
            while resources.group_has_live_members(group) is not False and time.monotonic() < deadline:
                time.sleep(0.05)

def finalizer():
    global finished
    if finished:
        return
    stop_owned()
    if reserved:
        host.release(scratch.token)
    report.update(scratchAbsent=not os.path.lexists(scratch.root),
                  groupsAbsent=all(resources.group_has_live_members(group) is False for group in scratch.record['groups']),
                  descendantsAbsent=all(not identity or resources.process_identity(pid) != identity for pid, identity in tracked.items()),
                  budgetReleased=scratch.token not in resources.read_json(Path.home() / '.cache/agent-scaffolding/test-resources/reservations.json', {}))
    report['ownedDescendants'] = tracked
    report['ownedPortsClosed'] = report['descendantsAbsent'] and report['groupsAbsent']
    report['sourcesUnchanged'] = all(hashlib.sha256((project / name).read_bytes()).hexdigest() == digest for name, digest in report['pins'].items())
    report['adoptedDependencies'] = []
    for link, target in adopted_links:
        removed = link.is_symlink() and link.resolve() == target.resolve()
        if removed:
            link.unlink()
        report['adoptedDependencies'].append({'link': str(link), 'target': str(target), 'linkAbsent': not os.path.lexists(link), 'existingTargetPreserved': target.is_dir()})
    report['finishedAt'] = time.time()
    scratch.record.update({key: report[key] for key in ('scratchAbsent', 'groupsAbsent', 'descendantsAbsent', 'budgetReleased')})
    resources.atomic_json(scratch.manifest, scratch.record)
    resources.atomic_json(summary_path, report)
    finished = True
    print(json.dumps({'summary': str(summary_path), 'manifest': str(scratch.manifest), 'result': report.get('result'),
                      'cleanup': {key: report[key] for key in ('scratchAbsent', 'groupsAbsent', 'descendantsAbsent', 'budgetReleased', 'sourcesUnchanged')}}))

# Registered before either reservation or owned scratch allocation.
atexit.register(finalizer)
resources.atomic_json(scratch.manifest, scratch.record)

def observed_rss(pgid):
    snapshot = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,args='], capture_output=True, text=True, timeout=3)
    if snapshot.returncode:
        raise resources.ResourceError('Cannot verify child ownership')
    rows = [line.strip().split(None, 4) for line in snapshot.stdout.splitlines()]
    rows = [row for row in rows if len(row) == 5]
    owned = {pgid} | {int(row[0]) for row in rows if int(row[2]) == pgid}
    while True:
        expanded = owned | {int(row[0]) for row in rows if int(row[1]) in owned}
        if expanded == owned:
            break
        owned = expanded
    rss = 0
    for pid, ppid, group, memory, argv in rows:
        if int(pid) not in owned:
            continue
        tracked.setdefault(int(pid), resources.process_identity(int(pid)))
        rss += int(memory) * 1024
        if int(group) != pgid:
            if int(group) == os.getpgrp():
                raise resources.ResourceError('Child escaped to supervisor process group')
            if int(group) not in scratch.record['groups']:
                scratch.record['groups'].append(int(group))
                resources.atomic_json(scratch.manifest, scratch.record)
        args = shlex.split(argv)
        if args and Path(args[0]).name == 'node' and '--test' in args and '--test-concurrency=1' not in args:
            raise resources.ResourceError('Unbounded Node worker count')
    lsof = Path('/usr/sbin/lsof')
    if lsof.exists():
        ports = subprocess.run([str(lsof), '-nP', '-a', '-p', ','.join(str(pid) for pid in sorted(owned)),
                                '-iTCP', '-sTCP:LISTEN', '-Fpn'], capture_output=True, text=True, timeout=3)
        if ports.returncode not in (0, 1):
            raise resources.ResourceError('Cannot inspect owned listening ports')
        if ports.stdout:
            report.setdefault('ownedPortSamples', [])
            sample = ports.stdout[:2048]
            if sample not in report['ownedPortSamples'] and len(report['ownedPortSamples']) < 32:
                report['ownedPortSamples'].append(sample)
    return rss

resources.group_rss = observed_rss
env = {key: value for key, value in os.environ.items() if key not in ('GCSP_DATABASE_URL', 'DATABASE_URL', 'POSTGRES_URL', 'POSTGRESQL_URL', 'PGDATABASE', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD')}
env.update(PYTHONDONTWRITEBYTECODE='1', SCAFFOLDING_HARNESS='codex')
with resources.handled_termination():
    try:
        for relative in ('node_modules', 'server/node_modules'):
            link = project / relative
            target = shared.parent.parent / relative
            if not os.path.lexists(link) and target.is_dir():
                adopted_links.append((link, target))
                scratch.record['adoptedLinks'] = [{'link': str(a), 'target': str(b)} for a, b in adopted_links]
                resources.atomic_json(scratch.manifest, scratch.record)
                link.symlink_to(target, target_is_directory=True)
        report['node'] = subprocess.check_output(['node', '--version'], text=True, timeout=5).strip()
        host.acquire(scratch.token, 128 * resources.MIB, 768 * resources.MIB, project, root=scratch.root)
        reserved = True
        with scratch:
            env.update(XDG_CACHE_HOME=str(scratch.root / 'cache'), npm_config_cache=str(scratch.root / 'npm-cache'))
            log = scratch.root / 'test.log'
            report['result'] = resources.run_process(command, project, env, log, scratch, policy,
                                                   128 * resources.MIB, 768 * resources.MIB, 120, host)
            transcript = log.read_text(errors='replace')
            report['summary'] = transcript[-12000:] if report['result']['rc'] or report['result']['issue'] else '\n'.join(
                line for line in transcript.splitlines() if line.startswith(('# tests', '# pass', '# fail', '# skipped', '# duration', 'ℹ tests', 'ℹ pass', 'ℹ fail', 'ℹ skipped', 'ℹ duration')))
            report['removedBytes'] = resources.allocated_bytes(scratch.root)
            impact_key = resources.digest(report['pins'])
            resources.atomic_json(shared / 'impact' / (impact_key + '.json'), {'pins': report['pins'], 'command': command,
                'summary': str(summary_path), 'impact': report['impact'], 'scope': 'scoped', 'coverage': 'Reviewed import/caller boundaries; no measured per-test coverage.'})
    finally:
        finalizer()

if report.get('result', {}).get('rc') or report.get('result', {}).get('issue'):
    print(report.get('summary', ''))
    raise SystemExit(1)
if (not all(report[key] for key in ('scratchAbsent', 'groupsAbsent', 'descendantsAbsent', 'budgetReleased', 'sourcesUnchanged'))
    or not all(item['linkAbsent'] and item['existingTargetPreserved'] for item in report['adoptedDependencies'])):
    raise SystemExit(2)
