#!/usr/bin/env python3
"""Execute only the reviewed FUCQ-70 six-case proof; a fresh process can audit its receipt."""
import argparse
import atexit
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[4]
SHARED = ROOT.parents[2]
EVIDENCE = ROOT / 'docs/gcsp/evidence/fucq70'
HARNESS = EVIDENCE / 'service-proof-harness.json'
MIB = 1024 ** 2


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(MIB), b''):
            value.update(block)
    return value.hexdigest()


def fingerprint(path):
    path = Path(path)
    resolved = path.resolve(strict=True)
    st = resolved.stat()
    return {'path': str(path), 'resolved': str(resolved), 'device': st.st_dev, 'inode': st.st_ino,
            'sha256': digest(resolved), 'symlink': path.is_symlink()}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_plan(expected):
    if not re.fullmatch(r'[a-f0-9]{64}', expected) or digest(HARNESS) != expected:
        raise RuntimeError('Reviewed harness digest does not match; no execution')
    plan = json.loads(HARNESS.read_text())
    for name, expected_value in {'workers': 1, 'wallSeconds': 120, 'rssBytes': 768 * MIB,
                                 'scratchBytes': 128 * MIB, 'logBytes': 2 * MIB}.items():
        if plan['limits'][name] != expected_value:
            raise RuntimeError('Unreviewed resource limits')
    if plan['root'] != str(ROOT) or plan['sharedRoot'] != str(SHARED):
        raise RuntimeError('Harness belongs to a different checkout')
    registration = plan['loaderRegistration']
    if registration != {'url': (EVIDENCE / 'actual66-loader.mjs').as_uri(),
                         'parentUrl': ROOT.as_uri() + '/',
                         'sha256': digest(EVIDENCE / 'actual66-loader.mjs')}:
        raise RuntimeError('Unreviewed loader registration edge')
    for item in plan['ownedFiles'] + plan['runtimeTools']:
        if digest(item['path']) != item['sha256']:
            raise RuntimeError('Reviewed harness/tool changed: ' + item['path'])
    if fingerprint(plan['node']['path']) != plan['node']:
        raise RuntimeError('Reviewed Node binary identity changed')
    if digest(EVIDENCE / 'service-proof-inputs.json') != plan['sourceManifestSha256']:
        raise RuntimeError('Reviewed application source manifest changed')
    if digest(EVIDENCE / 'service-proof-dependencies.json') != plan['dependencyManifestSha256']:
        raise RuntimeError('Reviewed installed dependency manifest changed')
    return plan


def source_snapshot(plan, git):
    inputs = json.loads((EVIDENCE / 'service-proof-inputs.json').read_text())
    dependency = json.loads((EVIDENCE / 'service-proof-dependencies.json').read_text())
    snapshot, blobs = {}, {}
    for row in inputs['modules']:
        if row['resolution'] == 'scratch-byte-copy':
            blob = git.show(ROOT, row['ref'], row['path']).encode('utf8')
            actual = hashlib.sha256(blob).hexdigest()
            if actual != row['sha256']:
                raise RuntimeError('Immutable producer source mismatch: ' + row['path'])
            snapshot[row['path']] = {'ref': row['ref'], 'sha256': actual, 'kind': 'immutable-git-blob'}
            blobs[row['path']] = blob
        else:
            actual = fingerprint(ROOT / row['path'])
            if actual['sha256'] != row['sha256']:
                raise RuntimeError('Application source changed: ' + row['path'])
            snapshot[row['path']] = actual
    for row in inputs['fileInputs']:
        actual = fingerprint(ROOT / row['path'])
        if actual['sha256'] != row['sha256']:
            raise RuntimeError('Application data/config changed: ' + row['path'])
        snapshot[row['path']] = actual
    for row in dependency['files']:
        actual = fingerprint(row['path'])
        if any(actual[key] != row[key] for key in ('device', 'inode', 'sha256')):
            raise RuntimeError('Installed dependency identity changed: ' + row['path'])
        snapshot[row['path']] = actual
    for package in dependency['packages']:
        for name, expected in package['dependencies'].items():
            cursor = Path(package['path'])
            resolved = None
            while cursor == SHARED or SHARED in cursor.parents:
                candidate = cursor / 'node_modules' / name
                if (candidate / 'package.json').is_file():
                    resolved = str(candidate.resolve())
                    break
                cursor = cursor.parent
            if resolved != expected:
                raise RuntimeError('Installed package resolution changed: ' + name)
    pg = Path(inputs['externalDependency']['directory'])
    stat = pg.stat()
    if (stat.st_dev, stat.st_ino) != (inputs['externalDependency']['directoryIdentity']['device'], inputs['externalDependency']['directoryIdentity']['inode']):
        raise RuntimeError('Installed pg directory changed')
    for row in plan['ownedFiles'] + plan['runtimeTools']:
        snapshot[row['path']] = fingerprint(row['path'])
    snapshot['node-binary'] = fingerprint(plan['node']['path'])
    snapshot['harness-manifest'] = fingerprint(HARNESS)
    return snapshot, blobs, inputs, dependency


