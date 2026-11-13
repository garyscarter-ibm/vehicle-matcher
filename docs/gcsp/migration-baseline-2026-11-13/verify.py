"""FUCQ-434 bounded source/hash/coverage checks; no application execution."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

root = Path.cwd()
base = root / 'docs/gcsp/migration-baseline-2026-11-13'
inv = json.loads((base / 'inventory.json').read_text())
errors = []
checks = []
def check(label, passed, detail):
    checks.append({'check': label, 'passed': bool(passed), 'detail': detail})
    if not passed: errors.append(label)

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''): h.update(chunk)
    return h.hexdigest()

files = inv['sourceFiles'] + inv['retainedAndVisualFiles']
bad = [f['path'] for f in files if not (root / f['path']).is_file()
       or (root / f['path']).stat().st_size != f['bytes'] or digest(root / f['path']) != f['sha256']]
check('recorded file hashes', not bad, {'files': len(files), 'mismatches': bad})
aggregate = hashlib.sha256(''.join(f"{f['path']}\0{f['sha256']}\n" for f in inv['sourceFiles']).encode()).hexdigest()
check('source aggregate', aggregate == inv['sourceAggregateSha256'], aggregate)
routes = inv['routes']
check('route count and uniqueness', len(routes) == 100 and len({(r['method'], r['path']) for r in routes}) == 100,
      {'routes': len(routes), 'factoryRoutes': sum('factory' in r for r in routes), 'customRoutes': sum('factory' not in r for r in routes)})
index = (root / 'server/index.js').read_text()
registered = set(re.findall(r'\.\.\.(create\w+Routes)\(', index[index.index('const handleGcsp ='):index.index('const handleOfferAccess =')]))
recorded = {r['factory'] for r in routes if 'factory' in r}
check('registered route factory coverage', registered == recorded and len(recorded) == inv['factories'],
      {'factories': len(recorded), 'missing': sorted(registered - recorded), 'extra': sorted(recorded - registered)})
check('route source and replacement story coverage', all((root / r['source']).is_file() and r['stories'] for r in routes),
      'All operations name an existing source and replacement Story')
check('page coverage', len(inv['pages']) == 17 and all((root / p).is_file() for p in inv['pages']), inv['pages'])
text = (root / 'docs/gcsp/migration-baseline-2026-11-13.md').read_text() + (root / 'docs/gcsp/migration-replacement-contracts-2026-11-13.md').read_text()
# Ranges in the human matrix explicitly cover foundation/retirement; all API Stories are named.
required = set(range(440,453)) | set(range(455,483))
covered = set()
for match in re.finditer(r'FUCQ-(\d+)((?:[/–]\d+)*)', text):
    previous = int(match[1]); covered.add(previous)
    for separator, number in re.findall(r'([/–])(\d+)', match[2]):
        number = int(number)
        covered.update(range(previous, number+1) if separator == '–' else [number])
        previous = number
check('capability replacement coverage', required <= covered, {'requiredStories': len(required), 'missing': sorted(required - covered)})
missing = []
for doc in [root/'docs/gcsp/migration-baseline-2026-11-13.md', root/'docs/gcsp/migration-replacement-contracts-2026-11-13.md', root/'docs/design/gcsp-high-level-design.md']:
    for target in re.findall(r'\]\(([^)]+)\)', doc.read_text()):
        target = target.split('#')[0]
        if target and not re.match(r'\w+://', target) and not (doc.parent/target).exists(): missing.append(f'{doc.name}: {target}')
check('local Markdown references', not missing, missing)
spec = importlib.util.spec_from_file_location('scaffold_git', root/'_tools/scaffold_git.py')
gitmod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gitmod)
paths = sorted({f['path'] for f in files})
rc, changed, err = gitmod.git(str(root), ['diff','--name-only', inv['productSourceSha'], '--', *paths])
check('frozen source and retained inputs unchanged', rc == 0 and not changed.strip(), {'changed': changed.splitlines(), 'error': err.strip()})
rc, out, err = gitmod.git(str(root), ['diff', '--check'])
check('working diff whitespace', rc == 0, (out+err).strip())
result = {'story': 'FUCQ-434', 'scope': 'source/reference/hash coverage only', 'passed': not errors, 'checks': checks,
          'sourceAggregateSha256': aggregate, 'failures': errors}
(base/'verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'passed':not errors,'checks':len(checks),'files':len(files),'routes':len(routes),'failures':errors}))
sys.exit(bool(errors))
