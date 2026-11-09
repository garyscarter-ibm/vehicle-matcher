"""Author-only stdlib freeze of the exact proposed admission. No helper imports.

This does not launch Node, query processes, acquire resources or run activation.
The supervisor later requires this file's externally reviewed SHA on its argv.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys

ROOT = Path(__file__).resolve().parents[3]
MODELS = ROOT / 'docs/gcsp/models'
INSTALLED = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/server/node_modules')
SOURCE_SHA = 'f884ae94ff85455aa8d56c38e0ed7e2be58d960a862e99359f5f318694fa65aa'


def identity(path, listing=False, content=True):
    value = path.lstat()
    followed = path.stat()
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
    if listing:
        if kind != 'directory':
            raise RuntimeError('Dependency directory symlink refused: ' + str(path))
        row['children'] = sorted(item.name for item in path.iterdir())
    return row


def main():
    nodes, packages, probes, pending = {}, {}, [], [INSTALLED / 'pg']
    def add(path, listing=False, content=True):
        nodes[str(path)] = identity(path, listing, content)
    while pending:
        package = pending.pop()
        key = str(package)
        if key in packages:
            continue
        manifest = json.loads((package / 'package.json').read_text())
        packages[key] = {'name': manifest['name'], 'version': manifest['version'], 'edges': []}
        add(package, listing=True)
        for path in sorted(package.rglob('*')):
            if path.is_symlink() and path.is_dir():
                raise RuntimeError('Nested dependency symlink directory refused')
            add(path, listing=path.is_dir())
        # Include the complete contents of each declared dependency/optional/peer
        # package, a superset of the runtime module closure. Test/dev dependencies
        # are not executed. Resolve from each declaring package's ancestors.
        declared = set(manifest.get('dependencies', {})) | set(manifest.get('optionalDependencies', {})) | set(manifest.get('peerDependencies', {}))
        required = set(manifest.get('dependencies', {})) - set(manifest.get('optionalDependencies', {}))
        for name in sorted(declared):
            if name.startswith(('.', '/')) or '..' in Path(name).parts:
                raise RuntimeError('Invalid package dependency name')
            current, candidates, target = package, [], None
            while True:
                candidate = current / 'node_modules' / name
                if os.path.lexists(candidate):
                    if not candidate.is_dir() or not (candidate / 'package.json').is_file():
                        raise RuntimeError('Package resolution is unknown: ' + str(candidate))
                    target = candidate
                    break
                candidates.append(str(candidate))
                if current.parent == current:
                    break
                current = current.parent
            if target is None and name in required:
                raise RuntimeError('Required installed dependency missing: ' + name)
            probes.extend(candidates)
            packages[key]['edges'].append({'name': name, 'target': str(target) if target else None, 'absentCandidates': candidates})
            if target:
                pending.append(target)
    add(INSTALLED)
    helpers = ['_tools/test_resources.py', '_tools/scaffold_git.py', '.claude/scaffolding.json',
               *['docs/gcsp/models/' + name for name in [
                   'fucq115-activation-freeze.py', 'fucq115-activation-resources.py',
                   'fucq115-activation-supervisor.py', 'fucq115-activation-launch.mjs',
                   'fucq115-activation-run.mjs', 'fucq115-activation-source-plan.py',
                   'fucq115-activation-source-plan.json', 'fucq115-retained-source-plan.json']]]
    for path in helpers:
        add(ROOT / path)
    source_path = MODELS / 'fucq115-activation-source-plan.json'
    if hashlib.sha256(source_path.read_bytes()).hexdigest() != SOURCE_SHA:
        raise RuntimeError('Reviewed77-row catalogue drift')
    source = json.loads(source_path.read_text())
    for path, row in source['files'].items():
        if (ROOT / path).is_file() and (path.startswith('server/gcsp/predict/model/')
                or path == 'scripts/gcsp/train-choice-model.mjs' or path in source['retainedInputPaths']):
            add(ROOT / path)
            if nodes[str(ROOT / path)]['sha256'] != row['sha256']:
                raise RuntimeError('Owned source/input drift')
    executables = sorted(set(['/usr/bin/python3', sys.executable, '/opt/homebrew/bin/node', '/bin/ps', '/usr/sbin/lsof', '/usr/bin/vm_stat', '/usr/bin/git']))
    for path in executables:
        add(Path(path))
    ledger = Path.home() / '.cache/agent-scaffolding/test-resources'
    add(ledger)
    add(ledger / 'reservations.lock', content=False)
    plan = {'schemaVersion': 1, 'story': 'FUCQ-115', 'variant': 'strict-artifact-activation-v2',
            'sourcePlanSHA256': SOURCE_SHA, 'sourceFiles': len(source['files']),
            'pythonExecutable': sys.executable, 'pythonVersion': sys.version,
            'sourceBytes': sum(row['bytes'] for row in source['files'].values()),
            'nodes': dict(sorted(nodes.items())), 'absentResolutionCandidates': sorted(set(probes)),
            'installedPackages': dict(sorted(packages.items())), 'helperPaths': helpers,
            'executables': executables, 'ledgerDirectory': str(ledger),
            'commands': {'plan': ['/usr/bin/python3', '-I', '-B', 'docs/gcsp/models/fucq115-activation-supervisor.py', '--plan', '--admission-sha', '<reviewed admission SHA>'],
                         'execute': ['/usr/bin/python3', '-I', '-B', 'docs/gcsp/models/fucq115-activation-supervisor.py', '--execute', '--admission-sha', '<reviewed admission SHA>', '--dispatcher-grant', '<exact grant>'],
                         'child': ['/opt/homebrew/bin/node', '<owned-scratch>/launch.mjs', '<owned-scratch>/entry.mjs', '<owned-scratch>/mirror', '<owned-scratch>/output']},
            'allocation': 'none; author-only metadata freeze; no custom helpers imported or Node launched'}
    output = MODELS / 'fucq115-activation-admission.json'
    output.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'path': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                      'packages': len(packages), 'nodes': len(nodes), 'absenceProbes': len(set(probes)),
                      'sourceFiles': plan['sourceFiles'], 'sourceBytes': plan['sourceBytes'], 'allocation': plan['allocation']}))


if __name__ == '__main__':
    main()
