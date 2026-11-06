"""Static authoring: build a reviewable freeze; never imports Node or allocates test resources."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / 'docs/gcsp/evidence/fucq134'
GRAPH = ROOT / 'docs/gcsp/fucq134-source-graph.json'
LOCAL = ['server/gcsp/comparison/harness.js', 'server/test/gcsp-comparison-current.test.js',
         'server/test/helpers/gcsp-comparison-guard.mjs', 'server/test/helpers/gcsp-comparison-launch.mjs',
         'server/test/fixtures/gcsp-comparison-current-outcomes.json', 'docs/gcsp/fucq134-outcome-policy-proposal.json']
HELPERS = ['_tools/test_resources.py', '_tools/scaffold_git.py', 'docs/gcsp/evidence/fucq134/first-chunk-resources.py',
           'docs/gcsp/evidence/fucq134/first-chunk-supervisor.py', 'docs/gcsp/evidence/fucq134/first-chunk-freeze.py',
           'docs/gcsp/fucq134-source-graph.json']


def sha(data):
    return hashlib.sha256(data).hexdigest()


def physical(path, content=False, children=False):
    value, followed = path.lstat(), path.stat()
    kind = 'symlink' if stat.S_ISLNK(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else None
    row = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
           'resolved': str(path.resolve(strict=True)), 'targetDevice': followed.st_dev, 'targetInode': followed.st_ino}
    if kind == 'symlink':
        row['link'] = os.readlink(path)
    if content:
        data = path.read_bytes()
        row.update(bytes=len(data), sha256=sha(data))
    if children:
        row['children'] = sorted(item.name for item in path.iterdir())
    return row


def main():
    if not sys.flags.isolated or not sys.dont_write_bytecode:
        raise RuntimeError('Use /usr/bin/python3 -I -B')
    graph = json.loads(GRAPH.read_bytes())
    for name, expected in graph['supervisorPrimitives'].items():
        if sha((ROOT / name).read_bytes()) != expected:
            raise RuntimeError('Supervisor primitive pin differs: ' + name)
    sg_path = ROOT / '_tools/scaffold_git.py'
    data = sg_path.read_bytes()
    if sha(data) != graph['supervisorPrimitives']['_tools/scaffold_git.py']:
        raise RuntimeError('Git adapter pin differs')
    spec = importlib.util.spec_from_file_location('fucq134_git_authoring', sg_path)
    git = importlib.util.module_from_spec(spec)
    exec(compile(data, str(sg_path), 'exec'), git.__dict__)
    sources = {}
    pinned = {**graph['productClosure'], graph['baseGenerator']['path']: graph['baseGenerator']}
    for name, row in pinned.items():
        rc, text, error = git.git(str(ROOT), ['cat-file', 'blob', row['gitBlob']])
        data = text.encode()
        if rc or sha(data) != row['sha256']:
            raise RuntimeError('Immutable Git source pin differs: ' + name)
        sources[name] = {'text': text, 'sha256': sha(data), 'bytes': len(data), 'gitBlob': row['gitBlob']}
    for name in LOCAL:
        data = (ROOT / name).read_bytes()
        sources[name] = {'text': data.decode(), 'sha256': sha(data), 'bytes': len(data), 'source': 'authored-worktree'}
    material = {name: row['sha256'] for name, row in sources.items()}
    revision = sha(json.dumps(material, sort_keys=True, separators=(',', ':')).encode())
    nodes = {}
    def add(path, content=False, children=False):
        path = Path(path)
        nodes[str(path)] = physical(path, content, children)
        for parent in path.parents:
            if str(parent) not in nodes:
                nodes[str(parent)] = physical(parent)
    for name in LOCAL + HELPERS:
        add(ROOT / name, content=True)
    for runtime in ['node', 'python']:
        path = Path(graph['runtime'][runtime + 'RealPath'])
        if sha(path.read_bytes()) != graph['runtime'][runtime + 'Sha256']:
            raise RuntimeError('Runtime hash differs: ' + runtime)
        add(path, content=True)
    add(Path(sys.executable), content=True)
    add(Path('/usr/bin/python3'), content=True)
    for executable in ['/bin/ps', '/usr/bin/vm_stat', '/usr/sbin/lsof']:
        add(Path(executable), content=True)
    installed = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/server/node_modules')
    add(installed, children=True)
    add(installed / '.package-lock.json', content=True)
    for package in graph['installedPackages'].values():
        base = Path(package['realRoot'])
        actual = sorted(str(p.relative_to(base)) for p in base.rglob('*') if p.is_file())
        if actual != sorted(row['path'] for row in package['files']):
            raise RuntimeError('Installed package file inventory differs: ' + str(base))
        add(base, children=True)
        for path in base.rglob('*'):
            if path.is_symlink():
                raise RuntimeError('Installed package symlink refused')
            add(path, content=path.is_file(), children=path.is_dir())
        for row in package['files']:
            if nodes[str(base / row['path'])]['sha256'] != row['sha256']:
                raise RuntimeError('Installed dependency content differs')
    ledger = Path.home() / '.cache/agent-scaffolding/test-resources'
    add(ledger)
    add(ledger / 'reservations.lock')
    absent = [str(ROOT / 'server/node_modules')]
    for name in absent:
        if os.path.lexists(name):
            raise RuntimeError('Worktree package installation must remain absent')
    result = {'schemaVersion': 1, 'status': 'authoring-only; execution requires dispatcher review/grant',
        'root': str(ROOT), 'base': graph['base'], 'actual66': graph['actual66'],
        'pythonExecutable': sys.executable, 'pythonVersion': sys.version,
        'nodeExecutable': graph['runtime']['nodeRealPath'], 'nodes': nodes, 'absent': absent,
        'installedRoot': str(installed), 'installedPackages': graph['installedPackages'],
        'ledgerDirectory': str(ledger), 'sources': sources, 'codeRevision': revision,
        'testNames': ['isolation', 'real-claim-review-allocate', 'untaken-expiry'],
        'limits': {'seconds': 120, 'ramBytes': 768 * 1024 ** 2, 'combinedBytes': 128 * 1024 ** 2,
                   'logBytes': 2 * 1024 ** 2, 'workerCount': 1, 'reserveFreeBytes': 5 * 1024 ** 3}}
    target = EVIDENCE / 'first-chunk-admission.json'
    target.write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
    print(json.dumps({'path': str(target), 'sha256': sha(target.read_bytes()), 'codeRevision': revision,
                      'sources': len(sources), 'sourceBytes': sum(row['bytes'] for row in sources.values()),
                      'physicalNodes': len(nodes), 'execution': 'none'}))


if __name__ == '__main__':
    main()
