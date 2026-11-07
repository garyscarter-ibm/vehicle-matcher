"""One explicitly granted phase; primary deliverables survive child/supervisor stops."""
import sys
sys.dont_write_bytecode = True
import argparse, atexit, hashlib, importlib.util, json, os, pathlib, re, signal, socket, threading, time

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value); return value

R = load('proof_resources', ROOT / '_tools/test_resources.py')
E = load('proof_exporter', ROOT / 'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py')

def require(value, code):
    if not value: raise ValueError(code)

def raw(path, limit=16777216):
    path = pathlib.Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= limit, 'proof-file-refused')
    value = path.read_bytes(); require(len(value) <= limit, 'proof-file-refused'); return value

def sha(value): return hashlib.sha256(value).hexdigest()

def exclusive(path, value):
    path = pathlib.Path(path)
    with path.open('x', encoding='utf8') as stream:
        os.fchmod(stream.fileno(), 0o600); json.dump(value, stream, separators=(',', ':')); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)

def preflight(grant_path):
    grant_bytes = raw(grant_path, 65536); grant = json.loads(grant_bytes)
    require(grant.get('schemaVersion') == 'f59-proof-executable-grant.v1'
        and grant.get('mode') in ('live', 'offline-contract')
        and grant.get('authorization') == 'root-grant-after-review-and-source-lane-clear'
        and grant.get('sourceLaneClear') is True, 'proof-grant-required')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,95}', grant.get('runId', ''))
        and set(grant.get('allocations', {})) == {'A', 'B'}
        and all(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,95}', v) for v in grant['allocations'].values())
        and grant['allocations']['A'] != grant['allocations']['B'], 'proof-allocation-refused')
    contract_bytes = raw(BASE / 'execution-contract.json', 65536)
    require(sha(contract_bytes) == grant.get('contractSha256'), 'proof-contract-pin'); contract = json.loads(contract_bytes)
    for path, expected in contract['codePins'].items(): require(sha(raw(ROOT / path)) == expected, 'proof-code-pin')
    for path, expected in contract['inputPins'].items(): require(sha(raw(pathlib.Path(grant['inputsRoot']) / path)) == expected, 'proof-input-pin')
    require(sha(raw(BASE / 'collection-plan.json')) == contract['planFileSha256'], 'proof-plan-pin')
    require(sha(raw(contract['nodePath'], 134217728)) == contract['nodeSha256'], 'proof-runtime-pin')
    retained = pathlib.Path(grant['retainedRoot']); metadata = pathlib.Path(grant['metadataRoot'])
    require(retained.is_absolute() and metadata.is_absolute() and retained == retained.resolve() and metadata == metadata.resolve()
        and retained != metadata and retained not in metadata.parents and metadata not in retained.parents, 'proof-output-path')
    temporary = pathlib.Path(os.environ.get('TMPDIR', '/private/tmp')).resolve()
    require(temporary != retained and temporary not in retained.parents, 'proof-primary-in-scratch')
    return grant, sha(grant_bytes), contract, retained, metadata

def checkpoint(directory):
    value = raw(directory / 'collector-checkpoint.json', 8388608); envelope = json.loads(value)
    require(envelope.get('schemaVersion') == '1' and E.digest(envelope['content']) == envelope.get('contentDigest'), 'proof-checkpoint-integrity')
    return value, envelope['content']

