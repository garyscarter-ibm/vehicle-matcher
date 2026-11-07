"""Author-only stdlib metadata freeze; never imports custom helpers or launches.

No OS process probe, ledger mutation, resource reservation, scratch or tests.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-085')
OUT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq107')
PREFIX = 'controller-94e05ff-'
SOURCE_COMMIT = '94e05ff9070aa19f5deb3e9997dfed96cc268473'


def identity(path, content=True):
    value, followed = path.lstat(), path.stat()
    kind = 'symlink' if stat.S_ISLNK(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else None
    if kind is None:
        raise RuntimeError('Special file refused: ' + str(path))
    row = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
        'resolved': str(path.resolve(strict=True)), 'targetDevice': followed.st_dev, 'targetInode': followed.st_ino}
    if kind == 'symlink':
        row['link'] = os.readlink(path)
    if stat.S_ISREG(followed.st_mode) and content:
        data = path.read_bytes()
        row.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    return row


def main():
    if not sys.flags.isolated or not sys.dont_write_bytecode or Path.cwd() != ROOT:
        raise RuntimeError('Use /usr/bin/python3 -I -B in the owned worktree')
    source = json.loads((OUT / (PREFIX + 'source.json')).read_bytes())
    node = json.loads((OUT / (PREFIX + 'node.json')).read_bytes())
    if source['sourceCommit'] != SOURCE_COMMIT or len(source['rows']) != 7 or len(source['expectedNames']) != 14:
        raise RuntimeError('Source14 boundary differs')
    nodes = {}
    for row in source['rows']:
        path = ROOT / row['path']
        item = identity(path)
        if item['kind'] != 'file' or item['sha256'] != row['sha256'] or item['bytes'] != row['bytes']:
            raise RuntimeError('Current source differs: ' + row['path'])
        nodes[str(path)] = item
    external = ['source.json', 'node.json', 'loader.mjs', 'launch.py', 'resources.py', 'supervisor.py', 'audit.py', 'freeze.py']
    for name in external:
        path = OUT / (PREFIX + name)
        nodes[str(path)] = identity(path)
    for name in ['_tools/test_resources.py', '_tools/scaffold_git.py', '.claude/scaffolding.json']:
        nodes[str(ROOT / name)] = identity(ROOT / name)
    executables = sorted(set(['/usr/bin/python3', sys.executable, node['node']['path'], '/bin/ps', '/usr/sbin/lsof', '/usr/bin/vm_stat', '/usr/bin/git']))
    for name in executables:
        nodes[name] = identity(Path(name))
    expected_node = node['node']
    actual_node = nodes[expected_node['path']]
    if any(actual_node[key] != expected_node[key] for key in ['sha256', 'bytes', 'device', 'inode']):
        raise RuntimeError('Exact Node executable differs')
    ledger = Path('/Users/garycarter/.cache/agent-scaffolding/test-resources')
    for path in [ROOT, OUT, Path('/private/tmp'), ledger, ledger / 'reservations.lock']:
        nodes[str(path)] = identity(path, content=False)
    if nodes[str(ledger / 'reservations.lock')]['kind'] != 'file':
        raise RuntimeError('Shared lock must be an existing regular file')
    environment = {'HOME': '/Users/garycarter', 'USER': 'garycarter', 'LOGNAME': 'garycarter',
        'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'}
    test = source['tests'][0]
    child = ['/usr/bin/python3', '-I', '-B', str(OUT / (PREFIX + 'launch.py')),
        expected_node['path'], '--loader', str(OUT / (PREFIX + 'loader.mjs')),
        '--test', '--test-reporter=tap', '--test-concurrency=1', test]
    plan = {'schemaVersion': 1, 'story': 'FUCQ-107', 'status': 'proposal-awaiting-independent-review-and-new-execution-grant',
        'variant': 'strict-controller14-94e05ff', 'sourceCommit': SOURCE_COMMIT, 'sourceFiles': 7,
        'applicationModules': 3, 'applicationEdges': 2, 'builtinEdges': 2, 'expectedCases': 14,
        'expectedNames': source['expectedNames'], 'sourceBytes': sum(row['bytes'] for row in source['rows']),
        'sourcePlanSHA256': hashlib.sha256((OUT / (PREFIX + 'source.json')).read_bytes()).hexdigest(),
        'pythonExecutable': sys.executable, 'pythonVersion': sys.version,
        'nodes': dict(sorted(nodes.items())), 'installedPackages': [], 'environment': environment,
        'ledgerDirectory': str(ledger), 'retainedChargedRoot': str(OUT),
        'limits': {'seconds': 120, 'ramBytes': 384 * 1024 ** 2, 'scratchAndEntireRetainedBytes': 128 * 1024 ** 2,
            'combinedOriginalLogAndJournalBytes': 2 * 1024 ** 2, 'workerCount': 1,
            'emergencyFreeBytes': 5 * 1024 ** 3, 'ramReserveBytes': 512 * 1024 ** 2, 'receiptHeadroomBytes': 128 * 1024},
        'commands': {'child': child,
            'execute': ['/usr/bin/python3', '-I', '-B', str(OUT / (PREFIX + 'supervisor.py')),
                '--execute', '--admission-sha', '<exact-reviewed-SHA>', '--dispatcher-grant', '<new-exact-controller14-grant>'],
            'audit': ['/usr/bin/python3', '-I', '-B', str(OUT / (PREFIX + 'audit.py')),
                '--admission-sha', '<exact-reviewed-SHA>', '--run', '<original-run-directory>']},
        'patternReference': {'commit': '918ce04510fd327e860809e7de53bd636d1cf7da',
            'resourcesSHA256': '2ef0823acaf59764c3c9e0e3cb662f0bd72637f7ee569807c61c537d0b742949',
            'supervisorSHA256': '1e5a0811b8cad6cf449905f72c1da49c59d9f6f486c95c791e40b3d496deefe9',
            'status': 'Dispatcher reports independent static admission PASS; this107 adaptation is unreviewed and unexecuted.'},
        'excluded': 'No controller rerun yet, renderer, jsdom, producers, canonical policy, server/backend45, PostgreSQL, network, listener, browser, native or full-suite execution. Paused96 is untouched.',
        'allocation': 'none; metadata only; no custom helper import, process probe, ledger mutation, reservation, scratch or tests'}
    output = OUT / (PREFIX + 'admission.json')
    output.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'path': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'nodes': len(nodes), 'sourceRows': 7, 'cases': 14, 'allocation': plan['allocation']}))


if __name__ == '__main__':
    main()
