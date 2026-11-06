#!/usr/bin/env python3
"""Finite offline F71 acknowledgement selection, supervised by the trusted shared resource helper."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import resource
import shlex
import sys
import time
import uuid

sys.dont_write_bytecode = True
ROOT = Path('/Users/usget/Claude/vehicle-matcher')
WORK = ROOT / '.claude/worktrees/DEV-2026-11-04-071'
HERE = Path(__file__).resolve().parent
OUT = ROOT / '.claude/dev-poller-resume-20261106/completion-focus/f71-repair'
BASE = 'ed20ca2a774d9368b4fce87a7e69b5e2ae30a7e8'
PRODUCER = '4037b762086113e4970f651161471b603d39b4d5'
PRODUCER_HASH = 'a080a47479444a94f041de1b0c094974c3eea655a8076f771ec33f82ecb43379'
TARGET = ROOT / '.claude/worktrees/DEV-2026-11-04-069/server/node_modules/pg'
LINK = WORK / 'server/node_modules/pg'
PHASE = sys.argv[1]
assert PHASE in ('plan', 'red', 'owning', 'boundary')


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(65536), b''):
            value.update(chunk)
    return value.hexdigest()


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


R = module('f71_shared_resources', ROOT / '_tools/test_resources.py')
G = module('f71_supported_git', ROOT / '_tools/scaffold_git.py')
T = module('f71_shared_stamp', ROOT / '_tools/test_stamp.py')
os.environ['SCAFFOLDING_HARNESS'] = 'codex'


def git(root, args):
    with G.checkout_mutex(str(root)):
        rc, out, error = G.git(str(root), args)
    if rc:
        raise RuntimeError(error[:300])
    return out


producer = git(ROOT, ['show', PRODUCER + ':server/gcsp/cases/index.js']).encode()
assert hashlib.sha256(producer).hexdigest() == PRODUCER_HASH
assert git(WORK, ['rev-parse', 'HEAD']).strip() == BASE
node = Path('/opt/homebrew/bin/node').resolve(strict=True)
selected = json.loads((HERE / 'plan.json').read_text())['selectedCommands']
if PHASE != 'plan':
    assert os.environ.get('GCSP_F71_TEST_LANE_GRANTED') == 'fucq71-acknowledgement-20261106', 'Separate parent serial-lane grant required'

policy_values = {'chunk_scratch_mib': 64, 'unit_scratch_mib': 64, 'chunk_ram_mib': 384,
                 'unit_ram_mib': 384, 'chunk_seconds': 120, 'log_mib': 1}
original_settings = T.load_settings


def settings(root, command_override=None):
    value = original_settings(root, command_override)
    value.resources = dict(policy_values, inputs=[str(HERE / 'plan.json'), str(Path(__file__).resolve()),
        str(HERE / 'admission.json'), str(ROOT / '_tools/test_resources.py'), str(ROOT / '_tools/test_stamp.py'), str(node), str(TARGET.parent)])
    return value


T._git = lambda root, args: git(Path(root), args)
T.load_settings = settings
T.resource_module = lambda: R
OUT.mkdir(parents=True, exist_ok=True)
clean = {key: os.environ[key] for key in ('PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TZ') if key in os.environ}
clean.update(SCAFFOLDING_HARNESS='codex', GCSP_F71_CASE_SOURCE_BASE64=base64.b64encode(producer).decode())
os.environ.clear()
os.environ.update(clean)


def targeted(argv, lines):
    args = T.build_parser().parse_args(argv)
    args.jobs = 1
    return T.cmd_targeted(args, say=lines.append)


if PHASE == 'plan':
    plans = []
    for phase, argv in selected.items():
        lines = []
        result = targeted(['--root', str(WORK), '--targeted', BASE, '--command', shlex.join(argv),
                           '--reason', 'F71 acknowledged renewal envelope through pinned F112 consumer and scoped deadline boundaries', '--dry-run'], lines)
        plans.append({'phase': phase, 'exit': result, 'plan': lines})
        assert result == 0
    R.atomic_json(OUT / 'selector-plan.json', {'scope': 'dry-run only', 'plans': plans})
    print(json.dumps({'phase': PHASE, 'selector': str(OUT / 'selector-plan.json'), 'testsRun': 0}))
    raise SystemExit(0)

if PHASE == 'red' and any(json.loads(p.read_text()).get('status') == 'expected-regression-failure' for p in OUT.glob('red-*.json')):
    raise SystemExit('The original red allocation is consumed; retain its evidence without rerunning it.')
frozen = json.loads((HERE / 'admission.json').read_text())
expected_hashes = frozen['redHashes'] if PHASE == 'red' else frozen['greenHashes']
assert all(digest(WORK / path) == value for path, value in expected_hashes.items())


def target_identity():
    entries = {}
    for path in sorted(TARGET.parent.rglob('*')):
        if path.is_file():
            stat = path.stat()
            entries[str(path.relative_to(TARGET.parent))] = [stat.st_dev, stat.st_ino, digest(path)]
    stat = TARGET.parent.stat()
    return {'root': [stat.st_dev, stat.st_ino], 'files': entries}


def code_identity():
    paths = list((WORK / 'server/gcsp').rglob('*.js')) + list((WORK / 'server/gcsp').rglob('*.json'))
    paths += [WORK / p for p in ('server/test/gcsp-manual-order.test.js', 'server/test/gcsp-renewal-case.test.js',
        'server/test/helpers/employee-recommendation.js', 'docs/gcsp/evidence/fucq71/response-fixtures.json',
        'package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json')]
    return {str(path.relative_to(WORK)): digest(path) for path in sorted(paths)}


assert TARGET.is_dir() and not TARGET.is_symlink()
assert not os.path.lexists(LINK) and not os.path.lexists(LINK.parent)
before_target = target_identity()
before_code = code_identity()
policy = R.Policy(policy_values)
scratch = R.Scratch(OUT, WORK, policy, expected=64 * R.MIB)
run = PHASE + '-' + uuid.uuid4().hex
log = OUT / (run + '.log')
receipt = OUT / (run + '.json')
link_manifest = OUT / (run + '-dependency.json')
record = {'phase': PHASE, 'scope': 'targeted', 'base': BASE, 'command': selected[PHASE],
          'consumerCommit': PRODUCER, 'consumerSha256': PRODUCER_HASH, 'codeBefore': before_code,
          'limits': policy_values, 'childRamMiB': 320, 'supervisorRamMiB': 64,
          'status': 'incomplete', 'scratch': str(scratch.root), 'scratchManifest': str(scratch.manifest),
          'dependencyManifest': str(link_manifest), 'startedAt': time.time()}
created_dir = created_link = None
reserved = False
processes = []
tap = {}
host = R.HostBudget(policy)
# Preserve every foreign reservation. Only this run's exact row is released below.
host._dead_owners = lambda: {}
R.atomic_json(link_manifest, {'state': 'planned', 'owner': R.owner(), 'link': str(LINK),
                            'target': str(TARGET), 'targetIdentity': before_target})
R.atomic_json(receipt, record)
original_child = scratch.child


def child(process):
    processes.append(process)
    scratch.record.setdefault('groupOwners', []).append(R.process_identity(process.pid))
    original_child(process)


scratch.child = child


def supervised_command(st, command, env_extra, rdir, say=print, dry_run=False, args=None, identity=None):
    assert command == shlex.join(selected[PHASE]) and not dry_run
    assert resource.getrusage(resource.RUSAGE_SELF).ru_maxrss <= 64 * R.MIB
    env = dict(os.environ, **env_extra, NODE_V8_COVERAGE=str(scratch.root / 'coverage'))
    result = R.run_process(selected[PHASE], WORK, env, log, scratch, policy, 64 * R.MIB, 320 * R.MIB, 120, host=host)
    record['execution'] = result
    text = log.read_text()
    for key, value in re.findall(r'^(?:#|ℹ) (tests|pass|fail|cancelled|skipped|todo) (\d+)$', text, re.M):
        tap[key] = int(value)
    record['tap'] = tap
    record['supervisorPeakRssBytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    record['chargedPeakRssBytes'] = result['peak_rss'] + record['supervisorPeakRssBytes']
    assert record['chargedPeakRssBytes'] <= 384 * R.MIB
    record['coverage'] = []
    for coverage in sorted((scratch.root / 'coverage').glob('*.json')):
        for entry in json.loads(coverage.read_text()).get('result', []):
            if entry['url'].startswith((WORK / 'server/gcsp').as_uri()):
                ranges = [r for function in entry['functions'] for r in function['ranges']]
                record['coverage'].append({'module': entry['url'], 'observedRanges': len(ranges),
                                           'coveredRanges': sum(r['count'] > 0 for r in ranges)})
    return (result['rc'] == 0 and not result['issue'], None, 0, result['wall'])


T.run_command = supervised_command
try:
    with R.handled_termination():
        allocation = host.acquire(scratch.token, 64 * R.MIB, 384 * R.MIB, ROOT, root=scratch.root,
                                  minimum_disk=64 * R.MIB, minimum_ram=384 * R.MIB)
        reserved = True
        assert allocation == {'disk': 64 * R.MIB, 'ram': 384 * R.MIB}
        with R.locked(host.directory / 'reservations.lock'):
            own_row = R.read_json(host.path)[scratch.token]
        record['reservation'] = {'token': scratch.token, 'owner': own_row['owner'], 'root': own_row['root']}
        with scratch:
            LINK.parent.mkdir(mode=0o700)
            stat = LINK.parent.lstat()
            created_dir = [stat.st_dev, stat.st_ino]
            R.atomic_json(link_manifest, {'state': 'directory-created', 'owner': R.owner(), 'link': str(LINK),
                'directoryIdentity': created_dir, 'target': str(TARGET), 'targetIdentity': before_target})
            LINK.symlink_to(TARGET, target_is_directory=True)
            stat = LINK.lstat()
            created_link = [stat.st_dev, stat.st_ino]
            R.atomic_json(link_manifest, {'state': 'linked', 'owner': R.owner(), 'link': str(LINK),
                'linkIdentity': created_link, 'directoryIdentity': created_dir, 'target': str(TARGET), 'targetIdentity': before_target})
            os.environ['TEST_STAMP_DIR'] = str(OUT / (run + '-targeted'))
            stamp_lines = []
            record['stampExit'] = targeted(['--root', str(WORK), '--targeted', BASE, '--command', shlex.join(selected[PHASE]),
                '--reason', 'Pinned F112 consumer tick after real F71 acknowledgement; scoped deadline and receipt/replay boundaries'], stamp_lines)
            record['stampSummary'] = stamp_lines
            for process in processes:
                process.wait(timeout=5)
                assert R.group_has_live_members(process.pid) is False
            record['directChildrenJoined'] = True
            assert record['stampExit'] == (1 if PHASE == 'red' else 0)
            assert tap.get('fail') == (1 if PHASE == 'red' else 0) and tap.get('tests', 0) > 0
            assert tap.get('cancelled') == 0 and tap.get('todo') == 0
            assert tap.get('skipped') == (1 if PHASE == 'owning' else 0)
            assert not record['execution']['issue']
            assert code_identity() == before_code
            record['status'] = 'expected-regression-failure' if PHASE == 'red' else 'passed'
finally:
    errors = []
    for process in processes:
        try:
            R.stop_group(process)
            process.wait(timeout=5)
            if R.group_has_live_members(process.pid) is not False:
                errors.append('child group absence unverified')
        except BaseException as error:
            errors.append(type(error).__name__ + ': child teardown')
    if created_link:
        stat = LINK.lstat()
        assert [stat.st_dev, stat.st_ino] == created_link and LINK.is_symlink() and LINK.readlink() == TARGET
        LINK.unlink()
    if created_dir:
        stat = LINK.parent.lstat()
        assert [stat.st_dev, stat.st_ino] == created_dir
        LINK.parent.rmdir()
    target_unchanged = target_identity() == before_target
    record['cleanup'] = {'scratchAbsent': not os.path.lexists(scratch.root), 'dependencyLinkAbsent': not os.path.lexists(LINK),
        'dependencyDirectoryAbsent': not os.path.lexists(LINK.parent), 'targetIdentityUnchanged': target_unchanged,
        'childrenJoined': all(p.poll() is not None for p in processes), 'groupsAbsent': all(R.group_has_live_members(p.pid) is False for p in processes), 'errors': errors}
    if reserved and all(record['cleanup'][key] for key in ('scratchAbsent', 'dependencyLinkAbsent', 'dependencyDirectoryAbsent', 'targetIdentityUnchanged', 'childrenJoined', 'groupsAbsent')) and not errors:
        with R.locked(host.directory / 'reservations.lock'):
            rows = json.loads(host.path.read_text())
            current = rows[scratch.token]
            assert all(current[key] == own_row[key] for key in ('owner', 'root', 'disk', 'ram', 'parent'))
            del rows[scratch.token]
            R.atomic_json(host.path, rows)
    with R.locked(host.directory / 'reservations.lock'):
        record['cleanup']['reservationAbsent'] = scratch.token not in json.loads(host.path.read_text())
    record['scratchPeakBytesRemoved'] = scratch.record['peak'] if record['cleanup']['scratchAbsent'] else 0
    record['finishedAt'] = time.time()
    record['codeAfter'] = code_identity()
    R.atomic_json(link_manifest, {'state': 'removed' if record['cleanup']['dependencyLinkAbsent'] else 'unresolved', 'cleanup': record['cleanup'], 'targetIdentity': before_target})
    R.atomic_json(receipt, record)
    if record['status'] == 'passed' and log.exists():
        log.unlink()
    print(json.dumps({'phase': PHASE, 'status': record['status'], 'receipt': str(receipt), 'tap': tap, 'cleanup': record['cleanup']}))
assert not errors and all(value for key, value in record['cleanup'].items() if key != 'errors')
