"""Resume only the exact unspent chunks15..32 after preserved original event-log conflict."""
import sys
sys.dont_write_bytecode = True
import atexit, datetime, hashlib, importlib.util, json, os, pathlib, signal, subprocess, time, uuid
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
series = read(BASE / 'series-plan.json')
assert sha(BASE / 'series-plan.json') == '96ec8dc874241bfe9b2a2928d226d88a4b9cbb073a8ebddb05ac12c5efa694c2'
assert os.environ.get('F70_TYPED_AXIS_RESUME15_GRANT') == series['id'] + '-after-accounted14'
assert all(sha(ROOT / p) == h for p, h in series['codePins'].items())
assert sha(BASE / 'candidate-manifest.json') == series['candidateManifestSha256']
resume_plan = read(BASE / 'resume15-plan.json')
assert all(sha(BASE / p) == h for p, h in resume_plan['codePins'].items())
output = pathlib.Path(series['outputRoot'])
cloud = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve()
assert cloud.is_dir() and cloud in output.resolve().parents and output.is_dir()
original_marker = read(BASE / 'series-once.json')
assert original_marker['id'] == series['id'] and original_marker['state'] == 'reserved-and-consumed'
assert original_marker['seriesPlanSha256'] == sha(BASE / 'series-plan.json')
original_receipt = read(output / 'series-receipt.json')
assert original_receipt['activeChunk'] == 3 and len(original_receipt['completedChunks']) == 2
assert original_receipt['reason'] == 'series-incomplete' and original_receipt['stoppedErrorType'] == 'AssertionError'
assert original_receipt['aggregateGets'] == 108 and original_receipt['aggregateDecodedBytes'] == 3112626
assert all(read(output / 'series-cleanup.json')[k] for k in ['allStageGroupsAbsent','dependencyLinkAbsent','seriesReservationAbsent','sourceAndRetainedScratchAbsent'])
assert read(output / 'series-process-ownership.json')['allChildrenJoined']
prior_resume = read(output / 'resume-receipt.json')
assert prior_resume['activeChunk'] == 7 and len(prior_resume['completedChunks']) == 6
assert prior_resume['aggregateGets'] == 252 and prior_resume['aggregateDecodedBytes'] == 7278210
assert all(read(output / 'resume-cleanup.json')[k] for k in ['allStageGroupsAbsent','dependencyLinkAbsent','seriesReservationAbsent','sourceAndRetainedScratchAbsent'])
assert read(output / 'resume-process-ownership.json')['allChildrenJoined']
latest_resume = read(output / 'resume08-receipt.json')
assert latest_resume['activeChunk'] == 9 and len(latest_resume['completedChunks']) == 8
assert latest_resume['aggregateGets'] == 324 and latest_resume['aggregateDecodedBytes'] == 9350602
assert all(read(output / 'resume08-cleanup.json')[k] for k in ['allStageGroupsAbsent','dependencyLinkAbsent','seriesReservationAbsent','sourceAndRetainedScratchAbsent'])
assert read(output / 'resume08-process-ownership.json')['allChildrenJoined']
previous_resume = read(output / 'resume10-receipt.json')
assert previous_resume['activeChunk'] == 14 and len(previous_resume['completedChunks']) == 13
assert previous_resume['aggregateGets'] == 504 and previous_resume['aggregateDecodedBytes'] == 14483218
cleanup_recovery = read(output / 'cleanup-recovery14.json')
assert sha(output / 'cleanup-recovery14.json') == resume_plan['cleanupRecoverySha256']
assert cleanup_recovery['originalUncertainCleanupPreservedSha256'] == sha(output / 'resume10-cleanup.json')
assert all(cleanup_recovery[k] for k in ['allGroupsAbsent','scratchAbsent','dependencyLinkAbsent','childAndSeriesReservationsAbsent','allOriginalCheckInputsUnchanged'])
assert all(r['hasLiveMembers'] is False for r in cleanup_recovery['groupObservations'])
assert all(read(output / 'resume10-cleanup.json')[k] for k in ['dependencyLinkAbsent','seriesReservationAbsent','sourceAndRetainedScratchAbsent'])
assert read(output / 'resume10-process-ownership.json')['allChildrenJoined']
assert not os.path.lexists(ROOT / 'server/node_modules')
results = []
for entry in series['chunks'][:14]:
    directory = pathlib.Path(entry['outputDirectory'])
    proof = read(directory / 'live-validation.json'); receipt = read(directory / 'receipt.json')
    assert proof['retainedChecks']['summary'] == {'tests':5,'pass':5,'fail':0,'cancelled':0,'skipped':0,'todo':0}
    assert proof['sourceTrafficDuringValidation'] == 0
    assert receipt['reason'] == 'queue-exhausted' and receipt['processedCandidates'] == 32 and receipt['actualAttempts'] == 36
    assert sha(directory / 'collector-checkpoint.json') == proof['primarySha256'] == receipt['checkpointSha256']
    assert sha(directory / 'final-canonical-index.json') == proof['finalCanonicalIndexSha256']
    assert sha(directory / 'final-spent-request-index.json') == proof['finalSpentRequestIndexSha256']
    for cleanup in [proof['cleanup'], proof['retainedCleanup']]:
        assert all(cleanup[k] for k in ['scratch_absent','dependency_link_absent','groups_absent','reservation_absent','code_identity_unchanged'])
    results.append({'chunk':entry['number'],'allocationId':receipt['allocationId'], 'primarySha256':proof['primarySha256'],
        'proofSha256':sha(directory / 'live-validation.json'),'accepted':receipt['newlyAccepted'],'duplicates':receipt['duplicates'],
        'rejected':receipt['rejected'],'gets':receipt['actualAttempts'],'decodedBytes':receipt['counts']['decodedBytes'],
        'cumulativeAdmitted':proof['cumulativeAdmittedSourceConfigurations']})
