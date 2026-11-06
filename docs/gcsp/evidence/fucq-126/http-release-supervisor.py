#!/usr/bin/env python3
"""Future six-case launcher. Refuses incomplete/unadmitted manifests before allocation."""
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for data in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(data)
    return value.hexdigest()


def main(manifest_path):
    plan = json.loads(Path(manifest_path).read_text())
    if plan.get('executionAuthorized') is not True or plan.get('executionReady') is not True:
        raise RuntimeError('Source authoring is not execution admission.')
    root = Path(plan['candidateRoot']).resolve()
    if len(plan['caseNames']) != 6 or len(set(plan['caseNames'])) != 6:
        raise RuntimeError('Freeze six distinct exact case names.')
    files = {str((root / row['path']).resolve()): row for row in plan['files']}

    def verify_sources():
        same = all((root / row['path']).is_file()
                   and str((root / row['path']).resolve()) == row['target']
                   and (root / row['path']).stat().st_size == row['bytes']
                   and sha(root / row['path']) == row['sha256'] for row in plan['files'])
        for entry in plan['directories']:
            folder = root / entry['path']
            members = list(folder.rglob('*'))
            if any(p.is_symlink() and p.is_dir() for p in members):
                return False
            if sorted(str(p.relative_to(folder)) for p in members if p.is_file()) != entry['files']:
                return False
        for entry in plan.get('absentFiles', []):
            if os.path.lexists(root / entry):
                return False
        node_identity = plan['node']
        node_path = Path(node_identity['path'])
        if str(node_path.resolve()) != node_identity['target'] or sha(node_path) != node_identity['sha256']:
            return False
        for link in plan['dependencyLinks']:
            path = root / link['path']; current = path.lstat()
            if (str(path.resolve()), current.st_dev, current.st_ino) != (link['target'], link['device'], link['inode']):
                return False
        return same

    def frozen(name):
        path = (root / plan[name]).resolve()
        if str(path) not in files:
            raise RuntimeError('Unpinned launcher/input: ' + name)
        return path

    # Verify helper bytes before importing them; filesystem reads are statically classified, not observed.
    if not verify_sources():
        raise RuntimeError('Frozen candidate source/dependency bytes do not match.')
    resource_path, guard_path = frozen('resourceHelper'), frozen('childGuard')
    test_path = frozen('caseFile')
    classification = plan.get('readClassification', {})
    if classification.get('method') != 'finite-static-source-review' or classification.get('filesystemReadsObserved') is not False:
        raise RuntimeError('Require the explicit bounded static read classification.')
    if not classification.get('sites') or classification.get('unclassifiedSites') != []:
        raise RuntimeError('Classify every enumerated product read/dynamic-import site before launch.')
    if frozen('supervisor') != Path(__file__).resolve():
        raise RuntimeError('This supervisor is not the frozen launcher.')
    node = Path(plan['node']['path'])
    if str(node.resolve()) != plan['node']['target'] or sha(node) != plan['node']['sha256']:
        raise RuntimeError('Node identity changed.')
    for name in plan['profileFiles']:
        frozen_profile = (root / name).resolve()
        if str(frozen_profile) not in files:
            raise RuntimeError('Source profile input is unpinned.')

    def load(name, path):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec); sys.modules[name] = module
        spec.loader.exec_module(module)
        return module

    R = load('fucq126_resources', resource_path)
    guard = load('fucq126_child_guard', guard_path)
    policy = R.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120, 'log_mib': 2,
                       'local_scratch_reason': 'Bounded macOS Node IPC and V8 module observations.'})
    host = R.HostBudget(policy)
    output = Path(plan['outputRoot'])
    if not output.is_absolute() or not output.name.startswith('fucq126-') or output.exists():
        raise RuntimeError('Require a fresh explicit owned FUCQ-126 output root.')
    output_owner = output.parent / 'ownership' / (output.name + '.json')
    if output_owner.exists():
        raise RuntimeError('Preserve existing ownership evidence.')
    R.atomic_json(output_owner, {'version': 1, 'owner': R.owner(), 'root': str(output),
                                'expectedBytes': 4 * R.MIB, 'state': 'planned', 'manifest': str(Path(manifest_path).resolve())})
    output.mkdir()
    receipt = output / 'receipt.json'
    ownership = {'phase': 'not-launched'}; entered = reserved = attempted = False; outcome = {}; failure = None
    scratch = R.Scratch(output, root, policy, expected=124 * R.MIB, checkpoint=receipt)
    R.atomic_json(receipt, {'state': 'planned', 'health': host.headroom(root), 'cases': plan['caseNames'], 'child': ownership})
    with R.handled_termination():
        try:
            scratch.__enter__(); entered = True
            host.acquire(scratch.token, 128 * R.MIB, 768 * R.MIB, root, root=scratch.root); reserved = True
            env = scratch.env(os.environ)
            for key in list(env):
                if key.startswith(('PG', 'NODE_', 'NPM_', 'npm_', 'GCSP_')) or re.search(r'(DATABASE|POSTGRES|DB|SQL).*URL', key, re.I):
                    env.pop(key, None)
            env.update(NODE_V8_COVERAGE=str(scratch.root / 'coverage'),
                       GCSP_VEHICLE_EVIDENCE_ROOT=str(root / plan['vehicleEvidenceRoot']),
                       TEST_RESOURCE_PARENT_RESERVATION=scratch.token)
            command = [str(node), '--test', '--test-concurrency=1', '--test-reporter=tap', str(test_path)]
            log = scratch.root / 'original.tap'; started = time.monotonic(); peak_rss = 0

            def register(process, record):
                scratch.record.setdefault('childIdentities', []).append({'pid': record['pid'], 'start': record['start']})
                scratch.child(process)
                R.atomic_json(receipt, {'state': 'running', 'command': command, 'child': record})

            def absent(process, record):
                return not R.process_alive({'pid': record['pid'], 'start': record.get('start')}) \
                    and R.group_has_live_members(record['pgid']) is False

            attempted = True
            with log.open('w') as stream:
                with guard.cancellation_safe_child(command, ownership=ownership, identify=R.process_identity,
                        register=register, stop_join=R.stop_group, verify_absent=absent,
                        cwd=root, env=env, stdout=stream, stderr=stream) as process:
                    while process.poll() is None:
                        used = scratch.sample(); rss = R.group_rss(process.pid); peak_rss = max(peak_rss, rss)
                        host.update(scratch.token, used, rss)
                        if used > 124 * R.MIB or used + R.allocated_bytes(output) > 128 * R.MIB or rss > 768 * R.MIB \
                                or time.monotonic() - started > 120 or log.stat().st_size > 2 * R.MIB:
                            raise RuntimeError('Owned combined disk/RAM/time/log limit exceeded.')
                        if shutil.disk_usage(scratch.root).free < policy.reserve:
                            raise RuntimeError('Emergency free-space reserve reached.')
                        time.sleep(0.2)
            if not ownership.get('cleanupVerified'):
                raise RuntimeError('Actual handle cleanup is unverified.')
            if log.stat().st_size > 2 * R.MIB or scratch.sample() > 124 * R.MIB \
                    or scratch.sample() + R.allocated_bytes(output) > 128 * R.MIB:
                raise RuntimeError('Final log/combined allocation exceeded its bound.')
            tap = log.read_text()
            names = re.findall(r'^# Subtest: (.+)$', tap, re.M)
            totals = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$', tap, re.M)}
            if names != plan['caseNames'] or totals != {'tests': 6, 'pass': 6, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}:
                raise RuntimeError('Actual TAP names/counts do not establish the selected six-case result.')
            observed = set()
            for file in (scratch.root / 'coverage').glob('*.json'):
                for script in json.loads(file.read_text()).get('result', []):
                    if script['url'].startswith('file:'):
                        observed.add(str(Path(unquote(urlparse(script['url']).path)).resolve()))
            required_modules = {str((root / path).resolve()) for path in ['server/index.js', 'server/gcsp/runtime.js',
                'server/gcsp/stock/index.js', 'blocks/gcsp/presenter-controls/controls.js',
                'blocks/gcsp/presenter-controls/http-adapter.js', 'server/test/helpers/presenter-http-proof.js']}
            if not required_modules.issubset(observed) or observed - files.keys():
                raise RuntimeError('Required actual modules unobserved or product/dependency closure unpinned.')
            if not verify_sources():
                raise RuntimeError('Candidate source changed during execution.')
            (output / 'original.tap').write_text(tap)
            outcome = {'rc': process.returncode, 'names': names, 'totals': totals, 'tapSha256': sha(log),
                       'modules': sorted(observed), 'filesystemReadsObserved': False,
                       'readClassification': classification, 'wallSeconds': time.monotonic() - started,
                       'peakRss': peak_rss, 'peakScratch': scratch.record['peak']}
            if process.returncode != 0 or R.allocated_bytes(output) > 4 * R.MIB:
                raise RuntimeError('Command failed or retained-output allowance exceeded.')
        except BaseException as error:
            failure = type(error).__name__ + ': ' + str(error)
            # Keep useful bounded failure output when safely accessible; never delete on uncertain ownership.
            if entered and (scratch.root / 'original.tap').is_file():
                with (scratch.root / 'original.tap').open('rb') as stream:
                    stream.seek(max(0, (scratch.root / 'original.tap').stat().st_size - 2 * R.MIB))
                    (output / 'failure.tap').write_bytes(stream.read(2 * R.MIB))
        finally:
            safe = not attempted or ownership.get('phase') in ['not-launched', 'no-child-created'] or ownership.get('cleanupVerified') is True
            if entered and safe:
                try:
                    scratch.__exit__(None, None, None)
                    if reserved:
                        host.release(scratch.token); reserved = False
                except BaseException as error:
                    failure = 'Cleanup: ' + type(error).__name__ + ': ' + str(error)
            elif entered:
                failure = 'Cleanup issue: actual local child handle/group not verified; scratch/reservation retained. ' + str(failure)
            source_same = verify_sources()
            if not source_same:
                failure = 'Final candidate identity changed. ' + str(failure)
            result = {'state': 'passed' if not failure and outcome.get('rc') == 0 else 'failed', 'failure': failure,
                      'child': ownership, 'result': outcome, 'scratchManifest': str(scratch.manifest),
                      'scratchAbsent': not os.path.lexists(scratch.root), 'reservationReleased': not reserved,
                      'sourceUnchanged': source_same, 'independentAuditRequired': True,
                      'retention': 'Audit bounded original.tap names/counts, then remove successful verbose log; retain concise receipt.'}
            if len(json.dumps(result).encode()) + R.allocated_bytes(output) > 4 * R.MIB:
                result.update(state='failed', failure='Retained output would exceed its bound.', result={})
            R.atomic_json(receipt, result)
            R.atomic_json(output_owner, {'version': 1, 'owner': R.owner(), 'root': str(output),
                'state': 'retained-summary-awaiting-audit', 'receipt': str(receipt), 'child': ownership})
            print(json.dumps({'state': result['state'], 'receipt': str(receipt), 'failure': failure}))
    return 0 if result['state'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1]))
