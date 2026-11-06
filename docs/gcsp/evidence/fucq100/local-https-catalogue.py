"""Static-only refresh/freeze for two serial HTTPS grants; no probes or tests."""
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
RECORDS = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq100/https-1315')
GRANT = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/coordination/fucq100-https-finite-delivery-1315.md')
SOURCE = HERE / 'local-https-source-plan.json'
PLAN = HERE / 'local-https-run-plan.json'
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()
IMPORT = re.compile(r'''(?:^|\n)\s*(?:import|export)\s+(?:(?!;)[\s\S])*?\bfrom\s*['"]([^'"\n]+)['"]|\bimport\s*\(\s*['"]([^'"\n]+)['"]|(?:^|\n)\s*import\s*['"]([^'"\n]+)['"]''')
URL = re.compile(r'''new\s+URL\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url''')
PINS = {
    'scripts/gcsp-demo.mjs': '9b683b703ba3fed309856954f26e6b685330bbb0936eaefffd5db5b45e028485',
    'server/test/helpers/local-https.js': '228173028ef03f1874f586fea8b3461b1917c3b5bb1869afa5f8aec4efd36712',
    'server/test/gcsp-demo-tls.test.js': 'db9ff1bb066228a3cfa5f26b0e498bd36fb67213d8df9bbb5fe27d970b1e9542',
    'server/test/gcsp-brief-runtime.test.js': 'ba3882313ce8ed3d901d986711be832a0f6cb71c4e552274556fbf81b1cda1e1',
    'server/test/gcsp-offer-runtime-composition.test.js': 'c3f09bae5901ec98ba2913698814567d90d186020275757be23d9b4948c3bf32'}


def identity(path):
    path = Path(path); st = path.stat()
    return {'sha256': sha(path), 'device': st.st_dev, 'inode': st.st_ino,
            'realpath': str(path.resolve()), 'symlink': path.is_symlink()}