def execute_phase(grant_path, phase, force_after_ready=False):
    require(phase in ('A', 'B'), 'proof-phase-refused')
    grant, grant_sha, contract, retained, metadata = preflight(grant_path)
    require(not force_after_ready or grant['mode'] == 'offline-contract' and phase == 'A', 'proof-force-live-refused')
    metadata.mkdir(parents=True, exist_ok=True)
    directory = retained / ('phase-' + phase.lower())
    if phase == 'A':
        exclusive(metadata / 'supervisor-once.json', {'runId': grant['runId'], 'grantSha256': grant_sha, 'retainedRoot': str(retained)})
        # Manifest is durable outside the primary and scratch before either allocation.
        exclusive(metadata / 'retained-deliverables.json', {'root': str(retained), 'primary': [str(retained / ('phase-' + p) / 'collector-checkpoint.json') for p in ('a', 'b')],
            'expectedPeakBytes': 33554432, 'disposable': False, 'neverDeletePrimary': True})
        retained.mkdir(mode=0o700)
        exclusive(retained / 'execution-binding.json', {'grantSha256': grant_sha, 'contractSha256': grant['contractSha256'], 'allocations': grant['allocations']})
    else:
        binding = json.loads(raw(retained / 'execution-binding.json', 65536))
        require(binding == {'grantSha256': grant_sha, 'contractSha256': grant['contractSha256'], 'allocations': grant['allocations']}, 'proof-grant-binding')
        predecessor_raw, predecessor = checkpoint(retained / 'phase-a')
        prior = json.loads(raw(retained / 'phase-a/supervisor-receipt.json', 65536))
        require(prior.get('proofReady') is True and prior.get('checkpointSha256') == sha(predecessor_raw)
            and predecessor['halted'] is None and predecessor['cursor'] == 1, 'proof-predecessor-refused')
        # Operationally select exactly one successor; FUCQ-152 is not changed in production.
        exclusive(retained / 'successor-selected.json', {'allocationId': grant['allocations']['B'], 'predecessorSha256': sha(predecessor_raw),
            'statePath': str(directory / 'collector-checkpoint.json'), 'grantSha256': grant_sha})
    directory.mkdir(mode=0o700)
    policy = R.Policy({'chunk_scratch_mib': 64, 'chunk_ram_mib': 512, 'chunk_seconds': 90, 'log_mib': 1})
    scratch = R.Scratch(metadata, ROOT, policy, expected=64 * R.MIB, checkpoint=directory / 'collector-checkpoint.json')
    host = R.HostBudget(policy); entered = reserved = False; link_identity = None
    link = ROOT / 'server/node_modules'; dependency = pathlib.Path(grant['dependencyDirectory']).resolve(strict=True)
    stop_watch = threading.Event(); cancel = threading.Event(); watcher = None; export_result = None; export_failure = None; result = None
    parent = {'pid': os.getppid(), 'start': R.process_identity(os.getppid())}
    finalized = False; cleanup_issues = []
    def finalize():
        nonlocal entered, reserved, link_identity, export_result, export_failure, finalized
        if finalized: return
        finalized = True
        def attempt(action):
            try: action()
            except Exception as error: cleanup_issues.append(str(error) if isinstance(error, ValueError) else type(error).__name__)
        stop_watch.set()
        if watcher is not None:
            watcher.join(timeout=5)
            if watcher.is_alive(): cleanup_issues.append('proof-watcher-not-joined')
        groups_absent = all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
        primary = directory / 'collector-checkpoint.json'
        if not groups_absent: cleanup_issues.append('proof-child-group-remains')
        if groups_absent and primary.exists() and export_result is None and export_failure is None:
            try:
                before = sha(raw(primary, 8388608)); export_result = E.export(directory)
                require(sha(raw(primary)) == before and sha(raw(directory / 'collector-state.json')) == before, 'proof-primary-export-changed')
            except Exception as error:
                export_failure = type(error).__name__
                attempt(lambda: R.atomic_json(directory / 'checkpoint-export-failure.json', {'issue': 'proof-retained-export-failed', 'errorType': export_failure, 'primaryPreserved': True}))
        def clean_writer(marker):
            row = json.loads(raw(marker, 1024)); pid = row.get('pid'); token = row.get('token')
            require(groups_absent and pid in scratch.record['groups'] and row.get('host') == socket.gethostname()
                and re.fullmatch(r'[0-9a-f-]{36}', token or '') and marker.name == f'collector-checkpoint.json.writer-{pid}-{token}.json'
                and R.process_identity(pid) is None, 'proof-writer-ownership-uncertain')
            staging = directory / f'collector-checkpoint.json.writing-{pid}-{token}'
            if staging.exists(): staging.unlink()
            marker.unlink()
        for marker in directory.glob('collector-checkpoint.json.writer-*.json'): attempt(lambda: clean_writer(marker))
        if entered and groups_absent:
            attempt(lambda: scratch.__exit__(None, None, None)); entered = False
        if reserved and groups_absent:
            attempt(lambda: host.release(scratch.token)); reserved = False
        if link_identity is not None and groups_absent:
            def unlink():
                info = link.lstat(); require(link.is_symlink() and (info.st_dev, info.st_ino) == link_identity and link.resolve() == dependency, 'proof-owned-link-changed')
                link.unlink()
            attempt(unlink)
            if not os.path.lexists(link): link_identity = None
        attempt(lambda: R.atomic_json(metadata / (phase + '-cleanup.json'), {'scratchAbsent': not os.path.lexists(scratch.root),
            'groupsAbsent': groups_absent, 'reservationAbsent': scratch.token not in (R.read_json(host.path, {}) or {}),
            'ownedDependencyLinkRemoved': link_identity is None, 'dependencyLinkPresent': os.path.lexists(link),
            'removedScratchBytes': scratch.record['peak'], 'retainedBytes': R.allocated_bytes(retained), 'primaryPreserved': primary.exists(),
            'exportFailure': export_failure, 'cleanupIssues': cleanup_issues, 'compatibilityException': None}))
    atexit.register(finalize)
    try:
        with R.handled_termination():
            host.acquire(scratch.token, 64 * R.MIB, 512 * R.MIB, ROOT, root=scratch.root, minimum_disk=16 * R.MIB, minimum_ram=448 * R.MIB); reserved = True
            scratch.__enter__(); entered = True
            if os.path.lexists(link): require(link.is_dir() and link.resolve() == dependency, 'proof-existing-dependency-path-preserved')
            else:
                link.symlink_to(dependency, target_is_directory=True); info = link.lstat(); link_identity = (info.st_dev, info.st_ino)
                R.atomic_json(metadata / (phase + '-dependency-ownership.json'), {'path': str(link), 'target': str(dependency), 'device': info.st_dev, 'inode': info.st_ino})
            def watch():
                while not stop_watch.wait(.1):
                    if not R.process_alive(parent) or R.allocated_bytes(retained) > 32 * R.MIB: cancel.set(); return
                    if force_after_ready and (directory / 'ready.json').exists() and scratch.record['groups']:
                        os.killpg(scratch.record['groups'][0], signal.SIGKILL); return
            watcher = threading.Thread(target=watch, name='proof-owned-child-monitor'); watcher.start()
            env = {'PATH': '/opt/homebrew/bin:/usr/bin:/bin', 'LANG': 'en_GB.UTF-8', 'LC_ALL': 'en_GB.UTF-8', 'TZ': 'UTC'}
            command = [contract['nodePath'], str(BASE / 'run-phase.mjs'), str(pathlib.Path(grant_path).resolve()), phase]
            if force_after_ready: command.append('--force-hold')
            result = R.run_process(command, ROOT, env, metadata / (phase + '.log'), scratch, policy, 64 * R.MIB, 448 * R.MIB, 90, host, cancel)
    except (Exception, KeyboardInterrupt) as error:
        cleanup_issues.append('execution-' + type(error).__name__)
    finally:
        try: finalize()
        except Exception as error: cleanup_issues.append(type(error).__name__)
        finally: atexit.unregister(finalize)
    try:
        require(result is not None, 'proof-no-child-result')
        raw_state, state = checkpoint(directory)
    except Exception as error:
        receipt = {'schemaVersion': 'f59-proof-supervisor.v1', 'phase': phase, 'mode': grant['mode'], 'proofReady': False,
            'grantSha256': grant_sha, 'contractSha256': grant['contractSha256'], 'checkpointSha256': None,
            'primaryOutsideScratch': True, 'primary': str(directory / 'collector-checkpoint.json'), 'export': export_result,
            'resourceResult': result, 'counts': None, 'actualSourceRequests': None if grant['mode'] == 'live' else 0,
            'failure': str(error) if isinstance(error, ValueError) else type(error).__name__, 'cleanupIssues': cleanup_issues, 'acceptance': False}
        exclusive(directory / 'supervisor-receipt.json', receipt); return receipt
    phase_receipt = R.read_json(directory / 'phase-receipt.json')
    if phase == 'A':
        ready = R.read_json(directory / 'ready.json', {})
        proof_ready = result['issue'] is None and result['rc'] == (-9 if force_after_ready else 75) and state['halted'] is None \
            and state['cursor'] == 1 and len(state['sourceCaptures']) == 1 and len(state['rejected']) == 0 \
            and len(state['accepted']) + len(state['duplicates']) == 1 and state['counts']['httpAttempts'] == 5 and ready.get('checkpointSha256') == sha(raw_state)
    else:
        proof_ready = result['issue'] is None and result['rc'] == 0 and phase_receipt and phase_receipt['proofReady'] is True
        original, original_state = checkpoint(retained / 'phase-a')
        require(sha(original) == prior['checkpointSha256'], 'proof-predecessor-changed')
        for field in ('records', 'accepted', 'duplicates', 'rejected', 'sourceCaptures'):
            require(state[field][:len(original_state[field])] == original_state[field], 'proof-inherited-state-changed')
        preparation = json.loads(raw(BASE / 'preparation.json')); all_events = []
        for label in ('a', 'b'):
            all_events += [json.loads(line) for line in (retained / ('phase-' + label) / 'source-events.jsonl').read_text().splitlines() if json.loads(line)['phase'] == 'started']
        require(len(all_events) == 10 and all(sum(row['url'] == candidate['solverUrl'] for row in all_events) == 1 for candidate in preparation['candidates']), 'proof-request-replay')
    receipt = {'schemaVersion': 'f59-proof-supervisor.v1', 'phase': phase, 'mode': grant['mode'], 'proofReady': bool(proof_ready and not export_failure and not cleanup_issues),
        'grantSha256': grant_sha, 'contractSha256': grant['contractSha256'], 'checkpointSha256': sha(raw_state),
        'primaryOutsideScratch': True, 'primary': str(directory / 'collector-checkpoint.json'), 'export': export_result,
        'resourceResult': result, 'counts': state['counts'], 'cumulativeCounts': phase_receipt['cumulativeCounts'] if phase_receipt else state['counts'], 'phaseReceipt': phase_receipt,
        'actualSourceRequests': state['counts']['httpAttempts'] if grant['mode'] == 'live' else 0,
        'acceptance': False, 'forcedOfflineStop': force_after_ready, 'cleanupIssues': cleanup_issues}
    exclusive(directory / 'supervisor-receipt.json', receipt)
    return receipt

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--grant', required=True); parser.add_argument('--phase', choices=('A', 'B'), required=True)
    args = parser.parse_args()
    try:
        receipt = execute_phase(args.grant, args.phase)
        print(json.dumps({'phase': args.phase, 'proofReady': receipt['proofReady'], 'actualSourceRequests': receipt['actualSourceRequests']}))
        raise SystemExit(0 if receipt['proofReady'] else 1)
    except (Exception, KeyboardInterrupt) as error:
        print(json.dumps({'status': 'refused-or-stopped', 'errorType': type(error).__name__, 'primaryNeverDeleted': True})); raise SystemExit(1)
