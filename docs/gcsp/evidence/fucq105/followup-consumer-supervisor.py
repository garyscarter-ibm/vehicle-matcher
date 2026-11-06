"""Authoring proposal. Requires an explicit external root review before one finite memory run."""
from pathlib import Path
import argparse
import atexit
import hashlib
import importlib.util
import json
import os
import re
import shlex
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
review = json.loads(review_path.read_text())
plan_hash = digest(PLAN)
if review.get('approved') is not True or review.get('scope') != 'fucq105-followup-consumer-memory' or review.get('plan_sha256') != plan_hash:
    raise SystemExit('Missing exact external root review; no allocation or product imports performed.')
run_id = review.get('run_id', '')
if not re.fullmatch(r'fucq105-followup-[a-zA-Z0-9-]{1,80}', run_id):
    raise SystemExit('Supply a unique root run identity.')
if review_path.is_relative_to(ROOT) or review_path.is_relative_to(Path('/private/tmp')):
    raise SystemExit('Review must be retained outside worktree and scratch.')
plan = json.loads(PLAN.read_text())
for relative, row in plan['harness'].items():
    if digest(ROOT / relative) != row['sha256']:
        raise SystemExit('Frozen helper/test identity changed; review a new plan.')
r = module('decision_resources', ROOT / '_tools/test_resources.py')
g = module('decision_git', ROOT / '_tools/scaffold_git.py')
lifecycle = module('decision_lifecycle', ROOT / 'docs/gcsp/evidence/fucq105/decision-mixed-lifecycle.py')
ledger = module('decision_ledger', ROOT / 'docs/gcsp/evidence/fucq105/decision-mixed-ledger.py')
policy = r.Policy(plan['limits'])
record_dir = BASE / run_id
run_manifest = BASE / 'ownership' / (run_id + '.json')
consumption = BASE / 'ownership' / (run_id + '-consumed.json')
if consumption.exists() or record_dir.exists():
    raise SystemExit('Run identity already used; no retry without a new root run grant.')

class OwnedScratch(r.Scratch):
    def child(self, process):
        ownership.register(process)

    def sample(self):
        if self.record['groups']:
            snapshot = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,lstart='], capture_output=True, text=True, timeout=3)
            if snapshot.returncode:
                raise r.ResourceError('Unable to audit owned process identities')
            rows = [line.split(None, 3) for line in snapshot.stdout.splitlines()]
            rows = [dict(pid=int(v[0]), ppid=int(v[1]), pgid=int(v[2]), start=v[3].strip()) for v in rows if len(v) == 4]
            selected = {v['pid'] for v in rows if v['pgid'] in self.record['groups']}
            while True:
                more = {v['pid'] for v in rows if v['ppid'] in selected} - selected
                if not more:
                    break
                selected.update(more)
            seen = {(v['pid'], v['start']): v for v in self.record.get('processes', [])}
            seen.update({(v['pid'], v['start']): v for v in rows if v['pid'] in selected})
            self.record['processes'] = list(seen.values())
            r.atomic_json(self.manifest, self.record)
        used = super().sample() + r.allocated_bytes(record_dir) \
            + self.record.get('ledger_staging_peak_bytes', 0)  # Conservatively charge the bounded atomic ledger copy.
        self.record['peak_combined'] = max(self.record.get('peak_combined', 0), used)
        return used

    def __exit__(self, kind, value, tb):
        # Never delete a root using an empty/partially persisted child list as absence evidence.
        ownership.require_safe()
        # Preserve bounded diagnostic evidence before the owned root is removed, including on an exception.
        log = self.root / 'checks.log'
        if log.exists() and (kind is not None or result and (result['rc'] or result['issue'])):
            (record_dir / 'failure.log').write_text(log.read_text()[-65536:])
        for source, target in [('checkpoints.json', 'checkpoints.json'), ('modules.jsonl', 'modules.jsonl')]:
            path = self.root / source
            if path.exists():
                (record_dir / target).write_bytes(path.read_bytes())
        return super().__exit__(kind, value, tb)