def native_closure(paths):
    """Read Mach-O load commands; never execute a dependency inspection tool."""
    files = {}; edges = []; pending = [(Path(p).resolve(), [], Path(p).resolve().parent) for p in paths]
    while pending:
        path, inherited, executable_dir = pending.pop()
        if str(path) in files: continue
        files[str(path)] = identity(path); data = path.read_bytes()
        offsets = [0]
        if data[:4] == b'\xca\xfe\xba\xbe':
            count = struct.unpack_from('>I', data, 4)[0]
            offsets = [struct.unpack_from('>IIIII', data, 8 + n * 20)[2] for n in range(count)]
        for offset in offsets:
            magic = data[offset:offset + 4]
            if magic not in (b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe'): continue
            ncmds = struct.unpack_from('<I', data, offset + 16)[0]
            cursor = offset + (32 if magic == b'\xcf\xfa\xed\xfe' else 28)
            libraries = []; rpaths = list(inherited)
            for _ in range(ncmds):
                cmd, size = struct.unpack_from('<II', data, cursor)
                if size < 8 or cursor + size > len(data): raise RuntimeError('Invalid Mach-O load command')
                if cmd in (0xc, 0x18, 0x80000018, 0x8000001f, 0x80000023, 0x8000001c):
                    start = struct.unpack_from('<I', data, cursor + 8)[0]
                    value = data[cursor + start:cursor + size].split(b'\0')[0].decode()
                    if cmd == 0x8000001c:
                        rpaths.append(value.replace('@loader_path', str(path.parent)).replace('@executable_path', str(executable_dir)))
                    else: libraries.append(value)
                cursor += size
            for library in libraries:
                candidates = [Path(library.replace('@loader_path', str(path.parent)).replace('@executable_path', str(executable_dir)))]
                if library.startswith('@rpath/'):
                    candidates = [Path(prefix) / library[len('@rpath/'):] for prefix in rpaths]
                physical = next((p.resolve() for p in candidates if p.is_file()), None)
                row = {'from': str(path), 'installName': library, 'physical': str(physical) if physical else None}
                if physical is not None: pending.append((physical, rpaths, executable_dir))
                elif library.startswith(('/usr/lib/', '/System/Library/')):
                    row['basis'] = 'Apple sealed system dyld shared cache; platform identity pinned separately'
                else: raise RuntimeError('Unresolved non-system native dependency: ' + str(path) + ' -> ' + library)
                edges.append(row)
    return {'files': files, 'edges': edges,
            'platform': identity('/System/Library/CoreServices/SystemVersion.plist'),
            'platformPath': '/System/Library/CoreServices/SystemVersion.plist'}


def refresh():
    doc = json.loads(SOURCE.read_text())
    for path, value in doc['sources'].items():
        if sha(ROOT / path) != value: raise RuntimeError('Source identity drift: ' + path)
    for path, value in PINS.items():
        if sha(ROOT / path) != value: raise RuntimeError('Reviewed product/test drift: ' + path)
    # Reconstruct every actual JS import/URL edge. Unchanged HTML/CSS and their
    # physical inputs remain pinned; no inherited JS topology is trusted.
    edges = [row for row in doc['edges'] if row['kind'] not in ('module', 'url-resource')]
    pending = list(doc['sources']); seen = set()
    while pending:
        relative = pending.pop()
        if relative in seen: continue
        seen.add(relative); path = ROOT / relative
        if path.suffix not in ('.js', '.mjs', '.cjs'): continue
        source = path.read_text()
        pairs = [('module', next(v for v in values if v)) for values in IMPORT.findall(source)]
        pairs += [('url-resource', spec) for spec in URL.findall(source)]
        for kind, spec in pairs:
            row = {'from': relative, 'specifier': spec, 'kind': kind}
            if spec.startswith('.'):
                target = (path.parent / spec).resolve(); target.relative_to(ROOT)
                row['path'] = target.relative_to(ROOT).as_posix()
                if target.is_dir():
                    if row['path'] == '.':
                        row['boundary'] = 'trusted repository host root; requested assets already pinned'
                    else:
                        members = sorted(p for p in target.rglob('*') if p.is_file())
                        doc['directories'][row['path']] = [p.relative_to(ROOT).as_posix() for p in members]
                        for item in members:
                            key = item.relative_to(ROOT).as_posix(); doc['sources'][key] = sha(item); pending.append(key)
                elif target.is_file():
                    doc['sources'][row['path']] = sha(target); pending.append(row['path'])
                else: raise RuntimeError('Missing literal input: ' + str(row))
            elif spec.startswith('node:'): row['builtin'] = True
            elif spec in ('pg', 'jsdom'): row['external'] = True
            else: raise RuntimeError('Unknown external import: ' + spec)
            edges.append(row)
    edges = sorted({json.dumps(row, sort_keys=True): row for row in edges}.values(),
                   key=lambda row: (row['from'], row['kind'], row['specifier']))
    doc['edges'] = edges
    doc['externalPackages'] = [e for e in edges if e.get('external')]
    doc['staticReview'].update(sourceCount=len(doc['sources']), literalAndInheritedEdges=len(edges))
    doc['documentPins'] = {path: sha(ROOT / path) for path in doc['documentPins']}
    doc['inventoryBasis']['scope'] = 'All current JS import/URL edges rebuilt from physical source; pinned HTML/CSS/input inventory retained. Conditional execution requires the separate reviewed run plan.'
    doc['certificateTopology'] = {
        'from': 'server/test/helpers/local-https.js', 'api': 'node:child_process.execFile',
        'executable': '/usr/bin/openssl', 'argv': ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', '$OWNED_TMPDIR/gcsp-local-https-*/localhost.key', '-out', '$OWNED_TMPDIR/gcsp-local-https-*/localhost.crt',
        '-days', '1', '-config', '$OWNED_TMPDIR/gcsp-local-https-*/openssl.cnf'],
        'configuration': 'Exact generated req/subject/server sections, localhost SAN and serverAuth; pinned utility owns bytes.',
        'nativeEnvironment': 'PATH, LC_ALL=C, owned TMPDIR/TMP/TEMP, OPENSSL_CONF=the exact generated configuration; all other variables absent.',
        'resources': 'System platform dyld shared cache and LibreSSL defaults; no user config/provider/module paths admitted.',
        'instrumentation': ['local-https-preload.cjs', 'local-https-openssl.py'],
        'bounds': {'seconds': 10, 'outputBytes': 8192, 'requestsIdleSeconds': 5, 'responseBytes': 1048576}}
    return doc


