#!/usr/bin/env python3
"""Authored only. Exact catalogue plus separate one-use root admission required.

No planning/run helper mode is invoked while authoring this file. A future root
grant binds revision, catalogue, host directory/lock and one deterministic run.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import stat
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-060')
HERE = ROOT / 'docs/gcsp/evidence/fucq100'
CATALOGUE = HERE / 'manual-resume-catalogue.json'
RECORDS = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq100')
MIB = 1024 ** 2


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(65536), b''):
            value.update(block)
    return value.hexdigest()


def read(path, cap=2 * MIB):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        value = os.fstat(stream.fileno())
        if not stat.S_ISREG(value.st_mode) or value.st_size > cap:
            raise RuntimeError('Expected finite regular admission input')
        data = stream.read(cap + 1)
    if len(data) > cap:
        raise RuntimeError('Admission input grew beyond bound')
    return data


def strict(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise RuntimeError('Duplicate admission JSON key')
            result[key] = value
        return result
    def constant(value):
        raise RuntimeError('Nonstandard admission JSON constant')
    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def physical(path, expected):
    value = path.stat()
    actual = {'sha256': sha(path), 'bytes': value.st_size, 'device': value.st_dev,
        'inode': value.st_ino, 'realpath': str(path.resolve()), 'symlink': path.is_symlink()}
    if actual != expected:
        raise RuntimeError('Frozen physical input differs: ' + str(path))


def imported(plan, name, path):
    physical(path, plan['helpers'][str(path)])
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def verify(plan):
    for rel, row in plan['sources'].items():
        physical(ROOT / rel, row)
    for path, row in plan['helpers'].items():
        physical(Path(path), row)
    for path, row in plan['tools'].items():
        physical(Path(path), row)
    for rel, expected in plan['directories'].items():
        path = ROOT / rel
        members = []
        for item in path.rglob('*'):
            if item.is_symlink():
                raise RuntimeError('Source directory symlink appeared')
            if item.is_file():
                members.append(item.relative_to(ROOT).as_posix())
        if sorted(members) != expected:
            raise RuntimeError('Source directory membership differs')
    installed = strict(read(ROOT / plan['installed']['path']))
    if sha(ROOT / plan['installed']['path']) != plan['installed']['sha256']:
        raise RuntimeError('Installed inventory identity differs')
    for path, row in installed['files'].items():
        physical(Path(path), row)
    for row in installed['packages']:
        path = Path(row['path'])
        value = path.lstat()
        if path.resolve() != path or not stat.S_ISDIR(value.st_mode) or (value.st_dev, value.st_ino) != (row['device'], row['inode']):
            raise RuntimeError('Installed package directory identity differs')
        members = []
        for folder, dirs, files in os.walk(path, followlinks=False):
            for item in dirs + files:
                if (Path(folder) / item).is_symlink():
                    raise RuntimeError('Installed package symlink appeared')
            dirs[:] = sorted(item for item in dirs if item != 'node_modules')
            members.extend(str(Path(folder) / name) for name in files)
        expected = sorted(name for name in installed['files'] if name.startswith(str(path) + '/')
            and 'node_modules' not in Path(name).relative_to(path).parts)
        if sorted(members) != expected:
            raise RuntimeError('Installed package finite membership differs')
    for row in installed['absent_optional']:
        if any(os.path.lexists(path) for path in row['paths']):
            raise RuntimeError('Absent optional package appeared')
    return installed


def tap(raw, chunk):
    text = raw.decode('utf-8', errors='strict')
    if re.search(r'^\s*(?:not ok\b|Bail out!)', text, re.M):
        raise RuntimeError('Original TAP contains failed result or bailout')
    results, selected, excluded = [], [], []
    for match in re.finditer(r'^(ok|not ok)\s+(\d+)\s+-\s+(.+)$', text, re.M):
        title = match[3]
        skip = re.fullmatch(r'(.+?)\s+# SKIP(?: test name does not match pattern)?', title)
        if title in chunk['selected'] and match[1] == 'ok':
            selected.append(title)
        elif skip and skip[1] in chunk['excluded'] and match[1] == 'ok':
            excluded.append(skip[1])
        else:
            raise RuntimeError('Unknown, unselected passed, skipped selected or todo TAP result')
        results.append(int(match[2]))
    counts = {}
    for key in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        values = re.findall(r'^# ' + key + r' (\d+)$', text, re.M)
        if len(values) != 1:
            raise RuntimeError('Exact original TAP totals required')
        counts[key] = int(values[0])
    expected = {'tests': len(selected) + len(excluded), 'pass': len(selected),
        'fail': 0, 'cancelled': 0, 'skipped': len(excluded), 'todo': 0}
    plans = re.findall(r'^1\.\.(\d+)$', text, re.M)
    if sorted(selected) != sorted(chunk['selected']) or len(set(excluded)) != len(excluded) or counts != expected \
            or results != list(range(1, len(results) + 1)) or plans != [str(len(results))]:
        raise RuntimeError('Selected names/counts or explicitly excluded TAP accounting differs')
    return {'counts': counts, 'selectedPassed': selected, 'excludedReportedSkipped': excluded,
        'excludedNotReported': [name for name in chunk['excluded'] if name not in excluded]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--catalogue-sha256', required=True)
    parser.add_argument('--admission', required=True, type=Path)
    parser.add_argument('--admission-sha256', required=True)
    args = parser.parse_args()
    for value in (args.catalogue_sha256, args.admission_sha256):
        if not re.fullmatch('[a-f0-9]{64}', value):
            raise RuntimeError('Exact admission hashes required')
    raw = read(CATALOGUE)
    if hashlib.sha256(raw).hexdigest() != args.catalogue_sha256:
        raise RuntimeError('Catalogue hash differs')
    plan = strict(raw)
    raw = read(args.admission, cap=16384)
    if hashlib.sha256(raw).hexdigest() != args.admission_sha256:
        raise RuntimeError('Root admission hash differs')
    admission = strict(raw)
    if set(admission) != {'schemaVersion', 'state', 'catalogueSha256', 'revision', 'grant', 'run',
            'hostDirectoryIdentity', 'hostLockIdentity', 'expiresAtEpoch', 'scope'}:
        raise RuntimeError('Exact root admission schema required')
    if admission['schemaVersion'] != 1 or admission['state'] != 'AUTHORIZED-ONCE' \
            or admission['catalogueSha256'] != args.catalogue_sha256 \
            or not re.fullmatch('[a-f0-9]{40}', admission['revision']) \
            or not re.fullmatch('[a-zA-Z0-9_.-]{1,96}', admission['grant']) \
            or not re.fullmatch('manual-resume-[a-f0-9]{32}', admission['run']) \
            or admission['scope'] != 'selected-seven-only' \
            or type(admission['expiresAtEpoch']) is not int or not time.time() < admission['expiresAtEpoch'] <= time.time() + 1800:
        raise RuntimeError('One-use current root authorization required')
    for key in ('hostDirectoryIdentity', 'hostLockIdentity'):
        if not isinstance(admission[key], list) or len(admission[key]) != 2 \
                or any(type(v) is not int or v <= 0 for v in admission[key]):
            raise RuntimeError('Root must pin current physical host directory and lock')
    # Pure file admission precedes imports; no OS/git probe or test allocation.
    installed = verify(plan)
    resource = imported(plan, 'manual_resume_owned_resources', HERE / 'manual-resume-resources.py')
    destination = RECORDS / admission['run']
    scratch = Path('/private/tmp') / ('test-stamp-shard-' + admission['run'])
    owner = resource.Controller(destination, scratch, admission['run'], plan['tools'],
        {'worktree': str(ROOT), 'directory': plan['hostDirectory'],
            'directoryIdentity': admission['hostDirectoryIdentity'],
            'lockIdentity': admission['hostLockIdentity']}, admission['grant'])
    results, failure, stamp_code = [], None, 2
    env = owner.environment()
    os.environ.clear()
    os.environ.update(env)
    os.environ['TEST_STAMP_DIR'] = str(destination / 'targeted')
    logical_command = shlex.join(['/usr/bin/python3', '-I', str(Path(__file__).resolve()),
        '--catalogue-sha256', args.catalogue_sha256, '--admission', str(args.admission),
        '--admission-sha256', args.admission_sha256])
    def git(argv, allowed=(0,)):
        rc, out, err = owner.command(['/usr/bin/git', '-C', str(ROOT), *argv], env)
        if rc not in allowed or err:
            raise RuntimeError('Bounded local Git query failed')
        return rc, out.decode('utf-8')
    try:
        # The external provisional ownership manifest and finalizer already exist.
        owner.reserve()
        if git(['rev-parse', 'HEAD'])[1].strip() != admission['revision'] \
                or git(['status', '--porcelain'])[1].strip():
            raise RuntimeError('Exact clean admitted revision required')
        stamp = imported(plan, 'manual_resume_targeted_stamp', ROOT / '_tools/test_stamp.py')
        stamp._git = lambda root, argv: git(list(argv))[1] if Path(root) == ROOT else (_ for _ in ()).throw(RuntimeError('Unexpected Git root'))
        stamp.ref_exists = lambda root, ref: git(['rev-parse', '--verify', '--quiet', ref + '^{commit}'], (0, 1))[0] == 0
        original_settings = stamp.load_settings
        def settings(root, command_override=None):
            value = original_settings(root, command_override)
            value.resources = dict(value.resources, chunk_scratch_mib=128, chunk_ram_mib=768,
                chunk_seconds=120, log_mib=2, inputs=list(plan['sources']))
            return value
        stamp.load_settings = settings
        def identity(st, parsed, modules, environment):
            verify(plan)
            return {'version': 1, 'code': stamp.working_code_key(st.root, st.is_t0),
                'environment': hashlib.sha256(json.dumps(env, sort_keys=True).encode()).hexdigest(),
                'inputs': args.catalogue_sha256, 'interpreter': [sys.executable, sys.version],
                'platform': [sys.platform, list(os.uname())], 'settings': logical_command,
                'variant': 'default', 'selected': plan['selected'], 'scope': 'targeted'}
        stamp.execution_identity = identity
        def run_command(st, command, extra, rdir, say=print, dry_run=False, args=None, identity=None):
            if dry_run or command != logical_command or extra or Path(rdir) != destination / 'targeted':
                raise RuntimeError('Only the exact admitted three-chunk command is permitted')
            started = time.monotonic()
            for number, chunk in enumerate(plan['chunks']):
                if time.time() >= admission['expiresAtEpoch'] or owner.cancelled:
                    raise RuntimeError('Admission expired or cancelled before next selected chunk')
                prefix = f'chunk-{number + 1}'
                files = {str(ROOT / rel): row for rel, row in plan['sources'].items()}
                files.update(installed['files'])
                config = destination / (prefix + '-admission.json')
                esm = destination / (prefix + '-esm.jsonl')
                cjs = destination / (prefix + '-cjs.jsonl')
                retained = sum(p.stat().st_size for pattern in ('*.tap', '*.jsonl') for p in destination.glob(pattern))
                journal_budget = 2 * MIB - retained - 65537  # TAP cap plus one overflow-evidence byte
                if journal_budget < 16384:
                    raise RuntimeError('No finite log allocation for next selected chunk')
                esm_limit = min(524288, journal_budget * 2 // 3)
                cjs_limit = min(524288, journal_budget - esm_limit)
                resource.write(config, {'files': files, 'entries': plan['entries'],
                    'parentURL': ROOT.as_uri() + '/', 'esmJournal': str(esm), 'cjsJournal': str(cjs),
                    'esmLimit': esm_limit, 'cjsLimit': cjs_limit}, cap=2 * MIB)
                child_env = dict(env, FUCQ100_COMPOSITION_CONFIG=str(config),
                    FUCQ100_COMPOSITION_CONFIG_SHA256=sha(config))
                rc, raw, error = owner.command(chunk['argv'], child_env, seconds=120,
                    cap=65536, sample=True, log=destination / (prefix + '.tap'))
                if rc or error:
                    raise RuntimeError('Selected chunk failed; no automatic retry')
                outcome = tap(raw, chunk)
                for journal in (esm, cjs):
                    if not journal.is_file() or journal.stat().st_size > 524288:
                        raise RuntimeError('Original guarded module journal missing or oversized')
                    for line in read(journal, 524288).splitlines():
                        row = strict(line)
                        if set(row) != {'path', 'sha256'} or row['path'] not in files or row['sha256'] != files[row['path']]['sha256']:
                            raise RuntimeError('Module journal contains an unadmitted identity')
                verify(plan)
                owner.logs_bounded()
                owner.account()
                results.append({'file': chunk['file'], **outcome,
                    'originalTapSha256': hashlib.sha256(raw).hexdigest(),
                    'originalTapBytes': len(raw), 'esmSha256': sha(esm), 'cjsSha256': sha(cjs)})
                resource.write(destination / 'checkpoint.json', {'state': 'partial' if len(results) < 3 else 'selected-passed-cleanup-pending',
                    'catalogueSha256': args_catalogue, 'revision': admission['revision'], 'completed': results}, cap=65536)
            return True, 7, 0, time.monotonic() - started
        args_catalogue = args.catalogue_sha256
        # Keep targeted code/variant/input stamping, but replace its shell and
        # unowned probes with this exact in-process selected core. No nested
        # supervisor, second reservation or default/full command is launched.
        stamp.run_command = run_command
        stamp_code = stamp.main(['--root', str(ROOT), '--jobs', '1', '--targeted', plan['base'],
            '--command', logical_command, '--reason', plan['reason']])
        if stamp_code or len(results) != 3 or owner.cancelled:
            raise RuntimeError('Selected seven or targeted stamping incomplete')
        verify(plan)
        if git(['rev-parse', 'HEAD'])[1].strip() != admission['revision'] or git(['status', '--porcelain'])[1].strip():
            raise RuntimeError('Admitted clean revision changed')
    except BaseException as error:
        failure = type(error).__name__ + ': ' + str(error)
    finally:
        cleanup = owner.finish()
        passed = failure is None and stamp_code == 0 and len(results) == 3 and cleanup is not None and cleanup.get('reservationAbsent') is True
        receipt = {'grant': admission['grant'], 'run': admission['run'], 'revision': admission['revision'],
            'catalogueSha256': args.catalogue_sha256, 'admissionSha256': args.admission_sha256,
            'passed': passed, 'failure': failure, 'selectedCount': sum(len(row['selectedPassed']) for row in results),
            'chunks': results, 'stampCode': stamp_code, 'cleanup': cleanup,
            'finalAccounting': owner.record.get('finalAccounting'), 'ownerManifest': str(owner.manifest)}
        resource.write(destination / 'receipt.json', receipt)
        # A postwrite file-only check fits the charge made before exact release.
        if passed and resource.allocated(destination) > owner.record['finalAccounting']['diskChargeUpperBoundBytes']:
            passed = receipt['passed'] = False
            failure = receipt['failure'] = 'Final retained output exceeds prior finite accounting'
            resource.write(destination / 'receipt.json', receipt)
        print(json.dumps({'receipt': str(destination / 'receipt.json'), 'passed': passed,
            'selectedCount': receipt['selectedCount'], 'failure': failure}))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
