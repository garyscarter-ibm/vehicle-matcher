"""One root-granted reserved parent audit. Authoring is not permission to execute."""
from pathlib import Path
import atexit
import base64
import hashlib
import importlib.util
import json
import os
import re
import selectors
import shutil
import stat
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[4]
HERE = ROOT/'docs/gcsp/evidence/fucq105'
BASE = Path('/Users/garycarter/Code/GitHub/vehicle-matcher/.claude/test-runs/fucq105')
PINS = HERE/'followup-consumer-parent-audit-driver-pins.json'
MIB = 1024**2
STARTED = time.monotonic()


class Refusal(RuntimeError):
    pass


def require(condition):
    if not condition:
        raise Refusal('Parent audit admission or verification failed')


def clean_path(value):
    require(type(value) is str and len(value) <= 4096 and Path(value).is_absolute())
    path = Path(os.path.abspath(value))
    require(str(path) == value)
    require(not any(parent.is_symlink() for parent in (path, *path.parents)))
    return path


def regular(path, cap, retain=True):
    """Nonblocking descriptor admission; special files never reach a read."""
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= cap)
        pieces, size, digest = [], 0, hashlib.sha256()
        while True:
            block = os.read(fd, min(65536, cap+1-size))
            if not block:
                break
            size += len(block); require(size <= cap); digest.update(block)
            if retain:
                pieces.append(block)
        after = os.fstat(fd)
        fields = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns,
                               item.st_ctime_ns, item.st_mode, item.st_uid, item.st_nlink)
        require(fields(before) == fields(after) and size == before.st_size)
        info = dict(device=before.st_dev, inode=before.st_ino, size=size, mtime_ns=before.st_mtime_ns,
                    mode=stat.S_IMODE(before.st_mode), uid=before.st_uid, sha256=digest.hexdigest())
        return b''.join(pieces) if retain else None, info
    finally:
        os.close(fd)


def pairs(items):
    value = {}
    for key, item in items:
        require(key not in value); value[key] = item
    return value


def decode(raw):
    def invalid(value):
        raise Refusal('Non-finite JSON')
    value = json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)
    require(type(value) is dict)
    return value


def document(path, cap):
    raw, info = regular(path, cap)
    return decode(raw), info


def sha(path, cap=256*MIB):
    return regular(path, cap, retain=False)[1]['sha256']


def pinned_file(path, spec):
    _, identity = regular(path, spec['bytes'], retain=False)
    require(identity['size'] == spec['bytes'] and identity['sha256'] == spec['sha256'])
    return identity


def collapse(paths):
    result = []
    for path in sorted(set(paths), key=lambda item: (len(item.parts), str(item))):
        if not any(path == prior or path.is_relative_to(prior) for prior in result):
            result.append(path)
    return result