def clean_environment():
    # An allowlist strips DB aliases, debug/inspector options, preload variables and credentials.
    allowed = {'PATH', 'LANG', 'LC_ALL', 'TZ'}
    env = {key: value for key, value in os.environ.items() if key in allowed}
    env['TZ'] = 'UTC'
    return env, sorted(key for key in os.environ if key not in allowed)


def process_rows():
    probe = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat='],
                           capture_output=True, text=True, timeout=3, check=True)
    if probe.stderr or not probe.stdout.strip():
        raise RuntimeError('Process ownership snapshot unavailable')
    rows = []
    for line in probe.stdout.splitlines():
        fields = line.split()
        if len(fields) != 5 or not all(value.isascii() and value.isdigit() for value in fields[:4]):
            raise RuntimeError('Process ownership snapshot malformed')
        rows.append({'pid': int(fields[0]), 'ppid': int(fields[1]), 'pgid': int(fields[2]),
                     'rss': int(fields[3]) * 1024, 'stat': fields[4]})
    return rows


def absent(resources, record):
    groups = all(resources.group_has_live_members(pgid) is False for pgid in record.get('groups', []))
    pids = all(resources.process_identity(row['pid']) in (None,) or resources.process_identity(row['pid']) != row['start']
               for row in record.get('owned_pids', []))
    return groups, pids


def bounded_redaction(raw):
    text = raw.decode('utf8', errors='replace')
    text = re.sub(r'(?i)(gcsp_(?:session|presenter)=)[^;\s]+', r'\1[redacted]', text)
    text = re.sub(r'(?i)(?:postgres(?:ql)?://)[^\s]+', '[redacted-db-url]', text)
    text = re.sub(r'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])', '[redacted-opaque]', text)
    return text.encode('utf8')[-2 * MIB:]


def log_tail(path):
    with Path(path).open('rb') as stream:
        stream.seek(max(0, Path(path).stat().st_size - 2 * MIB))
        return stream.read(2 * MIB)


def counts(text):
    result = {}
    for name in ('tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'):
        found = re.findall(r'(?m)^#\s+' + name + r'\s+(\d+)\s*$', text)
        if found:
            result[name] = int(found[-1])
    return result


def audit(receipt_path):
    records = SHARED / '.claude/test-runs/fucq70/actual66'
    receipt_path = Path(receipt_path).resolve(strict=True)
    receipt_path.relative_to(records.resolve())
    receipt = json.loads(receipt_path.read_text())
    if receipt.get('kind') != 'fucq70-actual66-receipt-v1':
        raise RuntimeError('Not an owned FUCQ-70 proof receipt')
    resource_path = str(SHARED / '_tools/test_resources.py')
    if fingerprint(resource_path) != receipt['afterLocalFiles'].get(resource_path):
        raise RuntimeError('Independent audit resource helper identity changed')
    resources = load_module('fucq70_audit_resources', SHARED / '_tools/test_resources.py')
    groups, pids = absent(resources, receipt['ownership'])
    host = resources.HostBudget(resources.Policy(), directory=Path.home() / '.cache/agent-scaffolding/test-resources')
    unchanged = bool(receipt.get('afterLocalFiles')) and receipt.get('sourceUnchanged') is True and all(
        fingerprint(path) == previous for path, previous in receipt['afterLocalFiles'].items())
    result = {'receipt': str(receipt_path), 'independentAuditProcess': resources.owner(),
              'scratchAbsent': not os.path.lexists(receipt['scratch']), 'groupsAbsent': groups,
              'pidsAbsent': pids, 'reservationAbsent': receipt['token'] not in (resources.read_json(host.path, {}) or {}),
              'sourceAndDependenciesStillMatch': unchanged, 'proofPassed': receipt.get('passed', False)}
    result['cleanupVerified'] = all(result[name] for name in ('scratchAbsent', 'groupsAbsent', 'pidsAbsent', 'reservationAbsent', 'sourceAndDependenciesStillMatch'))
    resources.atomic_json(receipt_path.with_name('independent-cleanup-audit.json'), result)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['cleanupVerified'] else 2


