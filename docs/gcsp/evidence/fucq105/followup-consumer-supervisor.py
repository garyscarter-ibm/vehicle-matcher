"""Authoring proposal. Requires an explicit external root review before one finite memory run."""
from pathlib import Path
import argparse
import atexit
from contextlib import redirect_stdout, redirect_stderr
import hashlib
import importlib.util
import json
import os
import re
import shlex
import selectors
import shutil
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[4]
BASE = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq105')
PLAN = ROOT / 'docs/gcsp/evidence/fucq105/followup-consumer-source-plan.json'
TEST = ROOT / 'server/test/gcsp-offer-view-followup-consumer.test.js'
LOADER = ROOT / 'docs/gcsp/evidence/fucq105/followup-consumer-loader.mjs'

def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(65536), b''):
            value.update(block)
    return value.hexdigest()

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--review', required=True, help='External root-authored one-run grant JSON')
args = parser.parse_args()
started = time.monotonic()
review_path = Path(args.review).resolve()
# Bootstrap reads are finite before the hash-admitted owned helper is loaded.
if review_path.stat().st_size > 16384 or PLAN.stat().st_size > 1048576:
    raise SystemExit('Review/plan byte cap exceeded')
with review_path.open('rb') as source:
    payload = source.read(16385)
    if len(payload) > 16384:
        raise SystemExit('Review byte cap exceeded')
    review = json.loads(payload)
plan_hash = digest(PLAN)
if review.get('approved') is not True or review.get('scope') != 'fucq105-followup-consumer-memory' or review.get('plan_sha256') != plan_hash:
    raise SystemExit('Missing exact external root review; no allocation or product imports performed.')
run_id = review.get('run_id', '')
if not re.fullmatch(r'fucq105-followup-[a-zA-Z0-9-]{1,80}', run_id):
    raise SystemExit('Supply a unique root run identity.')
if review_path.is_relative_to(ROOT) or review_path.is_relative_to(Path('/private/tmp')):
    raise SystemExit('Review must be retained outside worktree and scratch.')
with PLAN.open('rb') as source:
    payload = source.read(1048577)
    if len(payload) > 1048576:
        raise SystemExit('Plan byte cap exceeded')
    plan = json.loads(payload)
for relative, row in plan['harness'].items():
    if digest(ROOT / relative) != row['sha256']:
        raise SystemExit('Frozen helper/test identity changed; review a new plan.')
b = module('consumer_bounds', ROOT / 'docs/gcsp/evidence/fucq105/followup-consumer-bounds.py')
if plan['accounting'] != b.CONTRACT:
    raise SystemExit('Reviewed accounting contract differs from owned helper')
cancel = threading.Event()
lifecycle = module('decision_lifecycle', ROOT / 'docs/gcsp/evidence/fucq105/decision-mixed-lifecycle.py')
# Cover bootstrap helper probes as well as the selected launch/finalizer.
cancellation = lifecycle.deferred_cancellation(cancel)
cancellation.__enter__()
atexit.register(cancellation.__exit__, None, None, None)
monitor = b.Aggregate(cancel, b.CONTRACT['supervisor_seconds']).start()
r = module('decision_resources', ROOT / '_tools/test_resources.py')
g = module('decision_git', ROOT / '_tools/scaffold_git.py')
ledger = module('decision_ledger', ROOT / 'docs/gcsp/evidence/fucq105/decision-mixed-ledger.py')
r.subprocess = b.Captures()
g.subprocess = b.Captures()
policy = r.Policy(plan['limits'])
record_dir = BASE / run_id
run_manifest = BASE / 'ownership' / (run_id + '.json')
consumption = BASE / 'ownership' / (run_id + '-consumed.json')
if any(os.path.lexists(path) for path in (consumption, record_dir, run_manifest, BASE.parent/'impact'/(run_id+'.json'))):
    raise SystemExit('Run identity already used; no retry without a new root run grant.')

