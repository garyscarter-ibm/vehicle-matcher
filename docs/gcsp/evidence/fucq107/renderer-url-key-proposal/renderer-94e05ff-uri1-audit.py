"""Independent, read-only post-exit audit; writes only its bounded audit receipt.

No tests, cleanup, reservation pruning or release. Requires exact reviewed pins.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

ROOT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-085')
OUT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107')
PREFIX = 'renderer-94e05ff-cjs1-'
ADMISSION_FILE = 'renderer-94e05ff-uri1-admission.json'


def frozen_file_url(path):
    # Declared frozen paths only; journal URLs are never normalised.
    # Node preserves '@'; keep every other Path.as_uri() encoding.
    return Path(path).as_uri().replace('%40', '@')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def strict(data):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError('Duplicate JSON key')
            value[key] = item
        return value
    def constant(value):
        raise ValueError('Nonfinite JSON constant')
    return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)


def physical(path, expected):
    value, target = path.lstat(), path.stat()
    kind = 'symlink' if stat.S_ISLNK(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else None
    actual = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
        'resolved': str(path.resolve(strict=True)), 'targetDevice': target.st_dev, 'targetInode': target.st_ino}
    if kind == 'symlink':
        actual['link'] = os.readlink(path)
    if 'sha256' in expected:
        data = path.read_bytes()
        actual.update(bytes=len(data), sha256=digest(data))
    if 'entries' in expected:
        actual['entries'] = sorted(item.name for item in path.iterdir())
    require(actual == expected, 'physical:' + str(path))


CHECKS = []


def require(condition, label):
    if not condition:
        raise RuntimeError('Audit failed: ' + label)
    CHECKS.append(label)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--admission-sha', required=True)
    parser.add_argument('--run', required=True)
    args = parser.parse_args()
    require(sys.flags.isolated and sys.dont_write_bytecode and Path.cwd() == ROOT, 'isolated-owned-worktree')
    data = (OUT / ADMISSION_FILE).read_bytes()
    require(digest(data) == args.admission_sha, 'reviewed-admission')
    plan = strict(data)
    require(plan['pythonExecutable'] == sys.executable and plan['pythonVersion'] == sys.version, 'interpreter')
    for name, expected in plan['nodes'].items():
        physical(Path(name), expected)
    for path in plan['absentPaths']:
        require(not os.path.lexists(path), 'absent-resolution:' + path)
    os.environ.clear()
    os.environ.update(plan['environment'])
    run = Path(args.run)
    require(run.parent == OUT and re.fullmatch('renderer9-[a-f0-9]{32}', run.name)
        and not run.is_symlink() and run.resolve() == run, 'owned-run')
    source = strict((OUT / (PREFIX + 'source.json')).read_bytes())
    summary = strict((run / 'summary.json').read_bytes())
    execution = strict((run / 'plan.json').read_bytes())
    checkpoint = strict((run / 'checkpoint.json').read_bytes())
    manifest_path = Path(summary['manifest'])
    require(manifest_path.parent == run / 'ownership' and not manifest_path.is_symlink(), 'owned-manifest-path')
    manifest = strict(manifest_path.read_bytes())
    token = manifest['token']
    require(re.fullmatch('[a-f0-9]{32}', token) and manifest_path.name == token + '.json', 'manifest-token')
    require(summary['admissionSHA256'] == execution['admissionSHA256'] == args.admission_sha, 'execution-review-binding')
    require(summary['sourceCommit'] == execution['sourceCommit'] == source['sourceCommit'] == plan['sourceCommit'], 'source-binding')
    require(summary['owner'] == execution['owner'] == manifest['owner'], 'supervisor-identity-binding')
    require(summary['passed'] is True and summary['failure'] is None and summary['pinsPreserved'] is True, 'reported-success')
    require(summary['result']['rc'] == 0 and checkpoint['state'] == 'complete', 'completed-zero-exit')
    # Independent parsing of the original complete TAP, not summary-only counts.
    output = (run / 'output.log').read_bytes()
    text = output.decode('utf-8')
    require(not re.search(r'^not ok|^Bail out!|# (?:SKIP|TODO)', text, re.M), 'no-negative-or-skipped-TAP')
    names = re.findall(r'^ok \d+ - (.*)$', text, re.M)
    require(names == source['expectedNames'] and len(names) == 9, 'all9-original-names')
    expected_counts = {'tests': 9, 'suites': 0, 'pass': 9, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    counts = {}
    for match in re.finditer(r'^# (tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$', text, re.M):
        require(match[1] not in counts, 'unique-TAP-count:' + match[1])
        counts[match[1]] = int(match[2])
    require(counts == expected_counts == summary['result']['tests']['counts'], 'exact9-counts')
    require(names == summary['result']['tests']['names'], 'reported-names')
    require(summary['result']['tests']['output'] == {'bytes': len(output), 'sha256': digest(output)}, 'original-TAP-hash')
    journal_data = (run / 'modules.jsonl').read_bytes()
    journal = [strict(line) for line in journal_data.splitlines()]
    wanted = {row['url']: row for row in source['rows'] if row['kind'] == 'module'}
    dependencies = strict((OUT / (PREFIX + 'dependencies.json')).read_bytes())
    pinned = {frozen_file_url(row['path']): row for row in dependencies['files']}
    formats = strict((OUT / (PREFIX + 'formats.json')).read_bytes())
    hints = {frozen_file_url(row['path']): row for row in formats['rows']}
    require(len(hints) == len(formats['rows']) == 205, 'finite205-CommonJS-hints')
    def validate_format(row):
        require(set(row) == {'kind', 'url', 'sha256', 'bytes', 'format', 'inputFormat', 'formatHint'}, 'load-format-fields')
        incoming = row['inputFormat']
        nullish = incoming in [{'type': 'undefined'}, {'type': 'null'}]
        require(nullish or incoming in [{'type': 'string', 'value': value} for value in ['module', 'commonjs', 'json']], 'recorded-input-format')
        require(row['format'] in ['commonjs', 'module', 'json'], 'original-returned-format-set')
        hint = hints.get(row['url'])
        if hint is None:
            require(row['formatHint'] is None, 'no-unlisted-format-hint')
        else:
            require(row['kind'] == 'dependency-load' and row['sha256'] == hint['sha256'] and row['bytes'] == hint['bytes']
                and hint['format'] == row['format'] == 'commonjs', 'exact-pinned-CommonJS-hint')
            if nullish:
                require(row['formatHint'] == 'commonjs', 'nullish-input-received-reviewed-hint')
            else:
                require(incoming == {'type': 'string', 'value': 'commonjs'} and row['formatHint'] is None, 'explicit-CommonJS-preserved')
    package_roots = sorted([row['path'] for row in dependencies['packages']], key=len, reverse=True)
    def owning(url):
        return next((root for root in package_roots if url.startswith(frozen_file_url(root) + '/')), None)
    loads = [row for row in journal if row['kind'] == 'application-load']
    require({row['url'] for row in loads} == set(wanted) and len(wanted) == 17, 'all17-application-modules')
    for row in loads:
        validate_format(row)
        expected = wanted.get(row['url'])
        require(expected is not None and row['sha256'] == expected['sha256'] and row['bytes'] == expected['bytes']
            and row['format'] == 'module', 'every-application-load-pinned')
    paths = {row['path']: row['url'] for row in source['rows']}
    expected_edges = {(paths[row['from']], row['specifier'], row['to'] if row['to'].startswith(('node:', 'file:')) else paths[row['to']]) for row in source['edges']}
    edges = [row for row in journal if row['kind'] == 'application-resolution']
    require({(row['parentURL'], row['specifier'], row['url']) for row in edges} == expected_edges
        and len(expected_edges) == 33, 'all33-source-edges')
    require(all(row['kind'] in ['application-load', 'application-resolution', 'dependency-load', 'dependency-resolution', 'optional-miss']
        for row in journal), 'no-refused-or-unknown-imports')
    dependency_loads = [row for row in journal if row['kind'] == 'dependency-load']
    require(frozen_file_url(dependencies['entry']) in {row['url'] for row in dependency_loads}, 'exact-jsdom-entry-observed')
    for row in dependency_loads:
        validate_format(row)
        expected = pinned.get(row['url'])
        require(expected is not None and row['sha256'] == expected['sha256'] and row['bytes'] == expected['bytes']
            and row['format'] in ['commonjs', 'module', 'json'] and not row['url'].endswith('.node'), 'every-dependency-load-pinned')
    for row in journal:
        if row['kind'] not in ['dependency-resolution', 'optional-miss']:
            continue
        parent, specifier = row['parentURL'], row['specifier']
        require(parent in pinned, 'dependency-parent-pinned')
        name = '/'.join(specifier.split('/')[:2]) if specifier.startswith('@') else specifier.split('/')[0]
        declared = [edge for edge in dependencies['resolutionEdges'] if edge['from'] == owning(parent) and edge['name'] == name]
        if row['kind'] == 'optional-miss':
            require(any(not edge['required'] and edge['target'] is None for edge in declared)
                and row['code'] in ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'], 'declared-optional-miss')
            continue
        target = row['url']
        if target.startswith('node:'):
            require(specifier == target or 'node:' + specifier == target, 'builtin-resolution')
        else:
            require(target in pinned, 'dependency-target-pinned')
            require(owning(parent) == owning(target) if specifier.startswith(('.', '/', 'file:'))
                else any(edge['target'] == owning(target) for edge in declared) or
                any(package['path'] == owning(parent) == owning(target) and package['name'] == name
                    for package in dependencies['packages']), 'dependency-package-edge')
    require(summary['result']['tests']['applicationModules'] == 17 and summary['result']['tests']['edges'] == 33
        and summary['result']['tests']['dependencyModules'] == len({row['url'] for row in dependency_loads}), 'observed-module-counts')
    require(summary['result']['tests']['journal'] == {'bytes': len(journal_data), 'sha256': digest(journal_data)}, 'original-journal-hash')
    require(len(output) + len(journal_data) <= 2 * 1024 ** 2, 'combined-log-cap')
    # The single full snapshot is fail-closed. Unknown/partial observations never
    # establish death; every original identity and numeric group is checked.
    query = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat=,lstart='], capture_output=True, text=True, timeout=3)
    require(query.returncode == 0 and not query.stderr and bool(query.stdout.strip()), 'complete-process-query')
    rows = {}
    for line in query.stdout.splitlines():
        parts = line.split(None, 5)
        if len(parts) == 6:
            parts[5] = parts[5].strip()
        require(len(parts) == 6 and all(value.isascii() and value.isdigit() for value in parts[:4]), 'process-row-shape')
        pid, ppid, pgid, rss = map(int, parts[:4])
        require(pid > 0 and pgid > 0 and pid not in rows and parts[4] and parts[4][0] in 'RSDTtWXZIU'
            and all(char in '+<>AELNSsVWXl' for char in parts[4][1:]) and re.fullmatch(r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}', parts[5]), 'process-row-identity')
        rows[pid] = {'start': parts[5], 'group': pgid}
    require(os.getpid() in rows, 'audit-owner-visible')
    def absent(identity):
        require(type(identity['pid']) is int and identity['pid'] > 0, 'recorded-positive-pid')
        require(isinstance(identity.get('start'), str) and bool(identity['start'].strip()), 'recorded-start')
        current = rows.get(identity['pid'])
        if current:
            return current['start'] != identity['start']
        try:
            os.kill(identity['pid'], 0)
        except ProcessLookupError:
            return True
        return False
    require(absent(manifest['owner']), 'supervisor-exited')
    require(manifest['launchAttempted'] is True and manifest['directHandleRetained'] is True
        and manifest['registrationComplete'] is True, 'returned-handle-registered')
    require(bool(manifest['ownedPids']) and manifest['processObservations'] > 0, 'recursive-observations-present')
    for index, identity in enumerate(manifest['ownedPids']):
        require(absent(identity), 'observed-identity-absent:' + str(index))
    groups = set(manifest['groups']) | set(manifest['uncertainGroups'])
    require(groups and not any(row['group'] in groups for row in rows.values()), 'all-observed-groups-absent')
    owned_root = Path(summary['ownedRoot'])
    require(owned_root == Path('/private/tmp') / ('test-stamp-shard-' + token)
        and str(owned_root) == manifest['root'] and not os.path.lexists(owned_root), 'scratch-absent')
    require(manifest['state'] == 'removed' and manifest['finalizer']['passed'] is True, 'finalizer-removed-state')
    require(all(summary['cleanup'][key] is True for key in ['passed', 'joined', 'pidsAbsent', 'groupsAbsent', 'scratchAbsent', 'reservationAbsent']), 'cleanup-receipt')
    require(summary['result']['peakAggregateRSS'] <= 384 * 1024 ** 2 and summary['result']['peakCombinedBytes'] <= 128 * 1024 ** 2, 'aggregate-resource-caps')
    # Strict ledger read under the frozen physical lock; never write or prune it.
    directory = Path(plan['ledgerDirectory'])
    lock = directory / 'reservations.lock'
    ledger = directory / 'reservations.json'
    with lock.open('rb') as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        expected = plan['nodes'][str(lock)]
        value = os.fstat(stream.fileno())
        require((value.st_dev, value.st_ino) == (expected['device'], expected['inode']), 'locked-ledger-identity')
        physical(lock, expected)
        require(not ledger.is_symlink() and ledger.is_file(), 'regular-ledger')
        registry = strict(ledger.read_bytes())
        require(type(registry) is dict, 'ledger-object')
        for key, row in registry.items():
            require(isinstance(key, str) and bool(key) and type(row) is dict and set(row) == {'owner', 'disk', 'ram', 'used', 'rss', 'parent', 'root'}, 'ledger-row-schema')
            owner = row['owner']
            require(type(owner) is dict and set(owner) == {'pid', 'start'} and type(owner['pid']) is int and owner['pid'] > 0
                and isinstance(owner['start'], str) and re.fullmatch(r'[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}', owner['start']), 'ledger-owner-schema')
            require(all(type(row[field]) is int and row[field] >= 0 for field in ['disk', 'ram', 'used', 'rss']), 'ledger-accounting-schema')
            require(row['root'] is None or isinstance(row['root'], str) and Path(row['root']).is_absolute(), 'ledger-root-schema')
            seen, parent = {key}, row['parent']
            while parent is not None:
                require(isinstance(parent, str) and parent in registry and parent not in seen, 'ledger-valid-ancestry')
                seen.add(parent)
                parent = registry[parent]['parent']
        require(token not in registry and not any(row['parent'] == token for row in registry.values()), 'reservation-and-descendants-absent')
    # Execute only the already admitted git helper bytes for immutable readback.
    path = ROOT / '_tools/scaffold_git.py'
    helper = path.read_bytes()
    require(digest(helper) == plan['nodes'][str(path)]['sha256'], 'git-helper-before-import')
    spec = importlib.util.spec_from_file_location('fucq107_audit_git', path)
    sg = importlib.util.module_from_spec(spec)
    exec(compile(helper, str(path), 'exec'), sg.__dict__)
    for row in source['rows']:
        rc, content, error = sg.git(ROOT, ['show', source['sourceCommit'] + ':' + row['path']])
        require(rc == 0 and digest(content.encode()) == row['sha256'] and len(content.encode()) == row['bytes'], 'immutable-source:' + row['path'])
    retained = 0
    for folder, dirs, files in os.walk(OUT, followlinks=False):
        for name in dirs + files:
            value = (Path(folder) / name).lstat()
            retained += max(value.st_size, value.st_blocks * 512)
    require(retained <= 128 * 1024 ** 2 - 64 * 1024, 'whole-story-retention-with-audit-headroom')
    receipt = {'passed': True, 'checks': len(CHECKS), 'admissionSHA256': args.admission_sha,
        'sourceCommit': source['sourceCommit'], 'originalCounts': counts, 'originalNames': names,
        'originalTAPSHA256': digest(output), 'originalJournalSHA256': digest(journal_data),
        'observedPids': manifest['ownedPids'], 'groups': sorted(groups), 'ownedRootAbsent': str(owned_root),
        'supervisorAbsent': manifest['owner'], 'reservationAbsent': token, 'retainedBeforeAuditBytes': retained}
    target = run / 'parent-audit.json'
    encoded = (json.dumps(receipt, indent=2) + '\n').encode()
    require(len(encoded) < 32 * 1024, 'bounded-audit-receipt')
    with target.open('xb') as stream:
        stream.write(encoded)
    print(json.dumps({'passed': True, 'checks': len(CHECKS), 'audit': str(target), 'sha256': digest(encoded)}))


if __name__ == '__main__':
    main()