def bootstrap():
    # No owned/shared helper import, process, scratch or reservation before every required
    # root input and exact code/plan/Python identity below has been admitted.
    require(sys.dont_write_bytecode and len(sys.argv) == 5)
    options = dict(zip(sys.argv[1::2], sys.argv[2::2]))
    require(set(options) == {'--grant', '--supervisor-wait'})
    grant_path = clean_path(options['--grant']); wait_path = clean_path(options['--supervisor-wait'])
    require(not grant_path.is_relative_to(ROOT) and not grant_path.is_relative_to(Path('/private/tmp')))
    require(not wait_path.is_relative_to(ROOT) and not wait_path.is_relative_to(Path('/private/tmp')))
    pins, pin_info = document(PINS, 65536)
    grant, grant_info = document(grant_path, 65536)
    wait, wait_info = document(wait_path, 16384)
    require(pins['schema'] == 1 and pins['root'] == str(ROOT))
    require(pins['parent_contract']['ram_mib'] == pins['parent_contract']['minimum_ram_mib'] == 768)
    require(pins['parent_contract']['combined_mib'] == 128 and pins['parent_contract']['retained_mib'] == 8)
    require(pins['parent_contract']['audit_seconds'] == 120 and pins['parent_contract']['parent_seconds'] == 180)
    require(grant['approved'] is True and grant['scope'] == 'fucq105-followup-parent-audit')
    require(grant['driver_pins_sha256'] == pin_info['sha256'])
    require(re.fullmatch(r'[A-Za-z0-9-]{1,40}', grant['parent_audit_id']) is not None)
    require(re.fullmatch(r'fucq105-followup-[A-Za-z0-9-]{1,80}', wait['run_id']) is not None)
    require(grant['original_run_id'] == wait['run_id'])
    pinned_file(Path(__file__).resolve(), pins['driver'])
    require(grant['driver_sha256'] == pins['driver']['sha256'])
    for key in ('interface', 'recipe', 'recipe_pins', 'consumer_plan'):
        pinned_file(ROOT/pins[key]['path'], pins[key])
    require(grant['recipe_sha256'] == pins['recipe']['sha256'])
    require(grant['parent_audit_pins_sha256'] == pins['recipe_pins']['sha256'])
    plan, plan_info = document(ROOT/pins['consumer_plan']['path'], MIB)
    require(plan_info['sha256'] == pins['consumer_plan']['sha256'])
    require(grant['consumer_source_plan_sha256'] == plan_info['sha256'])
    require(wait['consumer_source_plan_sha256'] == plan_info['sha256'])
    require(plan['harness'] == pins['existing_harness'] and len(plan['harness']) == 10)
    for relative, row in pins['existing_harness'].items():
        pinned_file(ROOT/relative, row)
    python = pins['python']
    require(Path(sys.executable).resolve() == Path(python['resolved_path']))
    py_info = pinned_file(Path(python['resolved_path']), python)
    require(all(py_info[key] == python[key] for key in ('device', 'inode', 'mode', 'uid')))
    require(grant['python_path'] == python['resolved_path'] and grant['python_sha256'] == python['sha256'])
    require(wait['kind'] == 'fucq105-supervisor-wait' and wait['captured_by'] == 'root')
    require(wait['capture_source'] in ('tool-wait-result', 'captured-Popen.wait'))
    require(wait['wait_completed'] is True and type(wait['exit_code']) is int and -65535 <= wait['exit_code'] <= 65535)
    require(wait['stdout_complete'] is True and wait['stderr_complete'] is True and wait['truncated'] is False)
    require(type(wait['capture_id']) is str and re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', wait['capture_id']) is not None)
    require(grant['supervisor_wait_capture_sha256'] == wait_info['sha256'])
    for stream in ('stdout', 'stderr'):
        require(type(wait[stream]) is str and len(wait[stream].encode('utf-8')) <= 4096)
        require(hashlib.sha256(wait[stream].encode('utf-8')).hexdigest() == wait[stream+'_sha256'])
    run = clean_path(str(BASE/wait['run_id']))
    summary_path = run/'summary.json'; terminal_path = run/'terminal.json'
    summary, summary_info = document(summary_path, 512*1024)
    terminal, terminal_info = document(terminal_path, 16384)
    for key, info in (('summary', summary_info), ('terminal', terminal_info)):
        require(grant[key+'_sha256'] == wait[key+'_sha256'] == info['sha256'])
    require(summary['source_plan_sha256'] == terminal['source_plan_sha256'] == plan_info['sha256'])
    require(terminal['summary_sha256'] == summary_info['sha256'] and summary['owner'] == wait['owner'])
    require(type(wait['owner']['pid']) is int and wait['owner']['pid'] > 0)
    require(type(wait['owner']['start']) is str and 1 <= len(wait['owner']['start']) <= 64)
    consumer_grant_path = clean_path(wait['consumer_grant_path'])
    consumer_grant, consumer_grant_info = document(consumer_grant_path, 16384)
    require(grant['consumer_grant_sha256'] == wait['consumer_grant_sha256'] == consumer_grant_info['sha256'])
    require(consumer_grant['approved'] is True and consumer_grant['scope'] == 'fucq105-followup-consumer-memory')
    require(consumer_grant['run_id'] == wait['run_id'] and consumer_grant['plan_sha256'] == plan_info['sha256'])
    require(summary['review'] == str(consumer_grant_path))
    command = wait['supervisor_command']
    require(type(command) is list and len(command) == 5 and all(type(part) is str and len(part) <= 4096 for part in command))
    require(Path(command[0]).is_absolute() and command[1:] == ['-B', str(HERE/'followup-consumer-supervisor.py'), '--review', str(consumer_grant_path)])
    if wait['exit_code'] == 0:
        output = decode(wait['stdout'])
        require(output['status'] == 'passed' and output['failure'] is None and not wait['stderr'])
        require(output['summary'] == str(summary_path) and output['terminal'] == str(terminal_path))
    cleanup = summary['cleanup']; token = cleanup['token']
    require(type(token) is str and re.fullmatch(r'[a-f0-9]{32}', token) is not None)
    manifest_path = clean_path(cleanup['scratch_manifest'])
    require(manifest_path == run/'ownership'/(token+'.json'))
    require(cleanup['root'] == '/private/tmp/test-stamp-shard-'+token)
    original_manifest, original_manifest_info = document(manifest_path, MIB)
    require(original_manifest_info['sha256'] == terminal['scratch_manifest_sha256'])
    require(original_manifest['token'] == token and original_manifest['root'] == cleanup['root'])
    require(original_manifest['owner'] == summary['owner'] and original_manifest['state'] == 'removed')
    require(not os.path.lexists(run/'independent-audit.json'))
    parent_dir = clean_path(str(BASE/(run.name+'-parent-audit-'+grant['parent_audit_id'])))
    require(not os.path.lexists(parent_dir))
    readonly = collapse([run, BASE/'ownership'/(run.name+'.json'), BASE/'ownership'/(run.name+'-consumed.json'),
        BASE.parent/'impact'/(run.name+'.json'), grant_path, wait_path, consumer_grant_path])
    c = dict(pins=pins, grant=grant, grant_path=grant_path, grant_info=grant_info,
        wait=wait, wait_path=wait_path, wait_info=wait_info, plan=plan, plan_info=plan_info,
        summary=summary, terminal=terminal, summary_path=summary_path, terminal_path=terminal_path,
        original_manifest_path=manifest_path, original_manifest_info=original_manifest_info,
        run=run, parent_dir=parent_dir, readonly=readonly, pin_info=pin_info)
    source_identity(c)
    admitted, used = inspect_originals(c, 5*MIB, required=True)
    c['admitted_originals'] = admitted
    c['admitted_original_allocated_bytes'] = used
    return c


def source_identity(c):
    pinned_file(PINS, dict(bytes=c['pin_info']['size'], sha256=c['pin_info']['sha256']))
    for key in ('driver', 'interface', 'recipe', 'recipe_pins', 'consumer_plan'):
        pinned_file(ROOT/c['pins'][key]['path'], c['pins'][key])
    for path, row in c['pins']['existing_harness'].items():
        pinned_file(ROOT/path, row)
    py = c['pins']['python']; identity = pinned_file(Path(py['resolved_path']), py)
    require(all(identity[key] == py[key] for key in ('device', 'inode', 'mode', 'uid')))
    node = c['plan']['node']; require(str(Path(node['path']).resolve()) == node['realpath'])
    _, identity = regular(node['realpath'], 256*MIB, retain=False)
    require(identity['sha256'] == node['sha256'] and [identity['device'], identity['inode']] == node['installationIdentity'])
    for name, row in c['plan']['retained_dependencies'].items():
        expected = c['pins']['dependency_paths'][name]
        require(str(Path(row['installedRoot']).resolve()) == expected['installed_root'])
        item = Path(row['installedRoot']).stat()
        require([item.st_dev, item.st_ino] == [row['installationDevice'], row['installationInode']])
        for key in ('packageJson', 'entry'):
            require(str(Path(row[key]).resolve()) == expected[key])
            require(sha(expected[key], MIB) == row[key+'Sha256'])
    for relative, digest in c['summary']['local_source_before'].items():
        require(type(relative) is str and not Path(relative).is_absolute() and '..' not in Path(relative).parts)
        require(sha(ROOT/relative, MIB) == digest)

def snapshot_bound(result):
    # The snapshot has only fixed shallow records, finite paths and integer/hash values.
    # Enforce the same node/string/encoded caps without importing the bounds helper.
    nodes, chars = 1, 0
    for path, row in result.items():
        nodes += 2+2*len(row); chars += len(path)
        for key, value in row.items():
            chars += len(key)
            if type(value) is str:
                require(len(value) <= 65536); chars += len(value)
            else:
                require(type(value) is int and abs(value) < 2**63)
        require(nodes <= 32768 and chars <= 524288)
    size = 1
    for part in json.JSONEncoder(sort_keys=True, separators=(',', ':'), allow_nan=False).iterencode(result):
        size += len(part.encode('utf-8')); require(size <= 256*1024)


def inspect_originals(c, maximum, required):
    result = {}; documents = {}; entries = allocated = 0; seen = set()
    external_owner = BASE/'ownership'/(c['run'].name+'.json')
    external_consumption = BASE/'ownership'/(c['run'].name+'-consumed.json')
    external_impact = BASE.parent/'impact'/(c['run'].name+'.json')
    specific = {c['summary_path']:512*1024, c['terminal_path']:16384,
        c['grant_path']:65536, c['wait_path']:16384, clean_path(c['summary']['review']):16384}
    def visit(path, depth):
        nonlocal entries, allocated
        entries += 1; require(entries <= 4096 and depth <= 24)
        clean_path(str(path)); item = path.lstat()
        identity = (item.st_dev,item.st_ino)
        require(identity not in seen); seen.add(identity)
        allocated += max(item.st_size, item.st_blocks*512); require(allocated <= maximum)
        if stat.S_ISDIR(item.st_mode):
            result[str(path)] = dict(kind='directory', device=item.st_dev, inode=item.st_ino,
                mode=stat.S_IMODE(item.st_mode), uid=item.st_uid)
            with os.scandir(path) as children:
                for child in children:
                    visit(Path(child.path), depth+1)
        else:
            cap = specific.get(path, {'checkpoints.json':65536, 'modules.jsonl':256*1024,
                'failure.log':65536, 'independent-audit.json':16384, 'helper-ownership.json':16384}.get(path.name, MIB))
            raw, info = regular(path, cap)
            require([info['device'],info['inode'],info['size'],info['mtime_ns']] ==
                    [item.st_dev,item.st_ino,item.st_size,item.st_mtime_ns])
            result[str(path)] = dict(kind='file', **info)
            if path.suffix == '.json':
                documents[str(path)] = decode(raw)
    for path in c['readonly']:
        visit(path, 0)
    snapshot_bound(result)
    if required:
        needed = {c['summary_path'],c['terminal_path'],c['original_manifest_path'],c['run']/'plan.json',
            external_owner,external_consumption,external_impact,c['run']/'helper-ownership.json',c['grant_path'],c['wait_path'],
            clean_path(c['summary']['review'])}
        if c['wait']['exit_code'] == 0:
            needed.update((c['run']/'checkpoints.json', c['run']/'modules.jsonl'))
            strict = clean_path(c['summary']['strict_receipt'])
            require(strict.parent == c['run']/'strict' and strict.name.startswith('targeted-') and strict.suffix == '.json')
            needed.add(strict)
        for path in needed:
            require(str(path) in result and result[str(path)]['kind'] == 'file')
        bound = {c['summary_path']:c['grant']['summary_sha256'],c['terminal_path']:c['grant']['terminal_sha256'],
            c['original_manifest_path']:c['terminal']['scratch_manifest_sha256'],
            c['grant_path']:c['grant_info']['sha256'],c['wait_path']:c['wait_info']['sha256'],
            clean_path(c['summary']['review']):c['wait']['consumer_grant_sha256']}
        for path, digest in bound.items():
            require(result[str(path)]['sha256'] == digest)
        owner = documents[str(external_owner)]; consumption = documents[str(external_consumption)]
        impact = documents[str(external_impact)]; original_plan = documents[str(c['run']/'plan.json')]
        require(owner['owner'] == c['summary']['owner'] and owner['output'] == str(c['run']))
        helper = documents[str(c['run']/'helper-ownership.json')]
        require(helper['owner'] == c['summary']['owner'] and helper['run'] == c['run'].name)
        require(helper['source_plan_sha256'] == c['plan_info']['sha256'])
        require(helper['review_sha256'] == c['wait']['consumer_grant_sha256'])
        joined = helper['helper_ownership']
        require(joined['closing'] is True and joined['issue'] is None and joined['pending'] is None)
        require(type(joined['launches']) is int and type(joined['joined']) is int
                and 0 < joined['launches'] <= 4096 and joined['launches'] == joined['joined'])
        require(consumption['owner'] == c['summary']['owner'] and consumption['run'] == c['run'].name)
        require(consumption['review'] == c['summary']['review'] and consumption['plan_sha256'] == c['plan_info']['sha256'])
        require(impact['plan_sha256'] == c['plan_info']['sha256'] and impact['test'] == c['plan']['selected'])
        require(original_plan['source_plan_sha256'] == c['plan_info']['sha256'])
        require(original_plan['review_sha256'] == c['wait']['consumer_grant_sha256'] and original_plan['selected'] == c['plan']['selected'])
    return result, allocated


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value


def execute(c):
    # Everything required above is now present and bound to the separate root grant.
    b = load('parent_bounds', HERE/'followup-consumer-bounds.py')
    lifecycle = load('parent_lifecycle', HERE/'decision-mixed-lifecycle.py')
    cancel = threading.Event()
    cancellation = lifecycle.deferred_cancellation(cancel); cancellation.__enter__()
    atexit.register(cancellation.__exit__, None, None, None)
    # Exclusive retained ownership exists before the first monitor/identity helper.
    c['parent_dir'].mkdir(mode=0o700)
    item = c['parent_dir'].lstat()
    parent_directory_identity = (item.st_dev, item.st_ino)
    helpers = b.HelperOwnership(c['parent_dir']/'helper-ownership.json', {
        'kind': 'fucq105-parent-audit-helpers', 'original_run': c['run'].name,
        'parent_audit_id': c['grant']['parent_audit_id'], 'grant_sha256': c['grant_info']['sha256'],
        'source_plan_sha256': c['plan_info']['sha256'], 'output': str(c['parent_dir'])})
    monitor = b.Aggregate(cancel, 180, helpers); monitor.limit = 640*MIB
    scratch = ownership = budget = outputs = None
    snapshot = None; allocation = None
    status, failure = 1, None
    audit_code = None; stdout = bytearray(); stderr = bytearray()
    eof_seen = set(); stream_overflow = []
    checks = {}; postwrite_ready = False; audit_data = None; audit_output = None
    descendant_verified = False; descendant_issue = None; descendant_info = None
    def require_descendant_joined():
        nonlocal descendant_verified, descendant_issue, descendant_info
        descendant_verified = False
        try:
            require(descendant_issue is None and ownership is not None)
            if ownership.attempted is False:
                # Explicit no-launch state; an attempted/missing child never takes this branch.
                require(ownership.record['attempted'] is False and ownership.process is None)
                descendant_verified = True
                return
            require(ownership.attempted is True and ownership.record['attempted'] is True)
            require(ownership.process is not None and ownership.record['direct_joined'] is True)
            require(type(ownership.process.returncode) is int)
            child_helpers, info = document(c['parent_dir']/'audit-helper-ownership.json',16384)
            child_join = child_helpers['helper_ownership']
            require(child_helpers['kind'] == 'fucq105-independent-audit-helpers')
            require(child_helpers['output'] == str(c['parent_dir'])
                    and child_helpers['journal_parent'] == list(parent_directory_identity))
            require(child_helpers['owner']['pid'] == ownership.process.pid
                and any(all(child_helpers['owner'][key] == row[key] for key in ('pid','start'))
                        for row in scratch.record['processes'])
                and child_helpers['run'] == c['run'].name
                and child_helpers['source_plan_sha256'] == c['plan_info']['sha256']
                and child_helpers['summary_sha256'] == c['grant']['summary_sha256']
                and child_join['closing'] is True and child_join['issue'] is None
                and child_join['pending'] is None and type(child_join['launches']) is int
                and type(child_join['joined']) is int and 0 < child_join['launches'] <= 4096
                and child_join['launches'] == child_join['joined'])
            require(descendant_info is None or info == descendant_info)
            descendant_info = info
            descendant_verified = True
            checks['audit_helpers_joined'] = True
        except BaseException as error:
            descendant_issue = descendant_issue or type(error).__name__
            checks['audit_helpers_joined'] = False
            raise

    def fresh():
        require(time.monotonic()-STARTED <= 180 and not cancel.is_set())
        value = monitor.checkpoint()+128*MIB
        require(value <= 768*MIB)
        return value
    def capture_originals():
        result, used = inspect_originals(c, 8*MIB, required=False)
        b.encode(result, 256*1024)  # Retain the later shared-bound preservation check.
        return result
    def protected():
        actual = capture_originals(); expected = dict(snapshot)
        manifest_key = str(c['original_manifest_path']); audit_key = str(c['run']/'independent-audit.json')
        if manifest_key not in actual:
            expected.pop(manifest_key)
        actual.pop(audit_key, None)  # Sole new original-run output from the frozen auditor.
        require(actual == expected)
        require(sha(c['parent_dir']/'original-scratch-manifest.json', MIB) == c['original_manifest_info']['sha256'])
        return True
    try:
        monitor.start()
        r = load('parent_resources', ROOT/'_tools/test_resources.py'); r.subprocess = b.Captures(helpers)
        ledger = load('parent_ledger', HERE/'decision-mixed-ledger.py')
        policy = r.Policy(dict(chunk_seconds=120, chunk_scratch_mib=128, chunk_ram_mib=768, log_mib=2))
        class ParentScratch(r.Scratch):
            def child(self, process):
                ownership.register(process)
            def sample(self):
                monitor.check()
                with monitor.lock:
                    rows = {(row['pid'], row['start']): row for row in self.record['processes']}
                    rows.update({(row['pid'], row['start']): row for row in monitor.rows})
                require(len(rows) <= 512)
                self.record['processes'] = list(rows.values())
                self.record['peak'] = max(self.record['peak'], b.allocation([self.root]))
                value = outputs.observe()['charged_combined_bytes']
                r.atomic_json(self.manifest, self.record)
                return value
            def __exit__(self, kind, value, tb):
                try:
                    ownership.join_direct()
                finally:
                    ownership.require_safe()  # Always attempt owned group teardown before journal refusal.
                with helpers.gate():
                    require_descendant_joined()
                    return super().__exit__(kind, value, tb)
        scratch = ParentScratch(c['parent_dir'], ROOT, policy)
        scratch.record.update(story='FUCQ-105-parent-audit', processes=[], ports=[], profiles=[], dependency_links=[])
        ownership = lifecycle.LaunchOwnership(r, scratch)
        atexit.register(ownership.join_direct)
        monitor.groups = scratch.record['groups']
        require(b.allocation(c['readonly']) <= 5*MIB)
        scratch.record['parent_output_identity'] = list(parent_directory_identity)
        class ParentOutputs(b.Outputs):
            def observe(self):
                item = c['parent_dir'].lstat()
                require(stat.S_ISDIR(item.st_mode) and (item.st_dev,item.st_ino) == parent_directory_identity)
                return super().observe()
            def admissible(self, path):
                path = super().admissible(path)
                require(path.is_relative_to(c['parent_dir']) or path.is_relative_to(scratch.root))
                return path
            def json(self, path, value, cap=None, exclusive=False):
                limit = 256*1024 if Path(path) == scratch.manifest or Path(path).name == 'original-identities.json' else 65536
                return super().json(path, value, min(cap or limit, limit), exclusive)
        outputs = ParentOutputs(scratch.root, collapse(c['readonly']+[c['parent_dir']]), monitor)
        helpers.account(outputs)
        r.atomic_json = outputs.json
        budget = ledger.Budget(r, policy, c['plan']['host_budget'], scratch)
        outputs.json(c['parent_dir']/'intent.json', dict(owner=scratch.record['owner'], root=str(scratch.root),
            token=scratch.token, driver_pins_sha256=c['pin_info']['sha256'], grant_sha256=c['grant_info']['sha256'],
            supervisor_wait_sha256=c['wait_info']['sha256'], original_run=str(c['run']), state='planned'), exclusive=True)
        fresh()
        allocation = budget.acquire(scratch.token, 128*MIB, 768*MIB, '/private/tmp', root=scratch.root, minimum_ram=768*MIB)
        require(allocation == dict(disk=128*MIB, ram=768*MIB))
        outputs.json(c['parent_dir']/'consumed.json', dict(grant_sha256=c['grant_info']['sha256'],
            parent_audit_id=c['grant']['parent_audit_id'], owner=scratch.record['owner']), exclusive=True)
        budget.update(scratch.token, outputs.observe()['charged_combined_bytes'], fresh())
        require(not r.process_alive(c['summary']['owner']) and not os.path.lexists(c['summary']['cleanup']['root']))
        source_identity(c)
        snapshot = capture_originals()
        require(snapshot == c['admitted_originals'])  # Reject changes since pre-import admission.
        outputs.json(c['parent_dir']/'original-identities.json', snapshot, 256*1024, exclusive=True)
        raw, info = regular(c['original_manifest_path'], MIB)
        require(info == {key: value for key, value in snapshot[str(c['original_manifest_path'])].items() if key != 'kind'})
        outputs.write(c['parent_dir']/'original-scratch-manifest.json', raw, MIB, exclusive=True)
        with scratch:
            env = {key: value for key, value in os.environ.items() if key in ('PATH','HOME','USER','LOGNAME','LANG','LC_ALL','TZ','SHELL') or key.startswith('LC_')}
            env = scratch.env(env)
            command = [c['pins']['python']['resolved_path'], '-B', str(HERE/'followup-consumer-audit.py'),
                       '--summary', str(c['summary_path']), '--supervisor-exit-code', str(c['wait']['exit_code']),
                       '--helper-journal', str(c['parent_dir']/'audit-helper-ownership.json')]
            ownership.begin()
            launch_started = time.monotonic(); next_update = 0.0
            process = subprocess.Popen(command, cwd=str(ROOT), env=env, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, start_new_session=True)
            try:
                scratch.child(process)
                with selectors.DefaultSelector() as ready:
                    ready.register(process.stdout, selectors.EVENT_READ, stdout)
                    ready.register(process.stderr, selectors.EVENT_READ, stderr)
                    while ready.get_map() or process.poll() is None:
                        require(not cancel.is_set() and time.monotonic()-STARTED <= 180)
                        require(time.monotonic()-launch_started <= 120)
                        rss = monitor.check()+128*MIB; require(rss <= 768*MIB)
                        used = scratch.sample(); require(used <= allocation['disk'])
                        require(shutil.disk_usage(scratch.root).free >= policy.reserve)
                        if time.monotonic() >= next_update:
                            budget.update(scratch.token, used, rss); next_update = time.monotonic()+0.5
                        for key, mask in ready.select(0.1):
                            block = os.read(key.fd, 4096)
                            label = 'stdout' if key.data is stdout else 'stderr'
                            if not block:
                                eof_seen.add(label); ready.unregister(key.fd)
                            else:
                                if len(key.data)+len(block) > 4096:
                                    stream_overflow.append(label)
                                    raise Refusal('Audit stream cap exceeded')
                                key.data.extend(block)
                        if not ready.get_map() and process.poll() is None:
                            time.sleep(0.05)
            finally:
                # The actual captured child is stopped/waited before sample, persistence or queries.
                try:
                    ownership.join_direct()
                finally:
                    if ownership.record['direct_joined']:
                        audit_code = process.returncode
                    try:
                        process.stdout.close(); process.stderr.close()
                    finally:
                        require_descendant_joined()  # Independent of audit exit/assertion success.
            ownership.require_safe()
            protected(); source_identity(c); fresh()
            audit_output = decode(bytes(stdout))
            audit_data, audit_info = document(c['run']/'independent-audit.json', 16384)
            required = {'helper_ownership_and_joins_verified','actual_parent_wait_success','terminal_success','immutable_summary_binding','summary_success',
                'aggregate_receipt','final_combined_upper_bound','owner_exited','scratch_absent','launch_ownership_verified',
                'groups_absent','processes_absent','reservation_absent','ledger_staging_absent','local_sources_preserved',
                'harness_preserved','node_preserved','immutable_sources_inputs_preserved','retained_dependencies_preserved',
                'owned_removed_manifest','retained_allocation_within_cap','combined_allocation_within_cap',
                'terminal_upper_bound_covers_actual_files','retained_artifact_caps','owned_atomic_staging_absent',
                'parent_aggregate_within_cap','scratch_manifest_absent'}
            require_descendant_joined()
            checks['actual_waits_and_streams'] = c['wait']['exit_code'] == audit_code == 0 and not stderr \
                and eof_seen == {'stdout','stderr'} and not stream_overflow
            checks['audit_stdout'] = audit_output['status'] == 'passed' and audit_output['failure'] is None \
                and audit_output['audit'] == str(c['run']/'independent-audit.json')
            post = audit_output['postwrite']
            require(type(post) is dict)
            for key, cap in (('retained_allocated_bytes',8*MIB),('scratch_allocated_bytes',0),('charged_combined_bytes',128*MIB)):
                require(type(post[key]) is int and 0 <= post[key] <= cap)
            checks['audit_receipt'] = audit_data['status'] == 'passed' and audit_data['failure'] is None \
                and required.issubset(audit_data['checks']) and all(value is True for value in audit_data['checks'].values())
            checks['audit_input_binding'] = audit_data['summary_sha256'] == c['grant']['summary_sha256'] \
                and audit_data['terminal_sha256'] == c['grant']['terminal_sha256']
            checks['original_manifest_absent'] = not os.path.lexists(c['original_manifest_path'])
            checks['protected_originals'] = protected()
            require(all(checks.values()))
        status = 0
    except BaseException as error:
        failure = type(error).__name__; status = 1
    finally:
        if outputs is not None:
            outputs.diagnostics = True
        safe = False; groups = False; processes = False; original_ok = False
        # Preserve both actual waits and reversible complete capped streams even if later
        # ownership/identity/resource proof fails. Unknown wait stays explicitly None.
        try:
            if ownership is not None:
                try:
                    ownership.join_direct()
                finally:
                    safe = ownership.finish()  # Independent of journal, wait-capture and stream failures.
        except BaseException as error:
            failure = failure or 'OwnedGroupTeardown'+type(error).__name__; status = 1
        try:
            if ownership is not None and ownership.process is not None and ownership.record['direct_joined']:
                audit_code = ownership.process.returncode
            require(outputs is not None)
            outputs.json(c['parent_dir']/'audit-wait.json', dict(supervisor_exit_code=c['wait']['exit_code'],
                supervisor_wait_sha256=c['wait_info']['sha256'], audit_exit_code=audit_code,
                actual_audit_wait_known=type(audit_code) is int, stream_cap_refused=stream_overflow,
                stdout_complete='stdout' in eof_seen and 'stdout' not in stream_overflow,
                stderr_complete='stderr' in eof_seen and 'stderr' not in stream_overflow,
                stdout_b64=base64.b64encode(stdout).decode('ascii'), stderr_b64=base64.b64encode(stderr).decode('ascii'),
                stdout_sha256=hashlib.sha256(stdout).hexdigest(), stderr_sha256=hashlib.sha256(stderr).hexdigest()), exclusive=True)
        except BaseException as error:
            failure = failure or 'AuditWaitCapture'+type(error).__name__; status = 1
        try:
            require_descendant_joined()  # Re-read after unconditional direct wait and owned group teardown.
            if ownership is not None:
                groups = all(r.group_has_live_members(group) is False for group in scratch.record['groups'])
                processes = all(not r.process_alive(row) for row in scratch.record['processes'])
            if snapshot is not None:
                original_ok = protected()
                source_identity(c)
            require(outputs is not None and descendant_verified and safe and groups and processes
                    and original_ok and not os.path.lexists(scratch.root))
            require(not b.temporary_leftovers([c['parent_dir']], os.getpid()))
            for index, path in enumerate(c['parent_dir'].rglob('*')):
                require(index < 4096 and not (path.name.startswith('.') and '.owned-' in path.name))
            outputs.json(c['parent_dir']/'pre-release.json', dict(status='failed' if failure else 'pending-release', failure=failure,
                checks=checks, protected_originals=original_ok, child_launch=dict(ownership.record),
                descendant_helpers_verified=descendant_verified, descendant_helper_journal=descendant_info,
                driver_pins_sha256=c['pin_info']['sha256'], owner=scratch.record['owner'], token=scratch.token,
                root=str(scratch.root), scratch_manifest=str(scratch.manifest), allocation=outputs.observe(),
                parent_aggregate=monitor.receipt(), extra_child_allowance_bytes=128*MIB), exclusive=True)
            used = outputs.observe()['charged_combined_bytes']; rss = fresh()
            require(allocation == dict(disk=128*MIB, ram=768*MIB))
            budget.update(scratch.token, used, rss)
            protected(); source_identity(c); outputs.observe(); fresh()
            postwrite_ready = True
        except BaseException as error:
            failure = failure or 'FinalVerification'+type(error).__name__; status = 1
        if budget is not None and budget.attempted and postwrite_ready:
            try:
                with helpers.gate():
                    require_descendant_joined()  # Fresh mandatory gate immediately before exact-row release.
                    budget.release(scratch.token, dict(child_safe=safe, groups_absent=groups,
                        processes_absent=processes, scratch_absent=not os.path.lexists(scratch.root)))
            except BaseException:
                failure = failure or 'ParentReservationReleaseUncertain'; status = 1
        absent, known = False, False
        if budget is not None and scratch is not None:
            try:
                absent = budget.absence(scratch.token); known = True
                require(absent and all(row['state'] == 'removed' and not os.path.lexists(row['path'])
                                      for row in scratch.record.get('ledger_staging', [])))
            except BaseException:
                failure = failure or 'ParentReservationObservationUnknownOrRetained'; status = 1
        try:
            require(outputs is not None)
            observed = outputs.observe()
            try:
                fresh()
            except BaseException:
                failure = failure or 'FinalAggregateUnknown'; status = 1
            outputs.json(c['parent_dir']/'final.json', dict(status='failed' if failure or status else 'passed', failure=failure,
                supervisor_exit_code=c['wait']['exit_code'], audit_exit_code=audit_code,
                supervisor_wait_sha256=c['wait_info']['sha256'], driver_pins_sha256=c['pin_info']['sha256'],
                audit_wait_sha256=sha(c['parent_dir']/'audit-wait.json',65536) if postwrite_ready else None,
                original_token=c['summary']['cleanup']['token'], original_root=c['summary']['cleanup']['root'],
                parent_token=scratch.token, parent_root=str(scratch.root), parent_owner=scratch.record['owner'],
                child_launch=dict(ownership.record), groups_absent=groups, processes_absent=processes,
                descendant_helpers_verified=descendant_verified, descendant_helper_issue=descendant_issue,
                descendant_helper_journal=descendant_info,
                scratch_absent=not os.path.lexists(scratch.root), protected_originals=original_ok,
                parent_manifest_sha256=sha(scratch.manifest,256*1024), reservation_absent=absent,
                reservation_observation_known=known, postwrite_verified_before_release=postwrite_ready,
                allocation_before_terminal=observed, final_physical_upper_bound_bytes=observed['charged_combined_bytes'],
                parent_aggregate=monitor.receipt(), charged_peak_rss_bytes=monitor.peak+128*MIB,
                extra_child_allowance_bytes=128*MIB), exclusive=True)
            # No self-rewrite. Root must capture actual exit/stdout, including a late failure.
            final_observation = outputs.observe(); fresh()
            require(final_observation['retained_allocated_bytes']+final_observation['scratch_allocated_bytes']
                    <= observed['charged_combined_bytes'])
        except BaseException:
            failure = failure or 'ParentTerminalOrPostwriteFailure'; status = 1
        try:
            monitor.stop()
        except BaseException:
            failure = failure or 'ParentMonitorJoinFailure'; status = 1
        if monitor.issue or helpers.issue or cancel.is_set() or not (postwrite_ready and absent and known):
            failure = failure or 'ParentFinalGateFailed'; status = 1
        # No further child/probe launch follows monitor join.
        sys.stdout.buffer.write(b.encode(dict(status='failed' if failure or status else 'passed', failure=failure,
            parent_output=str(c['parent_dir']), supervisor_exit_code=c['wait']['exit_code'], audit_exit_code=audit_code,
            parent_reservation_absent=absent, postwrite=final_observation if not failure else None),4096))
        sys.stdout.buffer.flush()
    return 1 if failure or status else 0


def main():
    return execute(bootstrap())


if __name__ == '__main__':
    try:
        code = main()
    except BaseException as error:
        # Bootstrap errors retain no provider/credential text and allocate no harness resources.
        sys.stdout.write(json.dumps(dict(status='failed', failure=type(error).__name__, admission=False))+'\n')
        code = 2
    raise SystemExit(code)