class OwnedScratch(r.Scratch):
    def child(self, process):
        ownership.register(process)

    def sample(self):
        monitor.check()
        with monitor.lock:
            rows = {(row['pid'], row['start']): row for row in self.record['processes']}
            rows.update({(row['pid'], row['start']): row for row in monitor.rows})
            if len(rows) > b.CONTRACT['process_identities']:
                raise b.BoundError('Owned identity manifest cap')
            self.record['processes'] = list(rows.values())
        self.record['peak'] = max(self.record['peak'], b.allocation([self.root]))
        used = outputs.observe()['charged_combined_bytes']
        self.record['peak_combined'] = outputs.peak
        r.atomic_json(self.manifest, self.record)
        return used

    def __exit__(self, kind, value, tb):
        # Never delete a root using an empty/partially persisted child list as absence evidence.
        ownership.require_safe()
        # Preserve bounded diagnostic evidence before the owned root is removed, including on an exception.
        log = self.root / 'checks.log'
        if log.exists() and (kind is not None or result and (result['rc'] or result['issue'])):
            retain_failure_log(log)
        for source, target in [('checkpoints.json', 'checkpoints.json'), ('modules.jsonl', 'modules.jsonl')]:
            path = self.root / source
            if path.exists():
                outputs.write(record_dir / target, b.read_bytes(path, b.CONTRACT['journal_bytes']
                    if source == 'modules.jsonl' else b.CONTRACT['checkpoint_bytes']), b.CONTRACT['journal_bytes'])
        return super().__exit__(kind, value, tb)

scratch = OwnedScratch(record_dir, ROOT, policy)
scratch.record.update(story='FUCQ-105', ports=[], profiles=[], dependency_links=[], processes=[])
ownership = lifecycle.LaunchOwnership(r, scratch)
host = ledger.Budget(r, policy, plan['host_budget'], scratch)
monitor.groups = scratch.record['groups']
outputs = b.Outputs(scratch.root, [record_dir, run_manifest, consumption,
    BASE.parent/'impact'/(run_id+'.json')], monitor)
# Adapt only this loaded resource module; ledger/lifecycle source and authority are unchanged.
r.atomic_json = outputs.json

def retain_failure_log(log):
    # Seek a finite tail; never read the complete failure log to slice it afterwards.
    with log.open('rb') as source:
        source.seek(max(0, os.fstat(source.fileno()).st_size - 65536))
        outputs.write(record_dir/'failure.log', source.read(65536), 65536)

# Registered before allocation. This fallback does no query, manifest write or ledger mutation.
atexit.register(ownership.join_direct)
r.atomic_json(run_manifest, {'owner': r.owner(), 'state': 'planned', 'run': run_id, 'review': str(review_path),
                             'root': str(scratch.root), 'scratch_manifest': str(scratch.manifest), 'output': str(record_dir)})
r.atomic_json(record_dir / 'plan.json', {'source_plan_sha256': plan_hash, 'review_sha256': digest(review_path),
    'selected': plan['selected'], 'limits': plan['limits'], 'expected': plan['expected'], 'cleanup': plan['cleanup']})

def committed(relative, row):
    monitor.check()
    rc, text, err = g.git(ROOT, ['show', row['ref'] + ':' + relative])
    monitor.check()
    if rc or hashlib.sha256(text.encode()).hexdigest() != row['sha256']:
        raise RuntimeError('Pinned committed source/input identity mismatch')
    return text

local_before = {}

def verify():
    monitor.check()
    node = Path(plan['node']['path']); st = node.stat()
    if digest(node) != plan['node']['sha256'] or [st.st_dev, st.st_ino] != plan['node']['installationIdentity']:
        raise RuntimeError('Reviewed Node executable changed')
    for relative, row in {**plan['modules'], **plan['file_inputs']}.items():
        committed(relative, row)
    for relative, value in local_before.items():
        if digest(ROOT / relative) != value:
            raise RuntimeError('Local source changed during the run')
    for relative, row in plan['harness'].items():
        if digest(ROOT / relative) != row['sha256']:
            raise RuntimeError('Frozen helper/test changed')
    for row in plan['retained_dependencies'].values():
        if digest(row['packageJson']) != row['packageJsonSha256'] or digest(row['entry']) != row['entrySha256']:
            raise RuntimeError('Retained package/entry changed')
        monitor.check()
        st = Path(row['installedRoot']).stat()
        if [st.st_dev, st.st_ino] != [row['installationDevice'], row['installationInode']]:
            raise RuntimeError('Retained installation changed')