scratch = OwnedScratch(record_dir, ROOT, policy)
scratch.record.update(story='FUCQ-105', ports=[], profiles=[], dependency_links=[], processes=[])
ownership = lifecycle.LaunchOwnership(r, scratch)
host = ledger.Budget(r, policy, plan['host_budget'], scratch)
cancel = threading.Event()
# Registered before allocation. This fallback does no query, manifest write or ledger mutation.
atexit.register(ownership.join_direct)
r.atomic_json(run_manifest, {'owner': r.owner(), 'state': 'planned', 'run': run_id, 'review': str(review_path),
                             'root': str(scratch.root), 'scratch_manifest': str(scratch.manifest), 'output': str(record_dir)})
r.atomic_json(record_dir / 'plan.json', {'source_plan_sha256': plan_hash, 'review_sha256': digest(review_path),
    'selected': plan['selected'], 'limits': plan['limits'], 'expected': plan['expected'], 'cleanup': plan['cleanup']})

def committed(relative, row):
    rc, text, err = g.git(ROOT, ['show', row['ref'] + ':' + relative])
    if rc or hashlib.sha256(text.encode()).hexdigest() != row['sha256']:
        raise RuntimeError('Pinned committed source/input identity mismatch')
    return text

local_before = {relative: digest(ROOT / relative) for relative in set(plan['modules']) | set(plan['file_inputs'])
                if (ROOT / relative).is_file()}

def verify():
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
        st = Path(row['installedRoot']).stat()
        if [st.st_dev, st.st_ino] != [row['installationDevice'], row['installationInode']]:
            raise RuntimeError('Retained installation changed')

env = {key: value for key, value in os.environ.items()
       if key in ('PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ', 'SHELL') or key.startswith('LC_')}