third = pathlib.Path(series['chunks'][13]['outputDirectory'])
for name, expected in resume_plan['provedChunk14Pins'].items(): assert sha(third / name) == expected
manifest = read(BASE / 'candidate-manifest.json')
baseline_spent = read(pathlib.Path(manifest['baselineDirectory']) / 'final-spent-request-index.json')['entries']
current_spent = read(third / 'final-spent-request-index.json')['entries']
assert len(baseline_spent) == 558 and len(current_spent) == 1006
assert current_spent[:558] == baseline_spent
assert [e['requestDigest'] for e in current_spent[558:]] == [d for e in series['chunks'][:14] for d in e['requestDigests']]
remaining = series['chunks'][14:]
assert len(remaining) == 18 and sum(e['candidateCount'] for e in remaining) == 576
assert not set(e['requestDigest'] for e in current_spent).intersection(d for e in remaining for d in e['requestDigests'])
assert all(not pathlib.Path(e['outputDirectory']).exists() for e in remaining)
assert all(not os.path.lexists(e['scratchRoot'] + suffix) for e in series['chunks'] for suffix in ['', '-retained', '-retained-direct', '-retained-diagnose01', '-retained-sync', '-retained-recovery07'])
spec = importlib.util.spec_from_file_location('resources', ROOT / '_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
policy = R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':1800,'log_mib':1})
host = R.HostBudget(policy); host._dead_owners = lambda: {}
token = uuid.uuid4().hex
owner_manifest = pathlib.Path(series['outputOwnershipManifest']).with_name('f70-typed-axis1024-resume15-output-ownership.json')
reserved_at = datetime.datetime.fromisoformat(original_marker['reservedAt']).timestamp()
deadline = reserved_at + series['maximumWallSeconds']
assert time.time() < deadline, 'original1800second wall budget remains binding'
started = time.monotonic(); children = []; current = None; finished = reserved = False
aggregate_gets = 504; aggregate_bytes = 14483218; active_chunk = None
reason = 'resumed-series-incomplete'; stopped_error = None
if sys.argv[1:] == ['--preflight']:
    print(json.dumps({'scope':'zero HTTP; no marker/allocation','provedPrefixChunks':14,'spentRequests':1006,
        'alreadySpentFromThisSeries':448,'remainingChunks':18,'remainingCandidates':576,
        'remainingMaximumGets':648,'secondsToOriginalDeadline':deadline-time.time()}))
    sys.exit(0)
assert not sys.argv[1:]
with (BASE / 'resume15-once.json').open('x') as stream:
    os.fchmod(stream.fileno(),0o600)
    stream.write(json.dumps({'id':series['id'],'state':'reserved-and-consumed','resumePlanSha256':sha(BASE/'resume15-plan.json'),
        'spentPrefix':448,'remainingCandidates':576,'reservedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})+'\n')
    stream.flush(); os.fsync(stream.fileno())
descriptor = os.open(BASE,os.O_RDONLY)
try: os.fsync(descriptor)
finally: os.close(descriptor)
ownership = {'schemaVersion':'typed-axis-resume-output-ownership.v1','allocationId':series['id'],'owner':R.owner(),
    'outputRoot':str(output),'disposable':False,'retainOnInterruption':True,'state':'planned','reservationToken':token,
    'scratchRoots':[e['scratchRoot']+suffix for e in remaining for suffix in ['', '-retained-sync']]}
R.atomic_json(owner_manifest,ownership)
logical_bytes = lambda path: sum(p.stat().st_size for p in path.rglob('*') if p.is_file())
def checkpoint(stage,**extra):
    R.atomic_json(output/'resume15-checkpoint.json',{'allocationId':series['id'],'stage':stage,'completedChunks':results,
        'aggregateGets':aggregate_gets,'aggregateDecodedBytes':aggregate_bytes,'elapsedSinceOriginalReservationSeconds':time.time()-reserved_at,
        'activeChunk':active_chunk,**extra})
def finalize():
    global current,finished,reserved
    if finished: return
    if current is not None and current.poll() is None:
        os.killpg(current.pid,signal.SIGTERM)
        try: current.wait(timeout=15)
        except subprocess.TimeoutExpired: os.killpg(current.pid,signal.SIGKILL); current.wait(timeout=5)
        children[-1]['joined'] = True
    groups_absent = all(R.group_has_live_members(r['pid']) is False for r in children)
    leftovers = [p for p in ownership['scratchRoots'] if os.path.lexists(p)]
    link_absent = not os.path.lexists(ROOT/'server/node_modules')
    if reserved: host.release(token); reserved=False
    host_rows = R.read_json(host.path,{}) or {}
    processes = {'allocationId':series['id'],'ownerPid':os.getpid(),'children':children,
        'allChildrenJoined':all(r['joined'] for r in children),'allStageGroupsAbsent':groups_absent,'finished':True}
    cleanup = {'sourceAndRetainedScratchAbsent':not leftovers,'scratchLeftovers':leftovers,'dependencyLinkAbsent':link_absent,
        'allStageGroupsAbsent':groups_absent,'seriesReservationAbsent':token not in host_rows,'durableOutputPreserved':str(output),
        'retainedLogicalBytes':logical_bytes(output),'compatibilityException':None}
    R.atomic_json(output/'resume15-process-ownership.json',processes); R.atomic_json(output/'resume15-cleanup.json',cleanup)
    R.atomic_json(output/'resume15-receipt.json',{'allocationId':series['id'],'reason':reason,'completedChunks':results,
        'activeChunk':active_chunk,'aggregateGets':aggregate_gets,'aggregateDecodedBytes':aggregate_bytes,
        'resumeElapsedSeconds':time.monotonic()-started,'elapsedSinceOriginalReservationSeconds':time.time()-reserved_at,
        'newlyAccepted':sum(r['accepted'] for r in results),'duplicates':sum(r['duplicates'] for r in results),
        'rejected':sum(r['rejected'] for r in results),'stoppedErrorType':stopped_error,'acceptance':False,'remaining':series['remaining']})
    ownership.update(state='finished',cleanup=cleanup,children=processes,reason=reason); R.atomic_json(owner_manifest,ownership)
    finished=True
    if not all([groups_absent,not leftovers,link_absent,token not in host_rows]): raise RuntimeError('named unresolved resume allocation')
atexit.register(finalize)
def run(command,environment,timeout,allow_failure=False):
    global current
    remaining_seconds = deadline-time.time()
    assert remaining_seconds>0,'original finite whole-series wall budget'
    assert all(sha(BASE/p)==h for p,h in resume_plan['codePins'].items()),'amended wrapper pins unchanged'
    current = subprocess.Popen(command,cwd=ROOT,env=environment,start_new_session=True)
    row={'pid':current.pid,'command':command,'joined':False};children.append(row)
    R.atomic_json(output/'resume15-process-ownership.json',{'allocationId':series['id'],'ownerPid':os.getpid(),'children':children})
    try: status=current.wait(timeout=min(timeout,remaining_seconds));row['joined']=True
    except BaseException:
        if current.poll() is None:
            os.killpg(current.pid,signal.SIGTERM)
            try: current.wait(timeout=15)
            except subprocess.TimeoutExpired:os.killpg(current.pid,signal.SIGKILL);current.wait(timeout=5)
        row['joined']=True;raise
    finally:current=None
    if not allow_failure:assert status==0,'owned resume stage failed;preserve and stop'
    return status
environment={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC',
    'TEST_RESOURCE_PARENT_RESERVATION':token,'F70_TYPED_AXIS_SERIES_STAGE':series['id']}
try:
    with R.handled_termination():
        host.acquire(token,series['resources']['peakIncludingRetainedBudgetBytes'],512*R.MIB,cloud,root=output);reserved=True
        ownership.update(state='active');R.atomic_json(owner_manifest,ownership)
        R.atomic_json(output/'released-resume15-plan.json',resume_plan)
        for entry in remaining:
            active_chunk=entry['number'];directory=pathlib.Path(entry['outputDirectory']);checkpoint('preparing-chunk')
            run(['/usr/bin/python3','-I','-B',str(BASE/'prepare-chunk.py'),str(active_chunk)],environment,10)
            allocation=read(directory/'execution-plan.json');checkpoint('chunk-frozen',executionPlanSha256=sha(directory/'execution-plan.json'))
            print(json.dumps({'stage':'source-start','chunk':active_chunk,'allocationId':allocation['id'],'maxGets':36}),flush=True)
            status=run(['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),str(active_chunk)],
                {**environment,'F70_TYPED_AXIS_SOURCE_GRANT':allocation['id']},190,allow_failure=True)
            if (directory/'receipt.json').exists():
                receipt=read(directory/'receipt.json');aggregate_gets+=receipt['actualAttempts'];aggregate_bytes+=(receipt.get('counts') or {}).get('decodedBytes',0)
                checkpoint('source-stopped' if status else 'source-completed-awaiting-proof')
            assert status==0 and receipt['reason']=='queue-exhausted' and receipt['processedCandidates']==32
            assert aggregate_gets<=1152 and aggregate_bytes<=series['decodedBytes']
            run(['/usr/bin/python3','-I','-B',str(BASE/'reconcile-retained-sync.py'),str(active_chunk)],environment,10)
            run(['/usr/bin/python3','-I','-B',str(BASE/'verify-retained-sync.py'),str(active_chunk)],environment,45)
            proof=read(directory/'live-validation.json');shard_bytes=logical_bytes(directory)
            assert shard_bytes<=series['resources']['perChunkRetainedShardBytes'] and logical_bytes(output)<=series['resources']['retainedBudgetBytes']
            host.update(token,R.allocated_bytes(output),0)
            results.append({'chunk':active_chunk,'allocationId':allocation['id'],'primarySha256':proof['primarySha256'],
                'proofSha256':sha(directory/'live-validation.json'),'accepted':receipt['newlyAccepted'],'duplicates':receipt['duplicates'],
                'rejected':receipt['rejected'],'gets':receipt['actualAttempts'],'decodedBytes':receipt['counts']['decodedBytes'],
                'cumulativeAdmitted':proof['cumulativeAdmittedSourceConfigurations'],'retainedShardBytes':shard_bytes})
            checkpoint('chunk-proved');print(json.dumps({'stage':'chunk-proved',**results[-1]}),flush=True)
        reason='finite-typed-axis1024-series-exhausted';active_chunk=None
except BaseException as error:
    stopped_error=type(error).__name__;checkpoint('stopped',errorType=stopped_error);raise
finally:finalize()
