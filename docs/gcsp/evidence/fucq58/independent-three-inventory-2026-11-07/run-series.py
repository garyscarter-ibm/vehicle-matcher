"""Three independent, separately released, consumed-once phases. Never replay a failed prefix."""
import sys
sys.dont_write_bytecode=True
import atexit,datetime,fcntl,importlib.util,json,os,pathlib,subprocess,time,uuid
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==2 and sys.argv[1] in ['g20','g22','g23'],'exact-declared-phase-required'
assert os.environ.get('BMW_F58_INDEPENDENT_PHASE_GRANT'),'exact-root-phase-grant-required'
spec=importlib.util.spec_from_file_location('release',BASE/'release.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
series=G.load_series();name=sys.argv[1];phase,release=G.phase_release(series,name);read=G.read;sha=G.sha
output=pathlib.Path(series['outputRoot']);control=pathlib.Path(series['supervisorRoot']);entries=[e for e in series['contexts'] if e['phase']==name]
assert [e['id'] for e in entries]==phase['contexts'] and len(entries)*3==phase['getCeiling'],'exact-finite-phase-required'
assert not output.is_symlink() and not (output/(name+'-once.json')).exists(),'phase-consumed-no-replay'
assert all(not os.path.lexists(output/e['id']) for e in entries),'preserve-actual-context-prefix'
assert not output.exists() or output.is_dir(),'preserve-independent-output-root'
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
policy=R.Policy({'chunk_scratch_mib':80,'chunk_ram_mib':576,'chunk_seconds':150,'log_mib':1});host=R.HostBudget(policy)
token=uuid.uuid4().hex;manifest=control/'ownership'/('durable-'+name+'.json')
assert not os.path.lexists(manifest),'preserve-phase-ownership'
ownership={'schemaVersion':'f58-independent-output-ownership.v1','owner':R.owner(),'outputRoot':str(output),'disposable':False,'retainOnInterruption':True,'state':'planned','token':token,'planSha256':sha(BASE/'series-plan.json'),'releaseSha256':sha(BASE/phase['releaseFile'])}
current=None;children=[];results=[];started=None;reserved=finished=False;reason='incomplete';active=None;error_type=None;allocation=None;phase_lock=None
logical_bytes=lambda p:sum(f.stat().st_size for f in p.rglob('*') if f.is_file()) if p.exists() else 0
def trace_rows(path):
    rows=[];invalid=0
    for line in path.read_text().splitlines() if path.exists() else []:
        try:
            value=json.loads(line)
            if isinstance(value,dict):rows.append(value)
            else:invalid+=1
        except json.JSONDecodeError:invalid+=1
    return rows,invalid
def finalize():
    global current,reserved,finished,phase_lock
    if finished:return
    if current is not None:
        R.stop_group(current);children[-1]['joined']=True;current=None
    stage_manifests=[p for e in entries for stage in ['source','proof'] for p in (control/(e['id']+'-'+stage)/'ownership').glob('*.json')]
    stages=[read(p) for p in stage_manifests];groups=[c['pid'] for c in children]+[g for s in stages for g in s.get('groups',[])]
    roots=[s['root'] for s in stages if s.get('version')==1 and s.get('token')];leftovers=[p for p in roots if os.path.lexists(p)]
    groups_absent=all(R.group_has_live_members(g) is False for g in groups)
    if reserved:host.release(token);reserved=False
    registry=R.read_json(host.path,{}) or {};tokens=[token]+[s['token'] for s in stages if s.get('token')]
    cleanup={'allChildrenJoined':all(c['joined'] for c in children),'groups':groups,'allStageGroupsAbsent':groups_absent,'scratchRoots':roots,'scratchAbsent':not leftovers,'reservationTokens':tokens,'reservationAbsent':all(t not in registry for t in tokens),'removedScratchBytes':sum(s.get('peak',0) for s in stages),'retainedOutput':str(output),'leftovers':leftovers,'compatibilityException':None,'dependencyPathTouched':False,'dependencyLinkAbsent':not os.path.lexists(ROOT/'server/node_modules'),'identityUnchanged':all(sha(ROOT/p)==h for p,h in {**series['codePins'],**series['sourcePins']}.items()) and all(sha(p)==h for p,h in series['externalPins'].items()),'phaseLockReleasedAfterReceipt':True}
    attempted=[]
    for entry in entries:
        directory=output/entry['id'];events=directory/'source-events.jsonl';primary=directory/'collector-checkpoint.json'
        if events.exists():
            rows,event_invalid=trace_rows(events);identities,identity_invalid=trace_rows(directory/'request-identities.jsonl')
            counts=read(primary)['content']['counts'] if primary.exists() else None
            attempted.append({'context':entry['id'],'startedGets':len(identities),'collectorStartedAttempts':sum(r.get('phase')=='started' for r in rows),'receivedHeaders':sum(r.get('phase')=='headers-received' for r in rows),'unparsedEventLines':event_invalid,'unparsedIdentityLines':identity_invalid,'counts':counts,'primaryPreserved':primary.exists()})
    receipt={'phase':name,'reason':reason,'completedContexts':results,'attemptedContexts':attempted,'activeContext':active,'elapsedSeconds':time.monotonic()-started if started else 0,'actualGets':sum(r['startedGets'] for r in attempted),'actualGetsKnownLowerBound':any(r['unparsedIdentityLines'] for r in attempted),'decodedBytes':sum((r['counts'] or {}).get('decodedBytes',0) for r in attempted),'errorType':error_type,'resourceAllocation':allocation,'admitted':0,'sourceCapacityCredit':0,'qualifiedSchemeJoins':0,'qualifiedPhysicalFacts':0,'acceptance':False}
    if output.exists():
        R.atomic_json(output/(name+'-receipt.json'),receipt)
        # Iterate the self-inclusive byte count to a fixed point after all retained writes.
        cleanup['retainedBytes']=0
        for _ in range(8):
            R.atomic_json(output/(name+'-cleanup.json'),cleanup);actual=logical_bytes(output)
            if actual==cleanup['retainedBytes']:break
            cleanup['retainedBytes']=actual
        assert logical_bytes(output)==cleanup['retainedBytes'],'retained-byte-accounting-incomplete'
    ownership.update(state='finished',reason=reason,children=children,cleanup=cleanup);R.atomic_json(manifest,ownership)
    if phase_lock is not None:fcntl.flock(phase_lock,fcntl.LOCK_UN);os.close(phase_lock);phase_lock=None
    finished=True
    assert groups_absent and not leftovers and cleanup['allChildrenJoined'] and cleanup['reservationAbsent'] and cleanup['identityUnchanged'],'named-cleanup-issue-preserve-evidence'
atexit.register(finalize)
# The finalizer is registered before the ownership manifest or retained output is created.
control.mkdir(parents=True,exist_ok=True)
phase_lock=os.open(control/'active-phase.lock',os.O_CREAT|os.O_RDWR,0o600)
try:fcntl.flock(phase_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:
    os.close(phase_lock);phase_lock=None;finished=True;raise AssertionError('other-independent-phase-active')
R.atomic_json(manifest,ownership)
def run(command,env,timeout):
    global current
    remaining=phase['maximumWallSeconds']-(time.monotonic()-started);assert remaining>0,'original-phase-clock-expired'
    current=subprocess.Popen(command,cwd=ROOT,env=env,start_new_session=True);row={'pid':current.pid,'joined':False,'command':command};children.append(row)
    try:status=current.wait(timeout=min(timeout,remaining))
    finally:R.stop_group(current);row['joined']=True;current=None
    assert status==0,'owned-stage-failed-primary-preserved-no-replay'
env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','TEST_RESOURCE_PARENT_RESERVATION':token,'BMW_F58_INDEPENDENT_PHASE_GRANT':phase['grantId']}
try:
    with R.handled_termination():
        allocation=host.acquire(token,80*R.MIB,576*R.MIB,ROOT,root=output,minimum_disk=24*R.MIB,minimum_ram=320*R.MIB);reserved=True
        output.mkdir(parents=True,exist_ok=True)
        with (output/(name+'-once.json')).open('x') as stream:
            os.fchmod(stream.fileno(),0o600);stream.write(json.dumps({'id':phase['grantId'],'state':'reserved-and-consumed','planSha256':sha(BASE/'series-plan.json'),'releaseSha256':sha(BASE/phase['releaseFile']),'reservedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})+'\n');stream.flush();os.fsync(stream.fileno())
        started=time.monotonic();ownership['state']='active';R.atomic_json(manifest,ownership)
        for entry in entries:
            active=entry['id'];directory=output/active;directory.mkdir(mode=0o700)
            run(['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),'source',active],{**env,'BMW_F58_INDEPENDENT_CONTEXT_GRANT':entry['allocationId']},120)
            run(['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),'proof',active],env,45)
            proof=read(directory/'live-validation.json');receipt=read(directory/'receipt.json')
            assert receipt['actualAttempts']==3 and receipt['reason']=='source-contract-diagnostic-observed','actual-three-GET-diagnostic-required'
            assert logical_bytes(output)<=series['resources']['retainedBudgetBytes'],'retained-budget-exceeded'
            results.append({'context':active,'gets':receipt['actualAttempts'],'proofSha256':sha(directory/'live-validation.json'),**proof})
            R.atomic_json(output/(name+'-checkpoint.json'),{'completedContexts':results,'activeContext':active,'admitted':0,'acceptance':False})
            print(json.dumps({'stage':'context-proved','context':active,'proofSha256':results[-1]['proofSha256'],'modelNodes':proof['modelNodes'],'relationships':proof['relationships'],'originalRefusal':proof['originalRefusal']}),flush=True)
        reason='finite-'+name+'-exhausted';active=None
except BaseException as error:error_type=type(error).__name__;raise
finally:finalize()