def run(expected_commit, expected_harness):
    plan = read_plan(expected_harness)
    resources = load_module('fucq70_actual66_resources', SHARED / '_tools/test_resources.py')
    git = load_module('fucq70_actual66_git', SHARED / '_tools/scaffold_git.py')
    git.ATTRIBUTION = 'Co-Authored-By: Codex <noreply@openai.com>'
    rc, head, error = git.git(ROOT, ['rev-parse', 'HEAD'])
    if rc or head.strip() != expected_commit or not re.fullmatch(r'[a-f0-9]{40}', expected_commit):
        raise RuntimeError('Exact published harness commit required')
    before, blobs, inputs, dependency = source_snapshot(plan, git)
    policy = resources.Policy({'chunk_scratch_mib': 128, 'chunk_ram_mib': 768, 'chunk_seconds': 120, 'log_mib': 2})
    host = resources.HostBudget(policy, directory=Path.home() / '.cache/agent-scaffolding/test-resources')
    token = plan['runToken']; records = Path(plan['records']); scratch_root = Path(plan['scratch'])
    if not re.fullmatch(r'[a-f0-9]{32}', token) or scratch_root != Path('/private/tmp') / ('test-stamp-shard-' + token):
        raise RuntimeError('Unreviewed scratch identity')
    if os.path.lexists(scratch_root) or records.exists():
        raise RuntimeError('Run already has resources/evidence: preserve it for review; do not overwrite or rerun')
    records.resolve().relative_to((SHARED / '.claude/test-runs/fucq70/actual66').resolve())
    env, stripped = clean_environment()
    identity = {'commit': expected_commit, 'harness': expected_harness, 'source': resources.digest(before), 'selection': plan['caseNames']}
    checkpoint = resources.Checkpoint(records, identity, [{'id': 'six-case-actual66-proof'}], resume=False)
    checkpoint.save()
    resources.atomic_json(records / 'source-before.json', before)
    resources.atomic_json(records / 'launch-plan.json', {**plan, 'headroom': host.headroom(ROOT),
                          'environmentKeysRetained': sorted(env), 'environmentNamesStripped': stripped,
                          'pythonVersion': sys.version, 'identity': identity, 'allocation': 'not-started'})
    impact = SHARED / '.claude/test-runs/impact/fucq70-actual66-proof.json'
    resources.atomic_json(impact, {'identity': identity, 'source': before, 'selectedCommand': plan['nodeArgv'],
                          'selectedCases': plan['caseNames'], 'fixtureEdges': ['genuine-issued identities', 'manual context seed', 'synthetic exact released stock', 'canonical PolicyService', 'controlled external stock protocol'],
                          'excluded': inputs['prohibited'], 'basis': 'Exact reviewed service/controller protocol proof; ordinary suites/native/browser/listener not admitted.'})
    ownership = None

    class OwnedScratch(resources.Scratch):
        def child(self, process):
            super().child(process)
            start = resources.process_identity(process.pid)
            if start:
                self.record.setdefault('owned_pids', []).append({'pid': process.pid, 'start': start, 'pgid': process.pid})
            resources.atomic_json(self.manifest, self.record)

        def __exit__(self, kind, value, traceback):
            group_absent, pid_absent = absent(resources, self.record)
            if not group_absent or not pid_absent:
                raise resources.ResourceError('Owned processes uncertain/live; preserve scratch and reservation for review')
            return super().__exit__(kind, value, traceback)

    scratch = OwnedScratch(records, ROOT, policy, expected=2 * MIB, checkpoint=checkpoint.path)
    scratch.token = token; scratch.root = scratch_root; scratch.manifest = records / 'ownership' / (token + '.json')
    scratch.record.update(token=token, root=str(scratch_root))
    ownership = scratch.record
    resources.atomic_json(scratch.manifest, ownership)  # External manifest precedes allocation.
    sampled = []; child_result = None; issue = None; test_counts = {}; journal = []; after = {}; copy_after = {}; raw = b''
    runtime_before = {}; runtime_after = {}
    started = time.monotonic(); original_stop = resources.stop_group

    def sample_tree(pgid):
        rows = process_rows(); selected = {row['pid'] for row in rows if row['pgid'] == pgid}
        selected.update(row['pid'] for row in ownership.get('owned_pids', [])
                        if resources.process_identity(row['pid']) == row['start'])
        while True:
            expanded = selected | {row['pid'] for row in rows if row['ppid'] in selected}
            if expanded == selected:
                break
            selected = expanded
        members = [row for row in rows if row['pid'] in selected]
        for row in members:
            if not any(prior['pid'] == row['pid'] for prior in ownership.get('owned_pids', [])):
                start = resources.process_identity(row['pid'])
                if start:
                    ownership.setdefault('owned_pids', []).append({'pid': row['pid'], 'start': start, 'pgid': row['pgid']})
        for group in {row['pgid'] for row in members}:
            if any(row['pgid'] == group and row['pid'] not in selected for row in rows):
                raise RuntimeError('Descendant entered a shared group; no broad cleanup permitted')
            if group not in ownership['groups']:
                ownership['groups'].append(group)
        resources.atomic_json(scratch.manifest, ownership)
        supervisor_rss = sum(row['rss'] for row in rows if row['pid'] == os.getpid())
        rss = sum(row['rss'] for row in members) + supervisor_rss
        sampled.append({'seconds': time.monotonic() - started, 'rss': rss, 'supervisorRss': supervisor_rss, 'pids': len(members)})
        return rss

    def stop_owned(process):
        original_stop(process)  # Stops and joins the session started by run_process.
        for group in ownership['groups']:
            if group == process.pid:
                continue
            for sig in (signal.SIGTERM, signal.SIGKILL):
                if resources.group_has_live_members(group) is False:
                    break
                rows = [row for row in process_rows() if row['pgid'] == group and not row['stat'].startswith('Z')]
                known = {row['pid'] for row in ownership.get('owned_pids', []) if resources.process_identity(row['pid']) == row['start']}
                if any(row['pid'] not in known for row in rows):
                    raise RuntimeError('Group membership changed; preserve uncertain ownership')
                try:
                    os.killpg(group, sig)
                except ProcessLookupError:
                    break
                time.sleep(0.05)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if all(absent(resources, ownership)):
                return
            time.sleep(0.1)
        raise RuntimeError('Owned process absence not established')

    resources.group_rss = sample_tree; resources.stop_group = stop_owned

    def finalizer():
        groups, pids = absent(resources, ownership)
        if groups and pids and not os.path.lexists(scratch_root):
            if token in (resources.read_json(host.path, {}) or {}):
                host.release(token)

    atexit.register(finalizer)
    try:
        with resources.handled_termination():
            allocation = host.acquire(token, 128 * MIB, 768 * MIB, ROOT, root=scratch_root,
                                      minimum_disk=128 * MIB, minimum_ram=768 * MIB)
            with scratch:
                runtime_modules = []
                for row in inputs['modules']:
                    source = ROOT / row['path']
                    target = scratch_root / row['path'] if row['path'] in blobs else source
                    if row['path'] in blobs:
                        target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(blobs[row['path']])
                    runtime_modules.append({**row, 'url': target.as_uri(), 'originalUrl': source.as_uri()})
                (scratch_root / 'package.json').write_text('{"type":"module"}\n')
                probe = plan['probe']; probe_row = {'path': probe['relativePath'], 'url': Path(probe['path']).as_uri(),
                                                   'sha256': probe['sha256'], 'imports': probe['imports']}
                config = {'kind': 'fucq70-actual66-exact-loader-v2', 'modules': runtime_modules, 'probe': probe_row,
                          'loaderRegistration': plan['loaderRegistration'],
                          'dependencies': dependency['files'], 'pgEntry': dependency['entry'],
                          'pgImporters': dependency['applicationImporters'], 'journal': str(scratch_root / 'imports.ndjson')}
                resources.atomic_json(scratch_root / 'loader-config.json', config)
                runtime_before = {name: digest(scratch_root / name) for name in ('package.json', 'loader-config.json')}
                env['FUCQ70_PROOF_CONFIG'] = str(scratch_root / 'loader-config.json')
                try:
                    child_result = resources.run_process(plan['nodeArgv'], ROOT, env, scratch_root / 'raw.log', scratch,
                                                         policy, allocation['disk'], allocation['ram'], 120, host)
                finally:
                    if (scratch_root / 'raw.log').is_file():
                        raw = log_tail(scratch_root / 'raw.log')
                    copy_after = {path: digest(scratch_root / path) for path in blobs}
                    runtime_after = {name: digest(scratch_root / name) for name in runtime_before}
                    resources.atomic_json(records / 'copied-source-after.json', copy_after)
                    if (scratch_root / 'imports.ndjson').is_file():
                        for line in (scratch_root / 'imports.ndjson').read_text().splitlines():
                            journal.append(json.loads(line))
                        resources.atomic_json(records / 'observed-imports.json', {'entries': journal,
                                              'commonJsBoundary': dependency['commonJsBoundary']})
                text = raw.decode('utf8', errors='replace'); test_counts = counts(text)
                if child_result['rc'] or child_result['issue']:
                    raise RuntimeError('Node proof process failed before acceptance: rc=' + str(child_result['rc'])
                                       + '; see bounded failure log and observed-imports when present')
                expected = {row['path'] for row in inputs['modules']}
                observed = {row['path'] for row in journal if row.get('stage') == 'load'} & expected
                if observed != expected:
                    raise RuntimeError('Observed application import graph differs from reviewed graph')
                if copy_after != {path: hashlib.sha256(blob).hexdigest() for path, blob in blobs.items()}:
                    raise RuntimeError('Copied producer source changed')
                if runtime_before != runtime_after:
                    raise RuntimeError('Owned runtime configuration changed')
                if 'FUCQ70_SETUPS=8' not in text:
                    raise RuntimeError('Eight actual runtime setups were not observed')
                resources.atomic_json(records / 'observed-imports.json', {'entries': journal, 'applicationModules': sorted(observed),
                                      'commonJsBoundary': dependency['commonJsBoundary']})
                if child_result['rc'] or child_result['issue'] or test_counts != {'tests': 6, 'pass': 6, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}:
                    raise RuntimeError('Actual source/protocol proof failed; preserve checkpoint without bypass')
    except BaseException as error:
        issue = type(error).__name__ + ': ' + str(error)
    finally:
        # Preserve bounded failures before scratch disappears, including pre-result failures.
        raw_log = scratch_root / 'raw.log'
        if issue and (raw or raw_log.is_file()):
            (records / 'failure.log').write_bytes(bounded_redaction(raw if raw else log_tail(raw_log)))
        try:
            after, _, _, _ = source_snapshot(plan, git)
            resources.atomic_json(records / 'source-after.json', after)
            if after != before:
                issue = issue or 'Admitted source/dependency identity changed'
        except BaseException as error:
            issue = issue or 'Post-run source journal failed: ' + type(error).__name__ + ': ' + str(error)
        finalizer()
        groups, pids = absent(resources, ownership)
        cleanup = {'scratchAbsent': not os.path.lexists(scratch_root), 'groupsAbsent': groups, 'pidsAbsent': pids,
                   'reservationAbsent': token not in (resources.read_json(host.path, {}) or {})}
        if not all(cleanup.values()):
            issue = issue or 'Resource cleanup incomplete; preserve named ownership for independent review'
        passed = issue is None and child_result is not None and child_result['rc'] == 0
        if child_result is not None:
            child_result['log'] = str(records / 'failure.log') if (records / 'failure.log').exists() else None
        local_after = {row['path']: row for row in after.values() if isinstance(row, dict) and 'resolved' in row}
        receipt = {'kind': 'fucq70-actual66-receipt-v1', 'identity': identity, 'passed': passed,
                   'issue': issue, 'tests': test_counts, 'result': child_result, 'scratch': str(scratch_root), 'token': token,
                   'ownership': ownership, 'cleanup': cleanup, 'sourceUnchanged': after == before,
                   'afterLocalFiles': local_after, 'copiedProducerHashes': copy_after, 'processSamples': sampled,
                   'loaderDiagnostics': [row for row in journal if row.get('stage') in
                                         ('reject', 'resolve-loader-registration', 'load-loader-registration')],
                   'runtimeInputHashesBefore': runtime_before, 'runtimeInputHashesAfter': runtime_after,
                   'wallSeconds': time.monotonic() - started, 'selectedCommand': plan['nodeArgv'],
                   'retainedFailureLog': str(records / 'failure.log') if (records / 'failure.log').exists() else None}
        resources.atomic_json(records / 'receipt.json', receipt)
        checkpoint.data.update(state='complete' if passed else 'incomplete', issues=[] if passed else [issue])
        if passed:
            checkpoint.completed(['six-case-actual66-proof'], {'receipt': str(records / 'receipt.json')})
        checkpoint.save()
        print(json.dumps({'passed': passed, 'tests': test_counts, 'issue': issue, 'cleanup': cleanup,
                          'receipt': str(records / 'receipt.json')}, sort_keys=True))
    return 0 if passed else 2


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    launch = sub.add_parser('run'); launch.add_argument('--commit', required=True); launch.add_argument('--harness-sha256', required=True)
    check = sub.add_parser('audit'); check.add_argument('--receipt', required=True)
    args = parser.parse_args()
    try:
        sys.exit(run(args.commit, args.harness_sha256) if args.mode == 'run' else audit(args.receipt))
    except Exception as error:
        print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
        sys.exit(2)