def catalogue(doc):
    old = json.loads((HERE / 'lifecycle-runtime-validation-plan.json').read_text())
    helpers = [HERE / name for name in ('local-https-catalogue.py', 'local-https-selected.py',
        'local-https-preload.cjs', 'local-https-openssl.py', 'runtime-composition-supervisor.py',
        'runtime-composition-launch.py', 'runtime-composition-loader.mjs', 'runtime-composition-preload.cjs')]
    helpers += [Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq100/runtime-supervisor.py')]
    helpers += [ROOT / name for name in ('_tools/test_resources.py', '_tools/test_stamp.py', '_tools/scaffold_git.py', '.claude/scaffolding.json')]
    executables = dict(old['executables'])
    executables['/usr/bin/openssl'] = identity('/usr/bin/openssl')
    executables[str(Path(sys.executable).resolve())] = identity(Path(sys.executable).resolve())
    # Fresh physical pins, never just the old paths/hashes.
    for path in list(executables): executables[path] = identity(path)
    native = native_closure(executables)
    node = '/opt/homebrew/bin/node'
    instrumentation = ['--no-warnings', '--require', str(HERE / 'runtime-composition-preload.cjs'),
                       '--require', str(HERE / 'local-https-preload.cjs'), '--experimental-loader',
                       str(HERE / 'runtime-composition-loader.mjs'), '--test-reporter=tap']
    guard = 'local host retains session and strict origin/context guards without serving private source'
    selections = {
        'tls2': {'grant': 'fucq100-https-tls2-657c3a7-1315', 'file': 'server/test/gcsp-demo-tls.test.js',
                 'arguments': ['--test', '--test-concurrency=1', 'server/test/gcsp-demo-tls.test.js'],
                 'counts': {'tests': 2, 'pass': 2, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}},
        'brief1': {'grant': 'fucq100-https-brief1-657c3a7-1315', 'file': 'server/test/gcsp-brief-runtime.test.js',
                   'arguments': ['--test', '--test-concurrency=1', '--test-name-pattern=' + guard, 'server/test/gcsp-brief-runtime.test.js'],
                   'counts': {'tests': 1, 'pass': 1, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}}}
    selections['brief1']['excludedCaseCounts'] = {'tests': 5, 'pass': 1, 'fail': 0, 'cancelled': 0, 'skipped': 4, 'todo': 0}
    for key, row in selections.items():
        row['command'] = [node, *instrumentation, *row['arguments']]
        row['titles'] = re.findall(r"\btest\(\s*['\"](.*?)['\"]", (ROOT / row['file']).read_text())
        row['selectedTitles'] = row['titles'] if key == 'tls2' else [guard]
        row['excludedTitles'] = [] if key == 'tls2' else [t for t in row['titles'] if t != guard]
    return {'schemaVersion': 1, 'scope': 'targeted only; conditional serial grants; no browser/native/live/full acceptance',
            'productCheckpoint': '657c3a79695d8ab4670ebd1db1fb3edcaa83d382', 'reviewedProductTest': PINS,
            'grantPath': str(GRANT), 'grantSHA256': sha(GRANT), 'root': str(ROOT), 'records': str(RECORDS),
            'sourcePlanPath': str(SOURCE), 'sourcePlanSHA256': sha(SOURCE), 'sources': doc['sources'],
            'installedPath': old['installedPath'], 'installedSHA256': old['installedSHA256'],
            'helperHashes': {str(p): sha(p) for p in helpers}, 'executables': executables,
            'python': str(Path(sys.executable).resolve()), 'selections': selections,
            'nativeClosure': native,
            'platformDescriptor': '-'.join((os.uname().sysname, os.uname().release, os.uname().machine)),
            'limits': {'workers': 1, 'workSeconds': 120, 'supervisorSeconds': 180, 'rssBytes': 805306368,
                       'ownedDiskBytes': 134217728, 'logsBytes': 2097152, 'receiptBytes': 262144},
            'clock': 'Shared Unix epoch ms in config; Python supervisor monotonic180s from entry; worker monotonic120s; broker monotonic<=9s plus finite cleanup within execFile10s.',
            'listeners': 'Ephemeral 127.0.0.1 HTTPS only, explicit per-client CA; exact selected tests close server; recursive owned-process and lsof absence before scratch deletion.',
            'environment': {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'HOME': '/Users/garycarter', 'LC_ALL': 'C',
                            'TZ': 'Europe/London', 'NODE_TEST_CONTEXT': 'absent; Node manages its own test children'},
            'estimates': {'rssBytes': 536870912, 'diskBytes': 4194304, 'seconds': 30, 'basis': 'prospective, not measured'},
            'briefTap': 'Require exactly the one granted executed title; four excluded titles may be omitted or explicitly SKIP by name filter. Totals must exactly correspond to those rows:1pass/0skip or1pass/4skip; no other title/count accepted.'}


if __name__ == '__main__':
    if sys.argv[1:] != ['freeze']: raise RuntimeError('Only static freeze is supported')
    doc = refresh(); SOURCE.write_text(json.dumps(doc, indent=2) + '\n')
    plan = catalogue(doc); PLAN.write_text(json.dumps(plan, indent=2) + '\n')
    print(json.dumps({'plan': str(PLAN), 'sha256': sha(PLAN), 'sources': len(doc['sources']), 'edges': len(doc['edges'])}))