result = None
failure = None
allocation = None
observed = []
phases = {}
verified_after = False
preparation_wall = None
with lifecycle.deferred_cancellation(cancel):
    try:
        verify()
        if cancel.is_set():
            raise KeyboardInterrupt('Cancelled before allocation')
        allocation = host.acquire(scratch.token, 128*r.MIB, 768*r.MIB, '/private/tmp', root=scratch.root,
                                  minimum_ram=384*r.MIB)
        # Consumption precedes the first scratch/source copy. A failed run never retries itself.
        consumption.parent.mkdir(parents=True, exist_ok=True)
        with consumption.open('x') as output:
            json.dump({'owner': r.owner(), 'review': str(review_path), 'plan_sha256': plan_hash, 'run': run_id}, output)
        with scratch:
            mirror = scratch.root / 'composition'
            modules = []
            for relative, row in plan['modules'].items():
                if cancel.is_set():
                    raise KeyboardInterrupt('Cancelled before launch')
                target = (mirror / relative).with_suffix('.mjs')
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(committed(relative, row))
                modules.append({'path': relative, 'canonical': (ROOT / relative).as_uri(), 'url': target.as_uri(),
                                'sha256': row['sha256'], 'overlay': True})
            for relative, row in plan['file_inputs'].items():
                target = mirror / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(committed(relative, row))
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
                    result = r.run_process(command, str(ROOT), env, log, scratch, policy,
                        allocation['disk'], allocation['ram'], 120, host=host, cancel=cancel)
                finally:
                    ownership.require_safe()
                counts = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|skipped|cancelled) (\d+)$', log.read_text(), re.M)}
                result['counts'] = counts
                passed = result['rc'] == 0 and not result['issue'] and counts.get('tests') == 1 \
                    and counts.get('pass') == 1 and counts.get('fail') == 0 and counts.get('skipped') == 0 and counts.get('cancelled') == 0
                return passed, counts.get('tests', 0), counts.get('skipped', 0), result['wall']
            stamp.run_suite = selected_run
            os.environ.clear(); os.environ.update(env); os.environ['TEST_STAMP_DIR'] = str(record_dir / 'strict')
            rc = stamp.main(['--root', str(ROOT), '--jobs', '1', '--targeted', plan['validation_base'],
                '--command', shlex.join(command), '--reason', plan['selection_reason']])
            if rc or result is None or result['rc'] or result['issue']:
                failure = 'SelectedChecksFailed'
            if (scratch.root / 'checkpoints.json').exists():
                phases = json.loads((scratch.root / 'checkpoints.json').read_text())
            if (scratch.root / 'modules.jsonl').exists():
                observed = [json.loads(line) for line in (scratch.root / 'modules.jsonl').read_text().splitlines()]
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
                (record_dir/'failure.log').write_text(log.read_text()[-65536:])
    except BaseException as error:
        failure = failure or type(error).__name__  # Provider/credential text is deliberately not retained.
    finally:
        child_safe = ownership.finish()
        groups_absent = all(r.group_has_live_members(group) is False for group in scratch.record['groups'])
        processes_absent = all(not r.process_alive(row) for row in scratch.record['processes'])
        release_proof = {'child_safe': child_safe, 'groups_absent': groups_absent,
                         'processes_absent': processes_absent, 'scratch_absent': not os.path.lexists(scratch.root)}
        # Strict adapter never prunes foreign/dead rows and mutates only its exact owner/root-bound row.
        if host.attempted and all(release_proof.values()):
            try:
                host.release(scratch.token, release_proof)
            except BaseException:
                failure = failure or 'ReservationReleaseUncertain'
        try:
            reservation_absent = host.absence(scratch.token)
            reservation_known = True
        except BaseException:
            reservation_absent = False
            reservation_known = False
            failure = failure or 'ReservationObservationUnknown'
        cleanup = {'scratch_absent': not os.path.lexists(scratch.root),
            'child_ownership_and_join_verified': child_safe, 'child_launch': dict(ownership.record),
            'groups_absent': groups_absent,
            'processes_absent': processes_absent, 'reservation_released': reservation_absent,
            'reservation_observation_known': reservation_known,
            'reservation_intent': scratch.record.get('reservation_intent'),
            'ledger_staging': scratch.record.get('ledger_staging', []),
            'reservation_retention_scope': 'Owned strict ledger adapter; no pruning/defaults/token-only mutation. Unresolved accounting requires root reconciliation.',
            'root': str(scratch.root), 'groups': scratch.record['groups'], 'processes': scratch.record['processes'],
            'token': scratch.token, 'scratch_manifest': str(scratch.manifest), 'ports': [], 'profiles': [], 'dependency_links': []}
        if not all(cleanup[key] for key in ('child_ownership_and_join_verified', 'scratch_absent', 'groups_absent', 'processes_absent', 'reservation_released')):
            failure = failure or 'CleanupIncomplete'
        if cancel.is_set():
            failure = failure or 'Cancelled'
        try:
            if not observed and (record_dir/'modules.jsonl').exists():
                observed = [json.loads(line) for line in (record_dir/'modules.jsonl').read_text().splitlines()]
            if not phases and (record_dir/'checkpoints.json').exists():
                phases = json.loads((record_dir/'checkpoints.json').read_text())
        except (ValueError, OSError):
            failure = failure or 'InvalidRetainedCheckpointOrJournal'
        strict = list((record_dir/'strict').glob('targeted-*.json'))
        if not failure and len(strict) != 1:
            failure = 'MissingStrictTargetedEvidence'
        summary = {'status': 'failed' if failure else 'passed', 'failure': failure, 'owner': r.owner(),
            'source_plan_sha256': plan_hash, 'review': str(review_path), 'result': result, 'checkpoints': phases,
            'preparation_wall_seconds': preparation_wall, 'supervisor_wall_seconds': time.monotonic() - started,
            'observed_unique_identities': len({row['path'] for row in observed}), 'module_journal': observed,
            'local_source_before': local_before, 'source_inputs_helpers_verified_after': verified_after,
            'cleanup': cleanup, 'peak_combined_bytes': scratch.record.get('peak_combined', 0),
            'strict_receipt': str(strict[0]) if len(strict) == 1 else None, 'exclusions': plan['exclusions']}
        r.atomic_json(record_dir/'summary.json', summary)
        r.atomic_json(run_manifest, {'owner': r.owner(), 'state': summary['status'], 'output': str(record_dir), 'cleanup': cleanup})
        r.atomic_json(BASE.parent/'impact'/(run_id+'.json'), {'plan_sha256': plan_hash, 'test': plan['selected'],
            'imports': plan['import_edges'], 'file_edges': plan['file_edges'], 'result': summary['status'],
            'counts': result.get('counts') if result else None, 'wall': result['wall'] if result else None,
            'boundaries': plan['exclusions']})
        print(json.dumps({'summary': str(record_dir/'summary.json'), 'status': summary['status'],
            'failure': failure, 'counts': result.get('counts') if result else None, 'cleanup': cleanup}))
sys.exit(1 if failure else 0)
