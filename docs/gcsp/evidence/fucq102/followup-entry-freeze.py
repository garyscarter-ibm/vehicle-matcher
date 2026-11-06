"""Author physical admission from existing files; no custom import, OS proof or allocation."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = ROOT / 'docs/gcsp/evidence/fucq102'
SHARED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher')


def physical(path, children=False):
    value, followed = path.lstat(), path.stat()
    kind = 'symlink' if stat.S_ISLNK(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else None
    if kind is None:
        raise RuntimeError('Unknown physical kind: ' + str(path))
    row = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
           'resolved': str(path.resolve(strict=True)), 'targetDevice': followed.st_dev, 'targetInode': followed.st_ino}
    if kind == 'symlink':
        row['link'] = os.readlink(path)
    if path.is_file():
        data = path.read_bytes()
        row.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
    elif children:
        row['children'] = sorted(item.name for item in path.iterdir())
    return row


def main():
    if not sys.flags.isolated or not sys.dont_write_bytecode:
        raise RuntimeError('Use /usr/bin/python3 -I -B for interpreter identity')
    if os.path.lexists(ROOT / 'server/node_modules'):
        raise RuntimeError('Worktree dependency link must remain absent')
    nodes, packages, absent = {}, {}, set()
    def add(path, children=False):
        nodes[str(path)] = physical(path, children)
    def resolve_package(parent, name):
        candidates = []
        for directory in [parent, *parent.parents]:
            candidate = directory / 'node_modules' / name
            if os.path.lexists(candidate):
                if not candidate.is_dir():
                    raise RuntimeError('Package candidate is not a directory')
                return candidate, candidates
            candidates.append(str(candidate))
        return None, candidates
    def visit(package):
        if str(package) in packages:
            return
        manifest = json.loads((package / 'package.json').read_text())
        dependencies = {**manifest.get('dependencies', {}), **manifest.get('optionalDependencies', {}), **manifest.get('peerDependencies', {})}
        optional = set(manifest.get('optionalDependencies', {})) | {name for name, value in manifest.get('peerDependenciesMeta', {}).items() if value.get('optional') is True}
        edges = []
        packages[str(package)] = {'name': manifest['name'], 'version': manifest['version'], 'edges': edges}
        for folder, directories, files in os.walk(package, followlinks=False):
            directory = Path(folder)
            add(directory, True)
            for name in files:
                add(directory / name)
            for name in directories:
                if (directory / name).is_symlink():
                    raise RuntimeError('Unreviewed nested package symlink')
        for name in sorted(dependencies):
            target, missing = resolve_package(package, name)
            absent.update(missing)
            if target is None and name not in optional:
                raise RuntimeError('Required installed dependency is absent: ' + name)
            edges.append({'name': name, 'target': str(target) if target else None, 'absentCandidates': missing})
            if target:
                visit(target)
    visit(SHARED / 'server/node_modules/pg')
    for path in [Path('/usr/bin/python3'), Path(sys.executable), Path('/opt/homebrew/bin/node'), Path('/usr/bin/git'),
                 Path('/bin/ps'), Path('/usr/bin/vm_stat'), Path('/usr/sbin/lsof'),
                 ROOT / '_tools/scaffold_git.py', ROOT / '_tools/test_resources.py',
                 ROOT / 'server/gcsp/offers/access.js', ROOT / 'server/test/gcsp-offer-access-followup.test.js']:
        add(path)
    for name in ['followup-entry-execution-source-plan.json', 'followup-entry-launch.mjs', 'followup-entry-loader.mjs',
                 'followup-entry-resources.py', 'followup-entry-supervisor.py', 'followup-entry-freeze.py']:
        add(EVIDENCE / name)
    locks = []
    for path in [ROOT / 'package-lock.json', ROOT / 'server/package-lock.json', SHARED / 'package-lock.json',
                 SHARED / 'server/package-lock.json', SHARED / 'server/node_modules/.package-lock.json']:
        if path.exists():
            add(path)
            locks.append(str(path))
    ledger = Path.home() / '.cache/agent-scaffolding/test-resources'
    add(ledger)
    add(ledger / 'reservations.lock')
    add(SHARED / 'server/node_modules', True)
    absent.add(str(ROOT / 'server/node_modules'))
    if any(os.path.lexists(name) for name in absent):
        raise RuntimeError('Absent resolution changed while freezing')
    source_data = (EVIDENCE / 'followup-entry-execution-source-plan.json').read_bytes()
    source = json.loads(source_data)
    plan = {'schemaVersion': 1, 'story': 'FUCQ-102', 'variant': 'actual100-103-106-107-memory-entry/explicit107-question-input/sequential-tap-v2',
            'status': 'unexecuted physical admission; independent source/harness review required',
            'sourcePlanSHA256': hashlib.sha256(source_data).hexdigest(), 'sourceModules': len(source['modules']),
            'sourceDataFiles': len(source['files']), 'selectedCases': len(source['selectedCases']),
            'pythonExecutable': sys.executable, 'pythonVersion': sys.version, 'nodeExecutable': '/opt/homebrew/bin/node',
            'pgEntry': (SHARED / 'server/node_modules/pg/lib/index.js').as_uri(), 'ledgerDirectory': str(ledger),
            'command': ['/opt/homebrew/bin/node', '<manifest-owned scratch>/launch.mjs'],
            'nodes': dict(sorted(nodes.items())), 'installedPackages': dict(sorted(packages.items())), 'lockFiles': sorted(set(locks)),
            'absentResolutionCandidates': sorted(absent), 'allocation': 'none; no helper import, process proof, test, supervisor or dependency change'}
    target = EVIDENCE / 'followup-entry-admission.json'
    target.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'admissionSHA256': hashlib.sha256(target.read_bytes()).hexdigest(), 'nodes': len(nodes),
                      'installedPackages': len(packages), 'lockFiles': len(set(locks)), 'absentCandidates': len(absent)}))


if __name__ == '__main__':
    main()
