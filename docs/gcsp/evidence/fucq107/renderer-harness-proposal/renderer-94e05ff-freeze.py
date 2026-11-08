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
PREFIX = 'renderer-94e05ff-'
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
    if kind == 'directory':
        row['entries'] = sorted(item.name for item in path.iterdir())
    if stat.S_ISREG(followed.st_mode) and content:
        data = path.read_bytes()
        row.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    return row


def main():
    if not sys.flags.isolated or not sys.dont_write_bytecode or Path.cwd() != ROOT:
        raise RuntimeError('Use /usr/bin/python3 -I -B in the owned worktree')
    source = json.loads((OUT / (PREFIX + 'source.json')).read_bytes())
    node = json.loads((OUT / (PREFIX + 'node.json')).read_bytes())
    if source['sourceCommit'] != SOURCE_COMMIT or len(source['rows']) != 22 or len(source['expectedNames']) != 9:
        raise RuntimeError('Renderer9 boundary differs')
    nodes = {}
    for row in source['rows']:
        path = ROOT / row['path']
        item = identity(path)
        if item['kind'] != 'file' or item['sha256'] != row['sha256'] or item['bytes'] != row['bytes']:
            raise RuntimeError('Current source differs: ' + row['path'])
        nodes[str(path)] = item
    dependencies = json.loads((OUT / (PREFIX + 'dependencies.json')).read_bytes())
    expected_files = {}
    for row in dependencies['files'] + dependencies['lockInputs']:
        path = Path(row['path'])
        item = identity(path)
        if item['kind'] != 'file' or any(item[key] != row[key] for key in ['sha256', 'bytes', 'device', 'inode']):
            raise RuntimeError('Installed inventory changed: ' + str(path))
        if path.suffix == '.node':
            raise RuntimeError('Native addon refused')
        if str(path) in expected_files and expected_files[str(path)] != item:
            raise RuntimeError('Duplicate inventory identity differs')
        expected_files[str(path)] = item
        nodes[str(path)] = item
    observed = set()
    for package in dependencies['packages']:
        root = Path(package['path'])
        item = identity(root)
        if item['kind'] != 'directory' or any(item[key] != package[key] for key in ['device', 'inode']):
            raise RuntimeError('Installed package root differs')
        for folder, dirs, files in os.walk(root, followlinks=False):
            directory = Path(folder)
            nodes[str(directory)] = identity(directory)
            if nodes[str(directory)]['kind'] != 'directory':
                raise RuntimeError('Dependency directory is not regular')
            for name in dirs:
                if (directory / name).is_symlink():
                    raise RuntimeError('Dependency directory symlink refused')
            for name in files:
                path = str(directory / name)
                if path not in expected_files:
                    raise RuntimeError('Uninventoried installed file: ' + path)
                observed.add(path)
    wanted = {row['path'] for row in dependencies['files']}
    if observed != wanted or len(wanted) != 1833 or len(dependencies['files']) != 1850:
        raise RuntimeError('Full installed inventory differs')
    absent = dependencies['absentResolutionCandidates']
    if len(absent) != 129 or any(os.path.lexists(path) for path in absent):
        raise RuntimeError('Optional/resolution absence differs')
    external = ['dependencies.json', 'impact.json', 'source.json', 'node.json', 'loader.mjs', 'launch.py', 'resources.py', 'supervisor.py', 'audit.py', 'freeze.py']
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
        nodes[str(path)].pop('entries', None)
    if nodes[str(ledger / 'reservations.lock')]['kind'] != 'file':
        raise RuntimeError('Shared lock must be an existing regular file')
    environment = {'HOME': '/Users/garycarter', 'USER': 'garycarter', 'LOGNAME': 'garycarter',
        'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'}
    test = source['tests'][0]
    child = ['/usr/bin/python3', '-I', '-B', str(OUT / (PREFIX + 'launch.py')),
        expected_node['path'], '--import', str(OUT / (PREFIX + 'loader.mjs')),
        '--test', '--test-reporter=tap', '--test-concurrency=1', test]
    plan = {'schemaVersion': 1, 'story': 'FUCQ-107', 'status': 'proposal-awaiting-independent-review-and-new-execution-grant',
        'variant': 'strict-renderer9-94e05ff', 'sourceCommit': SOURCE_COMMIT, 'sourceFiles': 22,
        'applicationModules': 17, 'applicationSourceEdges': 33, 'expectedCases': 9,
        'expectedNames': source['expectedNames'], 'sourceBytes': sum(row['bytes'] for row in source['rows']),
        'sourcePlanSHA256': hashlib.sha256((OUT / (PREFIX + 'source.json')).read_bytes()).hexdigest(),
        'pythonExecutable': sys.executable, 'pythonVersion': sys.version,
        'nodes': dict(sorted(nodes.items())), 'installedPackages': dependencies['packages'], 'environment': environment,
        'dependencyInventoryRows': 1850, 'dependencyUniqueFiles': 1833, 'dependencyUniqueBytes': sum(nodes[path]['bytes'] for path in wanted),
        'dependencyPlanSHA256': hashlib.sha256((OUT / (PREFIX + 'dependencies.json')).read_bytes()).hexdigest(),
        'absentPaths': sorted(absent),
        'ledgerDirectory': str(ledger), 'retainedChargedRoot': str(OUT),
        'limits': {'seconds': 120, 'ramBytes': 384 * 1024 ** 2, 'scratchAndEntireRetainedBytes': 128 * 1024 ** 2,
            'combinedOriginalLogAndJournalBytes': 2 * 1024 ** 2, 'workerCount': 1,
            'emergencyFreeBytes': 5 * 1024 ** 3, 'ramReserveBytes': 512 * 1024 ** 2, 'receiptHeadroomBytes': 128 * 1024},
        'commands': {'child': child,
            'execute': ['/usr/bin/python3', '-I', '-B', str(OUT / (PREFIX + 'supervisor.py')),
                '--execute', '--admission-sha', '<exact-reviewed-SHA>', '--dispatcher-grant', '<new-exact-renderer9-grant>'],
            'audit': ['/usr/bin/python3', '-I', '-B', str(OUT / (PREFIX + 'audit.py')),
                '--admission-sha', '<exact-reviewed-SHA>', '--run', '<original-run-directory>']},
        'patternReference': {'commit': '00900926ee86d380f706726b91892fa6376837ed',
            'resourcesSHA256': '1c19f35495cd5a186dfcb75490a314814a9b37be594acaa51dcfbdcfae445790',
            'supervisorSHA256': 'a065e2f38318f3dcd1053a8e4439fcd88ac2b42199b9531c85723f58426ce147',
            'status': 'Accepted controller14 lifecycle at the pinned commit; renderer9 adaptation remains unreviewed and unexecuted.'},
        'excluded': 'Renderer9 only with pre-existing exact JSDOM inventory. No controller/backend rerun, producer composition, canonical103 runtime, PostgreSQL, network, listener, browser, native or full-suite execution. Paused96 is untouched.',
        'allocation': 'none; metadata only; no custom helper import, process probe, ledger mutation, reservation, scratch or tests'}
    output = OUT / (PREFIX + 'admission.json')
    output.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'path': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'nodes': len(nodes), 'sourceRows': 22, 'cases': 9, 'allocation': plan['allocation']}))


if __name__ == '__main__':
    main()