env = {key: value for key, value in os.environ.items()
       if key in ('PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ', 'SHELL') or key.startswith('LC_')}

def owned_run(command, env, log):
    launch_started = time.monotonic()
    issue, written, next_update = None, 0, 0.0
    child_env = scratch.env(env)
    child_env['TEST_RESOURCE_PARENT_RESERVATION'] = scratch.token
    with log.open('xb') as output:
        process = subprocess.Popen(command, cwd=str(ROOT), env=child_env, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        try:
            scratch.child(process)  # Captured ownership precedes telemetry or fallible writes.
            with selectors.DefaultSelector() as ready:
                ready.register(process.stdout, selectors.EVENT_READ)
                eof = False
                while not eof or process.poll() is None:
                    rss = monitor.check()
                    used = scratch.sample()
                    if time.monotonic() >= next_update:
                        host.update(scratch.token, used, rss)
                        next_update = time.monotonic()+0.5
                    if cancel.is_set():
                        raise b.BoundError('Owned run cancelled')
                    if time.monotonic()-launch_started > 120:
                        raise b.BoundError('Worker deadline exceeded')
                    if used > allocation['disk'] or shutil.disk_usage(scratch.root).free < policy.reserve:
                        raise b.BoundError('Owned disk budget/headroom exceeded')
                    events = ready.select(0.1)
                    if eof:
                        time.sleep(0.05)
                    for key, mask in events:
                        block = os.read(key.fd, 65536)
                        if not block:
                            ready.unregister(key.fd); eof = True
                        else:
                            if written+len(block) > b.CONTRACT['log_bytes']:
                                raise b.BoundError('Worker log cap exceeded')
                            output.write(block); output.flush(); written += len(block)
        except BaseException as error:
            issue = type(error).__name__
            raise
        finally:
            # No sample, persistence or telemetry before direct captured-child wait.
            ownership.join_direct()
            process.stdout.close()
    return {'rc': process.returncode, 'wall': time.monotonic()-launch_started, 'issue': issue,
            'issue_kind': None, 'peak_scratch': scratch.record['peak'],
            'peak_rss': monitor.peak, 'manifest': str(scratch.manifest), 'log': str(log)}

result = None
failure = None
allocation = None
observed = []
phases = {}
verified_after = False
preparation_wall = None
with lifecycle.deferred_cancellation(cancel):
    try:
        if cancel.is_set():
            raise KeyboardInterrupt('Cancelled before allocation')
        allocation = host.acquire(scratch.token, 128*r.MIB, 768*r.MIB, '/private/tmp', root=scratch.root,
                                  minimum_ram=640*r.MIB)
        monitor.limit = allocation['ram']
        monitor.check()
        # Consumption precedes the first scratch/source copy. A failed run never retries itself.
        outputs.json(consumption, {'owner': r.owner(), 'review': str(review_path),
            'plan_sha256': plan_hash, 'run': run_id}, exclusive=True)
        host.update(scratch.token, outputs.observe()['charged_combined_bytes'], monitor.checkpoint())
        local_before = {relative: digest(ROOT / relative) for relative in set(plan['modules']) | set(plan['file_inputs'])
                        if (ROOT / relative).is_file()}
        verify()
        with scratch:
            mirror = scratch.root / 'composition'
            modules = []
            for relative, row in plan['modules'].items():
                if cancel.is_set():
                    raise KeyboardInterrupt('Cancelled before launch')
                target = (mirror / relative).with_suffix('.mjs')
                target.parent.mkdir(parents=True, exist_ok=True)
                payload = committed(relative, row).encode()
                outputs.write(target, payload, b.CONTRACT['json_bytes'])
                modules.append({'path': relative, 'canonical': (ROOT / relative).as_uri(), 'url': target.as_uri(),
                                'sha256': row['sha256'], 'overlay': True})
            for relative, row in plan['file_inputs'].items():
                target = mirror / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                payload = committed(relative, row).encode()
                outputs.write(target, payload, b.CONTRACT['json_bytes'])
            mapping = {'modules': modules, 'loader': {'url': LOADER.as_uri(), 'sha256': digest(LOADER)},
                'test': {'path': str(TEST.relative_to(ROOT)), 'url': TEST.as_uri(), 'sha256': digest(TEST)},
                'projectRoot': ROOT.as_uri() + '/', 'overlayRoot': mirror.as_uri() + '/',
                'journal': str(scratch.root / 'modules.jsonl'),
                'dependencies': {key: {'url': Path(row['entry']).as_uri(), 'sha256': row['entrySha256']}
                                 for key, row in plan['retained_dependencies'].items()}}
            map_path = scratch.root / 'module-map.json'; r.atomic_json(map_path, mapping)
            env.update(GCSP_FUCQ105_FOLLOWUP_MAP=str(map_path),
                       GCSP_FUCQ105_FOLLOWUP_CHECKPOINT=str(scratch.root / 'checkpoints.json'),
                       GCSP_FUCQ105_FOLLOWUP_QUESTION_INPUT=str(mirror / 'server/gcsp/offers/followup-policy-definitions.json'))
            command = [plan['node']['path'], '--no-warnings', '--loader', str(LOADER), '--test',
                       '--test-concurrency=1', '--test-reporter=tap', str(TEST)]
            preparation_wall = time.monotonic() - started
            stamp = module('decision_stamp', ROOT / '_tools/test_stamp.py')
            def adapter_git(root, arguments):
                rc, out, err = g.git(Path(root), arguments)
                if rc:
                    raise stamp.RunError(err or out)
                return out.rstrip()
            stamp._git = adapter_git
            stamp.ref_exists = lambda root, ref: g.git(Path(root), ['rev-parse', '--verify', '--quiet', ref+'^{commit}'])[0] == 0
            stamp.resource_module = lambda: r
            stamp._atomic_write_json = outputs.json
            original_load = stamp.load_settings
            def bounded_load(root, override=None):
                settings = original_load(root, override)
                settings.resources = dict(settings.resources, **plan['limits'], inputs=[str(PLAN), str(map_path)]
                    + [str(ROOT/p) for p in plan['harness']]
                    + [str(Path(row['url'].removeprefix('file://'))) for row in modules]
                    + [str(mirror/p) for p in plan['file_inputs']]
                    + [str(Path(row[key]).resolve()) for row in plan['retained_dependencies'].values() for key in ('packageJson', 'entry')])
                return settings
            stamp.load_settings = bounded_load
            log = scratch.root / 'checks.log'
            def selected_run(settings, args, chosen, rdir, say, classes_fn=None, identity=None):
                global result
                if chosen or settings.command != shlex.join(command):
                    raise RuntimeError('Unexpected selected command')
                if cancel.is_set():
                    raise KeyboardInterrupt('Cancelled before launch')
                ownership.begin()
                try:
                    result = owned_run(command, env, log)
                finally:
                    ownership.require_safe()
                counts = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|skipped|cancelled) (\d+)$', b.read_bytes(log, b.CONTRACT['log_bytes']).decode('utf-8', errors='replace'), re.M)}
                result['counts'] = counts
                passed = result['rc'] == 0 and not result['issue'] and counts.get('tests') == 1 \
                    and counts.get('pass') == 1 and counts.get('fail') == 0 and counts.get('skipped') == 0 and counts.get('cancelled') == 0
                return passed, counts.get('tests', 0), counts.get('skipped', 0), result['wall']
            stamp.run_suite = selected_run
            os.environ.clear(); os.environ.update(env); os.environ['TEST_STAMP_DIR'] = str(record_dir / 'strict')
            with redirect_stdout(b.Quiet()), redirect_stderr(b.Quiet()):
                rc = stamp.main(['--root', str(ROOT), '--jobs', '1', '--targeted', plan['validation_base'],
                '--command', shlex.join(command), '--reason', plan['selection_reason']])
            if rc or result is None or result['rc'] or result['issue']:
                failure = 'SelectedChecksFailed'
            if (scratch.root / 'checkpoints.json').exists():
                phases = b.read_json(scratch.root / 'checkpoints.json', b.CONTRACT['checkpoint_bytes'])
            if (scratch.root / 'modules.jsonl').exists():
                observed = [json.loads(line) for line in b.read_bytes(scratch.root / 'modules.jsonl', b.CONTRACT['journal_bytes']).splitlines()]
            expected = {row['path']: row for row in modules}
            expected[str(TEST.relative_to(ROOT))] = {**mapping['test'], 'canonical': TEST.as_uri(), 'overlay': False}
            for row in observed:
                if row['path'] not in expected or any(row[key] != expected[row['path']][key]
                        for key in ('canonical', 'url', 'sha256', 'overlay')):
                    raise RuntimeError('Observed source not in reviewed map')
            if not failure and set(row['path'] for row in observed) != set(expected):
                raise RuntimeError('Reviewed source closure not fully observed')
            if not failure and phases.get('completed') != plan['expected_checkpoints']:
                raise RuntimeError('Planned consumer checkpoints incomplete')
            for row in modules:
                if digest(Path(row['url'].removeprefix('file://'))) != row['sha256']:
                    raise RuntimeError('Executed module changed')
            for relative, row in plan['file_inputs'].items():
                if digest(mirror/relative) != row['sha256']:
                    raise RuntimeError('Executed file input changed')
            verify(); verified_after = True
            if failure and log.exists():
                retain_failure_log(log)
    except BaseException as error:
        failure = failure or type(error).__name__  # Provider/credential text is deliberately not retained.
    finally:
        # Only finite diagnostic writes are permitted after an accounting failure.
        # sample/check still fail closed, retaining scratch/reservation when uncertain.
        outputs.diagnostics = True
        child_safe = ownership.finish()
        try:
            groups_absent = all(r.group_has_live_members(group) is False for group in scratch.record['groups'])
            processes_absent = all(not r.process_alive(row) for row in scratch.record['processes'])
        except BaseException:
            groups_absent = processes_absent = False
            failure = failure or 'CleanupObservationUnknown'
        release_proof = {'child_safe': child_safe, 'groups_absent': groups_absent,
                         'processes_absent': processes_absent, 'scratch_absent': not os.path.lexists(scratch.root)}
        cleanup = {'scratch_absent': release_proof['scratch_absent'],
            'child_ownership_and_join_verified': child_safe, 'child_launch': dict(ownership.record),
            'groups_absent': groups_absent, 'processes_absent': processes_absent,
            'reservation_release_receipt': str(record_dir/'terminal.json'),
            'reservation_intent': scratch.record.get('reservation_intent'),
            'ledger_staging': scratch.record.get('ledger_staging', []),
            'root': str(scratch.root), 'groups': scratch.record['groups'], 'processes': scratch.record['processes'],
            'token': scratch.token, 'scratch_manifest': str(scratch.manifest), 'ports': [], 'profiles': [], 'dependency_links': []}
        if not all(release_proof.values()):
            failure = failure or 'CleanupIncomplete'
        if cancel.is_set() or monitor.issue:
            failure = failure or 'AggregateObservationFailedOrCancelled'
        bundle_written = False
        try:
            if not observed and (record_dir/'modules.jsonl').exists():
                observed = [json.loads(line) for line in b.read_bytes(record_dir/'modules.jsonl', b.CONTRACT['journal_bytes']).splitlines()]
            if not phases and (record_dir/'checkpoints.json').exists():
                phases = b.read_json(record_dir/'checkpoints.json', b.CONTRACT['checkpoint_bytes'])
            strict = list((record_dir/'strict').glob('targeted-*.json'))
            if not failure and len(strict) != 1:
                failure = 'MissingStrictTargetedEvidence'
            summary = {'status': 'failed' if failure else 'pending-independent-audit', 'failure': failure, 'owner': r.owner(),
                'source_plan_sha256': plan_hash, 'review': str(review_path), 'result': result, 'checkpoints': phases,
                'preparation_wall_seconds': preparation_wall, 'supervisor_wall_seconds': time.monotonic()-started,
                'observed_unique_identities': len({row['path'] for row in observed}), 'module_journal': observed,
                'local_source_before': local_before, 'source_inputs_helpers_verified_after': verified_after,
                'cleanup': cleanup, 'peak_before_bundle_bytes': outputs.peak,
                'strict_receipt': str(strict[0]) if len(strict) == 1 else None, 'exclusions': plan['exclusions']}
            outputs.json(record_dir/'summary.json', summary, b.CONTRACT['summary_bytes'], exclusive=True)
            outputs.json(run_manifest, {'owner': summary['owner'], 'state': summary['status'],
                'output': str(record_dir), 'cleanup': cleanup})
            outputs.json(BASE.parent/'impact'/(run_id+'.json'), {'plan_sha256': plan_hash, 'test': plan['selected'],
                'imports': plan['import_edges'], 'file_edges': plan['file_edges'], 'result': summary['status'],
                'counts': result.get('counts') if result else None, 'wall': result['wall'] if result else None,
                'boundaries': plan['exclusions']})
            outputs.observe(); monitor.checkpoint()
            if allocation is not None:
                host.update(scratch.token, outputs.observe()['charged_combined_bytes'], monitor.check())
            monitor.checkpoint()
            bundle_written = True
        except BaseException as error:
            failure = failure or 'Bundle'+type(error).__name__
        # Release authority remains exclusively the exact-row strict adapter, after the bounded
        # bundle and its final combined-allocation/RAM check. Unknown accounting retains the row.
        if host.attempted and bundle_written and all(release_proof.values()):
            try:
                host.release(scratch.token, release_proof)
            except BaseException:
                failure = failure or 'ReservationReleaseUncertain'
        try:
            reservation_absent = host.absence(scratch.token)
            reservation_known = True
        except BaseException:
            reservation_absent = False; reservation_known = False
            failure = failure or 'ReservationObservationUnknown'
        if not reservation_absent:
            failure = failure or 'ReservationRetained'
        try:
            # Freeze one terminal receipt. Its upper bound includes its own reserved allocation,
            # atomic staging and the later independent audit. Never rewrite a receipt recursively.
            final_allocation = outputs.observe()
            try:
                monitor.checkpoint()
            except BaseException:
                failure = failure or 'FinalAggregateObservationFailed'
            terminal = {'status': 'failed' if failure else 'passed', 'failure': failure,
                'source_plan_sha256': plan_hash, 'summary_sha256': digest(record_dir/'summary.json') if bundle_written else None,
                'bundle_written': bundle_written, 'reservation_released': reservation_absent,
                'reservation_observation_known': reservation_known,
                'scratch_manifest_sha256': digest(scratch.manifest),
                'ledger_staging_count': len(scratch.record.get('ledger_staging', [])),
                'allocation_before_terminal': final_allocation,
                'final_combined_upper_bound_bytes': final_allocation['charged_combined_bytes'],
                'aggregate': monitor.receipt(), 'independent_audit_required': True}
            outputs.json(record_dir/'terminal.json', terminal, b.CONTRACT['terminal_bytes'], exclusive=True)
            outputs.observe()  # Actual final files included; no receipt rewrite follows this check.
            monitor.checkpoint()
        except BaseException:
            failure = failure or 'TerminalWriteOrPostwriteCheckFailed'
        finally:
            try:
                monitor.stop()  # Captured telemetry handle and monitor thread joined before return.
            except BaseException:
                failure = failure or 'AggregateMonitorJoinFailed'
        # Parent must supply the actual exit code to the independent post-exit auditor.
        if cancel.is_set():
            failure = failure or 'CancelledDuringFinalization'
        if monitor.issue:
            failure = failure or 'AggregateObservationFailedDuringFinalization'
        sys.stdout.buffer.write(b.encode({'summary': str(record_dir/'summary.json'),
            'terminal': str(record_dir/'terminal.json'), 'status': 'failed' if failure else 'passed',
            'failure': failure}, b.CONTRACT['stdout_bytes']))
        sys.stdout.buffer.flush()
sys.exit(1 if failure else 0)
