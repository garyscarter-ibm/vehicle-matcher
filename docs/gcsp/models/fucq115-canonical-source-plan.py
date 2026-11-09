"""Read-only catalogue for the isolated canonical 80x4 integration.

No JavaScript is imported and no test resources are allocated by this command.
The catalogue is reviewed before its exact files may be mirrored into owned scratch.
"""
from pathlib import Path, PurePosixPath
import hashlib
import json
import posixpath
import re
import sys

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as sg

CANONICAL = '0d3a0aa2fcee5d26ad33e587578cff7cce169090'
RECORDS = 'ddd884b33311b0d62225e107a4ba7d45a464c146'
MODEL = 'a78c66293079645d2dff9e7673e03b5fcecbd081'
BASELINE = '163f35ba295ce3968634dd72f73f2a36881d4be1'
ROOTS = ['server/gcsp/runtime.js', 'server/gcsp/identity/http.js',
         'server/gcsp/predict/records/index.js', 'scripts/gcsp/generate-learning-records.mjs',
         'server/gcsp/predict/model/index.js', 'scripts/gcsp/train-choice-model.mjs',
         'server/package.json', 'docs/gcsp/evidence/fucq103/fucq115-dated-policy-command.json']
IMPORT = re.compile(r'''\b(?:from\s+|import\s*(?:\(\s*|\s+))["']([^"']+)["']''')
URL = re.compile(r'''new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url''')


def source_ref(path):
    if path.startswith('server/gcsp/predict/records/') or path == ROOTS[3]:
        return RECORDS
    if path.startswith('server/gcsp/predict/model/') or path == ROOTS[5]:
        return MODEL
    return CANONICAL


def read_at(ref, path):
    rc, out, err = sg.git(ROOT, ['show', f'{ref}:{path}'])
    if rc:
        raise RuntimeError(f'Missing finite source {ref}:{path}: {err[:200]}')
    return out.encode()


def main():
    files, bare, directories, queue = {}, set(), [], list(ROOTS)
    while queue:
        path = queue.pop(0)
        if path in files:
            continue
        ref = source_ref(path)
        data = read_at(ref, path)
        digest = hashlib.sha256(data).hexdigest()
        current = ROOT / path
        state = 'absent' if not current.exists() else 'identical' if hashlib.sha256(current.read_bytes()).hexdigest() == digest else 'different'
        row = {'sourceCommit': ref, 'sha256': digest, 'bytes': len(data), 'current': state, 'edges': []}
        files[path] = row
        if PurePosixPath(path).suffix not in ['.js', '.mjs']:
            continue
        code = data.decode()
        for kind, specifiers in [('module', IMPORT.findall(code)), ('file-url', URL.findall(code))]:
            for specifier in sorted(set(specifiers)):
                if not specifier.startswith('.'):
                    bare.add(specifier)
                    continue
                target = posixpath.normpath(posixpath.join(posixpath.dirname(path), specifier))
                if not target or target.startswith('../'):
                    raise ValueError(target)
                if not PurePosixPath(target).suffix:
                    directories.append({'from': path, 'target': target, 'kind': kind})
                    continue
                row['edges'].append({'kind': kind, 'target': target})
                queue.append(target)
    previous = json.loads((ROOT / 'docs/gcsp/models/fucq115-baseline-source-proposal.json').read_text())
    baseline = {path: {'previousSha256': digest, 'selectedSha256': files[path]['sha256'],
                      'identical': files[path]['sha256'] == digest}
                for path, digest in previous['files'].items() if path in files}
    result = {'schemaVersion': 1, 'story': 'FUCQ-115', 'status': 'proposed-for-dispatcher-review',
              'purpose': 'One finite coherent mirrored module graph; actual canonical adoption and dated publication; actual 80x4 FUCQ-113 generation then own training and actual baselines.',
              'roots': ROOTS, 'canonicalCommit': CANONICAL, 'recordsCommit': RECORDS, 'modelCommit': MODEL,
              'previousBaselineCommit': BASELINE, 'files': dict(sorted(files.items())),
              'bareModules': sorted(bare), 'directoryUrls': directories, 'baselineIdentityComparison': baseline,
              'executionBoundary': 'No imports, source copies, dataset generation or tests executed by this catalogue. No worktree foreign-source edits. At execution every selected source is copied byte-identically into a single owned scratch mirror; pg uses the existing installed target only.',
              'inactiveEdges': ['PostgreSQL constructors/migrations are imported but never opened; migration directory URL is unused in explicit memory mode.',
                                'Synthetic registry/corpus readers are imported but no corpus is loaded or collected; structural fixture configurations remain explicit.']}
    output = ROOT / 'docs/gcsp/models/fucq115-canonical-source-plan.json'
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'path': str(output), 'files': len(files), 'sourceBytes': sum(v['bytes'] for v in files.values()),
                      'states': {state: sum(v['current'] == state for v in files.values()) for state in ['identical', 'different', 'absent']},
                      'changedBaselineSources': [p for p, v in baseline.items() if not v['identical']],
                      'bareModules': result['bareModules'], 'directoryUrls': directories,
                      'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
