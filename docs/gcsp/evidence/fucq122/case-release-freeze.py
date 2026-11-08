"""Static C4 authoring collector. Never imports JavaScript or allocates tests.

Requires published immutable C1 profile and C4 test revisions. It only authors
the source plan/admission; a new dispatcher grant is still needed to execute.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
CANDIDATE = 'f179ae6043414a2b07de3edb2b425338299ea37b'
TEST = 'server/test/gcsp-case-release-http.test.js'
PROFILE = 'server/test/helpers/runtime-composition-profile.js'
OWN_CONSUMERS = {'blocks/gcsp/cases/http-adapter.js'}
OUT = ROOT.parents[2] / '.claude/test-runs/fucq122-c4'
SYSTEM_LAUNCHERS = frozenset((Path('/usr/bin/python3'), Path('/usr/bin/git')))
# Mirrored literal; runtime requires exact equality with the hash-admitted bounds helper.
ACCOUNTING = {
    "combined_bytes": 134217728,
    "ram_bytes": 805306368,
    "retained_bytes": 8388608,
    "json_bytes": 1048576,
    "summary_bytes": 524288,
    "terminal_bytes": 16384,
    "audit_bytes": 16384,
    "stdout_bytes": 4096,
    "log_bytes": 1572864,
    "journal_bytes": 524288,
    "checkpoint_bytes": 65536,
    "json_depth": 24,
    "json_nodes": 32768,
    "json_collection": 4096,
    "json_string_chars": 65536,
    "json_total_chars": 524288,
    "entries": 4096,
    "process_identities": 512,
    "probe_bytes": 1048576,
    "probe_timeout_seconds": 2,
    "sample_interval_seconds": 0.2,
    "helper_timeout_seconds": 5,
    "helper_capture_bytes": 1048576,
    "supervisor_seconds": 120,
    "completion_reserve_seconds": 30,
    "bootstrap_bytes": 1048576,
    "source_plan_bytes": 4194304,
    "input_bytes": 4194304,
    "probe_ram_allowance": 33554432,
    "encoding_ram_allowance": 67108864,
    "ledger_ram_allowance": 33554432,
    "ledger_disk_allowance": 4194304,
    "atomic_disk_allowance": 1056768,
    "stream_disk_allowance": 2097152,
    "terminal_disk_allowance": 65536,
    "audit_disk_allowance": 65536
}
sys.path.insert(0, str(ROOT / '_tools'))
import scaffold_git as G


def sha(data):
    return hashlib.sha256(data).hexdigest()


def git(args):
    rc, out, error = G.git(ROOT, args)
    if rc:
        raise RuntimeError(error[:1024])
    return out


def immutable(ref, path):
    blob = git(['rev-parse', ref + ':' + path]).strip()
    try:
        data = git(['show', ref + ':' + path]).encode()
    except UnicodeDecodeError:
        data = (ROOT / path).read_bytes()
    if hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() != blob:
        raise RuntimeError('Exact immutable source bytes unavailable: ' + path)
    return blob, data


def system_launcher_identity(value):
    if not stat.S_ISREG(value.st_mode) or value.st_uid != 0 or value.st_gid != 0 \
            or value.st_mode & 0o022 or not value.st_mode & 0o111 or value.st_nlink < 1:
        raise RuntimeError('System launcher must be a protected root-owned executable regular file')
    return {'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
            'uid': value.st_uid, 'gid': value.st_gid, 'links': value.st_nlink, 'bytes': value.st_size,
            'mtimeNs': value.st_mtime_ns, 'ctimeNs': value.st_ctime_ns, 'flags': getattr(value, 'st_flags', 0)}


def system_launcher_bytes(path, expected):
    if sys.platform != 'darwin' or path not in SYSTEM_LAUNCHERS or path.resolve(strict=True) != path:
        raise RuntimeError('System launcher reader is limited to the two exact macOS paths')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        if system_launcher_identity(before) != expected or not 0 <= before.st_size <= ACCOUNTING['input_bytes'] \
                or system_launcher_identity(path.lstat()) != expected:
            raise RuntimeError('System launcher physical/link identity differs before read')
        data = source.read(ACCOUNTING['input_bytes']+1)
        if len(data) != before.st_size or len(data) > ACCOUNTING['input_bytes'] \
                or system_launcher_identity(os.fstat(source.fileno())) != expected \
                or system_launcher_identity(path.lstat()) != expected:
            raise RuntimeError('System launcher physical/link identity changed during bounded read')
    return data


def physical(path, content=True):
    value, target = path.lstat(), path.stat()
    kind = 'symlink' if stat.S_ISLNK(value.st_mode) else 'directory' if stat.S_ISDIR(value.st_mode) else 'file' if stat.S_ISREG(value.st_mode) else None
    if kind is None:
        raise RuntimeError('Special file refused: ' + str(path))
    row = {'kind': kind, 'device': value.st_dev, 'inode': value.st_ino, 'mode': stat.S_IMODE(value.st_mode),
           'resolved': str(path.resolve(strict=True)), 'targetDevice': target.st_dev, 'targetInode': target.st_ino}
    if kind == 'symlink':
        row['link'] = os.readlink(path)
    if stat.S_ISREG(target.st_mode) and content:
        if path in SYSTEM_LAUNCHERS:
            row['systemLauncher'] = system_launcher_identity(value)
            data = system_launcher_bytes(path, row['systemLauncher'])
        else:
            data = path.read_bytes()
        row.update(bytes=len(data), sha256=sha(data))
    return row


def normalize(parent, specifier):
    bits = []
    for part in (PurePosixPath(parent).parent / specifier).parts:
        if part == '..':
            if not bits:
                raise RuntimeError('Source edge escapes mirror')
            bits.pop()
        elif part != '.':
            bits.append(part)
    return '/'.join(bits)


def packages():
    common = Path(git(['rev-parse', '--git-common-dir']).strip()).resolve().parent
    def resolve(name, caller):
        for ancestor in [caller, *caller.parents]:
            candidate = ancestor / 'node_modules' / name / 'package.json'
            if candidate.is_file():
                return candidate.parent.resolve()
        return None
    roots, files, edges, absent = {}, {}, [], []
    pending = [('pg', common / 'server', False)]
    while pending:
        name, caller, optional = pending.pop()
        directory = resolve(name, caller)
        if directory is None:
            if not optional:
                raise RuntimeError('Required installed package missing: ' + name)
            candidates = [str(ancestor / 'node_modules' / name) for ancestor in [caller, *caller.parents]]
            if any(os.path.lexists(path) for path in candidates):
                raise RuntimeError('Optional package has an incomplete/unreviewed installed path')
            absent.append({'name': name, 'caller': str(caller), 'absentCandidates': candidates})
            continue
        edges.append({'name': name, 'caller': str(caller), 'root': str(directory)})
        if str(directory) in roots:
            continue
        meta = json.loads((directory / 'package.json').read_bytes())
        roots[str(directory)] = {'name': meta['name'], 'version': meta['version']}
        for folder, dirs, names in os.walk(directory, followlinks=False):
            dirs[:] = sorted(name for name in dirs if name not in ['node_modules', '.git'])
            if any((Path(folder) / name).is_symlink() for name in dirs):
                raise RuntimeError('Uninventoried installed directory link')
            for name in sorted(names):
                path = Path(folder) / name
                item = physical(path)
                if not path.is_file():
                    raise RuntimeError('Installed non-file entry')
                files[str(path)] = {**item, 'realpath': str(path.resolve())}
                if len(files) > 10000:
                    raise RuntimeError('Installed closure exceeds finite file ceiling')
        optional_names = set(meta.get('optionalDependencies', {}))
        for name in sorted(set(meta.get('dependencies', {})) | optional_names):
            pending.append((name, directory, name in optional_names))
        for name in sorted(meta.get('peerDependencies', {})):
            pending.append((name, directory, meta.get('peerDependenciesMeta', {}).get(name, {}).get('optional', False)))
    pg = next(path for path, row in roots.items() if row['name'] == 'pg')
    entry = str(Path(pg) / 'lib/index.js')
    if entry not in files:
        raise RuntimeError('Reviewed pg CommonJS entry is missing')
    if sum(row['bytes'] for row in files.values()) > 32 * 1024 ** 2:
        raise RuntimeError('Installed closure exceeds finite byte ceiling')
    return {'packages': roots, 'files': files, 'edges': edges, 'absentOptional': absent, 'pgEntry': entry}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile-ref', required=True)
    parser.add_argument('--test-ref', required=True)
    args = parser.parse_args()
    if not sys.flags.isolated or not sys.dont_write_bytecode or Path.cwd() != ROOT:
        raise RuntimeError('Use /usr/bin/python3 -I -B in the owned checkout')
    for ref in [args.profile_ref, args.test_ref]:
        if not re.fullmatch('[a-f0-9]{40}', ref) or git(['rev-parse', ref + '^{commit}']).strip() != ref:
            raise RuntimeError('Supply an immutable published commit')
    installed = packages()
    rows, edges, directory_assets = {}, [], []
    queue = [TEST, 'package.json', 'package-lock.json', 'server/package.json', 'server/package-lock.json']
    def selected(path):
        return args.test_ref if path == TEST or path in OWN_CONSUMERS else args.profile_ref if path == PROFILE else CANDIDATE
    # Anchor declarations so prose such as "from 'a boot claim ...'" in a
    # module comment cannot become a fabricated dependency. Dynamic imports
    # and side-effect imports have their own literal forms.
    imports = re.compile(r"^[ \t]*(?:import\s+(?:\{[^;]*?\}|\*\s+as\s+[\w$]+|[\w$]+(?:\s*,\s*\{[^;]*?\})?)|export\s+(?:\{[^;]*?\}|\*))\s+from\s*[\'\"]([^\'\"\n]+)[\'\"]", re.M)
    side_effects = re.compile(r"^[ \t]*import\s*[\'\"]([^\'\"\n]+)[\'\"]", re.M)
    dynamic_imports = re.compile(r"\bimport\s*\(\s*[\'\"]([^\'\"\n]+)[\'\"]")
    urls = re.compile(r"new\s+URL\(\s*[\'\"]([^\'\"]+)[\'\"]\s*,\s*import\.meta\.url")
    while queue:
        path = queue.pop()
        if path in rows:
            continue
        ref = selected(path)
        blob, data = immutable(ref, path)
        kind = 'module' if path.endswith(('.js', '.mjs')) else 'data'
        rows[path] = {'path': path, 'ref': ref, 'gitBlob': blob, 'kind': kind,
                      'sha256': sha(data), 'bytes': len(data), 'base64': base64.b64encode(data).decode()}
        if len(rows) > 512 or sum(row['bytes'] for row in rows.values()) > 8 * 1024 ** 2:
            raise RuntimeError('Source closure exceeds finite authoring bounds')
        if kind != 'module':
            continue
        text = data.decode()
        for specifier in [*imports.findall(text), *side_effects.findall(text), *dynamic_imports.findall(text)]:
            if specifier.startswith('.'):
                target = normalize(path, specifier)
                edges.append({'from': path, 'specifier': specifier, 'to': target, 'kind': 'module'})
                queue.append(target)
            elif specifier.startswith('node:'):
                edges.append({'from': path, 'specifier': specifier, 'to': specifier, 'kind': 'module'})
            elif specifier == 'pg':
                edges.append({'from': path, 'specifier': specifier, 'to': installed['pgEntry'], 'installed': True, 'kind': 'module'})
            else:
                raise RuntimeError('Unreviewed bare import: ' + specifier)
        for specifier in urls.findall(text):
            if not specifier.startswith('.'):
                raise RuntimeError('Unreviewed source URL')
            target = normalize(path, specifier)
            kind = git(['cat-file', '-t', selected(target) + ':' + target]).strip()
            edges.append({'from': path, 'specifier': specifier, 'to': target, 'kind': 'asset'})
            if kind == 'tree':
                children = git(['ls-tree', '-r', '--name-only', selected(target), '--', target]).splitlines()
                if len(children) > 512:
                    raise RuntimeError('Asset directory exceeds finite ceiling')
                queue.extend(children)
                directory_assets.append({'directory': target, 'files': children})
            else:
                queue.append(target)
        if re.search(r'\bimport\s*\(\s*[^\s\'\"]|new\s+URL\(\s*`', text):
            raise RuntimeError('Nonliteral source edge needs explicit review: ' + path)
    test_data = base64.b64decode(rows[TEST]['base64']).decode()
    if sha((ROOT / TEST).read_bytes()) != rows[TEST]['sha256']:
        raise RuntimeError('Current owned C4 test differs from its selected immutable revision')
    names = re.findall(r"^test\('([^']+)'", test_data, re.M)
    if len(names) != 4 or any(not name.startswith('C4 ') for name in names):
        raise RuntimeError('Exactly four named C4 cases required')
    plan = {'schemaVersion': 1, 'status': 'frozen-for-review', 'requiresNewDispatcherGrant': True,
            'root': str(ROOT), 'candidate': CANDIDATE, 'profileRef': args.profile_ref, 'testRef': args.test_ref,
            'sourceSelection': {'composition': CANDIDATE, 'profile': {PROFILE: args.profile_ref},
                                'ownedTestAndConsumers': {path: args.test_ref for path in [TEST, *sorted(OWN_CONSUMERS)]}},
            'test': TEST, 'expectedNames': names, 'pending': [], 'rows': [rows[path] for path in sorted(rows)],
            'edges': edges, 'directoryAssets': directory_assets, 'installed': installed,
            'sourceMethod': 'Finite immutable Git blobs materialized only in owned scratch after admission/reservation; product worktree is never overlaid.',
            'installedMethod': 'Complete declared pg runtime/optional/peer package directories, statically hashed; not a claim of observed CommonJS import coverage.',
            'scope': 'Four C4 in-process HTTP handler cases; no listener, JSDOM, browser, native, full, real F77/F78 or96 producer proof.'}
    source_path = HERE / 'case-release-source-plan.json'
    source_path.write_text(json.dumps(plan, indent=2) + '\n')
    nodes = {}
    for name in ['case-release-source-plan.json', 'case-release-freeze.py', 'case-release-loader.mjs',
                 'case-release-launch.py', 'case-release-resources.py', 'case-release-supervisor.py',
                 'case-release-bounds.py', 'case-release-ledger.py']:
        nodes[str(HERE / name)] = physical(HERE / name)
    for path in [ROOT / '_tools/test_resources.py', ROOT / '_tools/scaffold_git.py', ROOT / '.claude/scaffolding.json',
                 ROOT / TEST, Path('/opt/homebrew/bin/node'), Path('/opt/homebrew/bin/node').resolve(),
                 Path('/usr/bin/python3'), Path(sys.executable), Path('/bin/ps'), Path('/usr/sbin/lsof'),
                 Path('/usr/bin/vm_stat'), Path('/usr/bin/git')]:
        nodes[str(path)] = physical(path)
    ledger = Path.home() / '.cache/agent-scaffolding/test-resources'
    for path in [ROOT, OUT.parent, Path('/private/tmp'), ledger, ledger / 'reservations.lock']:
        nodes[str(path)] = physical(path, content=False)
    if nodes[str(ledger / 'reservations.lock')]['kind'] != 'file':
        raise RuntimeError('Existing regular shared lock required')
    admission = {'schemaVersion': 1, 'status': 'proposal-awaiting-independent-review-and-new-grant',
                 'root': str(ROOT), 'output': str(OUT), 'sourcePlanSHA256': sha(source_path.read_bytes()),
                 'nodes': nodes, 'pythonExecutable': sys.executable, 'pythonVersion': sys.version,
                 'accounting': ACCOUNTING,
                 'completion': {'ledgerCredit': 'used/rss remain zero; full 128MiB/768MiB reservation held through final completion',
                                'receiptState': 'pending-final-release-and-independent-audit',
                                'releaseOrder': 'scratch/process cleanup; bounded bundle; postwrite; monitor/probe join; finite stdout/flush; final synchronous accounting; strict release/readback as last operation'},
                 'ledgerContract': {'directory': str(ledger), 'anchors': {str(path): {**{key: nodes[str(path)][key] for key in ['kind', 'device', 'inode', 'mode', 'resolved']}, 'uid': path.lstat().st_uid} for path in [ledger, ledger/'reservations.lock']}},
                 'ledgerDirectory': str(ledger), 'node': str(Path('/opt/homebrew/bin/node').resolve()),
                 'environment': {'HOME': str(Path.home()), 'USER': 'garycarter', 'LOGNAME': 'garycarter',
                                 'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC', 'GCSP_OFFLINE': '1'},
                 'limits': {'seconds': 120, 'rssMiB': 768, 'scratchAndRetainedMiB': 128, 'logAndJournalMiB': 2, 'workers': 1},
                 'absence': [str(ROOT / 'server/node_modules')],
                 'commands': {
                     'author': ['/usr/bin/python3', '-I', '-B', str(HERE / 'case-release-freeze.py'),
                                '--profile-ref', args.profile_ref, '--test-ref', args.test_ref],
                     'childTemplate': ['/usr/bin/python3', '-I', '-B', str(HERE / 'case-release-launch.py'),
                                       str(Path('/opt/homebrew/bin/node').resolve()), '--loader', str(HERE / 'case-release-loader.mjs'),
                                       '--test', '--test-reporter=tap', '--test-concurrency=1', '{ownedSourceMirror}/' + TEST],
                     'executeTemplate': ['/usr/bin/python3', '-I', '-B', str(HERE / 'case-release-supervisor.py'),
                                         '--execute', '--admission-sha', '<exact-reviewed-admission-SHA256>',
                                         '--dispatcher-grant', '<new-exact-fucq122-c4-grant>']},
                 'allocation': 'none; source/package bytes only; no application or harness imports, reservations, scratch, probes or tests'}
    output = HERE / 'case-release-admission.json'
    output.write_text(json.dumps(admission, indent=2) + '\n')
    print(json.dumps({'admissionSHA256': sha(output.read_bytes()), 'sourcePlanSHA256': sha(source_path.read_bytes()),
                      'sourceRows': len(rows), 'edges': len(edges), 'installedFiles': len(installed['files']), 'cases': names}))


if __name__ == '__main__':
    main()
