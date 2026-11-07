"""Two exact separately released phases, each consumed once; first actual review precedes suffix."""
import sys
sys.dont_write_bytecode=True
import atexit,datetime,hashlib,importlib.util,json,os,pathlib,signal,subprocess,time,uuid
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==2 and sys.argv[1] in ['first','remaining'],'one declared phase required'
if not os.environ.get('BMW_BREADTH15_PHASE_GRANT'):raise AssertionError('explicit-root-phase-grant-required')
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
series=read(BASE/'series-plan.json');name=sys.argv[1];phase=series['phases'][name]
assert os.environ['BMW_BREADTH15_PHASE_GRANT']==phase['grantId'],'explicit-root-phase-grant-required'
assert all(sha(ROOT/p)==h for p,h in {**series['codePins'],**series['sourcePins']}.items()),'frozen input/code mismatch'
assert all(sha(pathlib.Path(p))==h for p,h in series['runtimePins'].items()),'runtime pin mismatch'
assert series['qualificationDate']==datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),'observation date mismatch'
output=pathlib.Path(series['outputRoot']);entries=[e for e in series['contexts'] if e['phase']==name]
assert [e['id'] for e in entries]==phase['contexts'] and len(entries)*3==phase['getCeiling']
assert not (output/(name+'-once.json')).exists(),'phase already consumed; no replay'
assert all(not (output/e['id']).exists() for e in entries),'preserve actual context prefix'
if name=='first':assert not output.exists(),'preserve prior source output'
else:
    proof=output/'g21/live-validation.json';assert proof.exists() and read(output/'first-receipt.json')['reason']=='finite-first-exhausted'
    assert sha(proof)==os.environ.get('BMW_BREADTH15_FIRST_PROOF_SHA256'),'exact reviewed first proof required'
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':600,'log_mib':1});host=R.HostBudget(policy)
token=uuid.uuid4().hex;manifest=pathlib.Path(series['supervisorRoot'])/'ownership'/('durable-'+name+'.json')
assert not manifest.exists(),'preserve phase ownership'
ownership={'schemaVersion':'bmw-breadth15-output-ownership.v1','owner':R.owner(),'outputRoot':str(output),'disposable':False,'retainOnInterruption':True,'state':'planned','token':token}
R.atomic_json(manifest,ownership)
current=None;children=[];results=[];started=None;reserved=finished=False;reason='incomplete';active=None;error_type=None
def logical_bytes(path):return sum(p.stat().st_size for p in path.rglob('*') if p.is_file()) if path.exists() else 0
def finalize():
    global current,reserved,finished
    if finished:return
    if current is not None and current.poll() is None:
        os.killpg(current.pid,signal.SIGTERM)
        try:current.wait(timeout=15)
        except subprocess.TimeoutExpired:os.killpg(current.pid,signal.SIGKILL);current.wait(timeout=5)
        children[-1]['joined']=True
    groups=all(R.group_has_live_members(c['pid']) is False for c in children)
    manifests=[p for e in entries for stage in ['source','proof'] for p in (pathlib.Path(series['supervisorRoot'])/(e['id']+'-'+stage)/'ownership').glob('*.json')]
    roots=[]
    for p in manifests:
        row=read(p)
        if row.get('token') and row.get('version')==1:roots.append(row['root'])
    leftovers=[p for p in roots if os.path.lexists(p)]
    if reserved:host.release(token);reserved=False
    cleanup={'allChildrenJoined':all(c['joined'] for c in children),'allStageGroupsAbsent':groups,'scratchRoots':roots,'scratchAbsent':not leftovers,
      'reservationAbsent':token not in (R.read_json(host.path,{}) or {}),'retainedOutput':str(output),'retainedBytes':logical_bytes(output),'leftovers':leftovers,'compatibilityException':None}
    attempted=[]
    for entry in entries:
        directory=output/entry['id'];events=directory/'source-events.jsonl';primary=directory/'collector-checkpoint.json'
        if events.exists():
            rows=[json.loads(line) for line in events.read_text().splitlines() if line]
            counts=read(primary)['content']['counts'] if primary.exists() else None
            attempted.append({'context':entry['id'],'startedGets':sum(r['phase']=='started' for r in rows),'receivedHeaders':sum(r['phase']=='headers-received' for r in rows),'counts':counts,'primaryPreserved':primary.exists()})
    receipt={'phase':name,'reason':reason,'completedContexts':results,'attemptedContexts':attempted,'activeContext':active,'elapsedSeconds':time.monotonic()-started if started else 0,
      'actualGets':sum(r['startedGets'] for r in attempted),'decodedBytes':sum((r['counts'] or {}).get('decodedBytes',0) for r in attempted),'errorType':error_type,'admitted':0,'sourceCapacityCredit':0,'acceptance':False}
    if output.exists():R.atomic_json(output/(name+'-receipt.json'),receipt);R.atomic_json(output/(name+'-cleanup.json'),cleanup)
    ownership.update(state='finished',reason=reason,children=children,cleanup=cleanup);R.atomic_json(manifest,ownership);finished=True
    assert groups and not leftovers and cleanup['allChildrenJoined'] and cleanup['reservationAbsent'],'named cleanup issue; preserve evidence'
atexit.register(finalize)
def run(command,env,timeout):
    global current
    remaining=phase['maximumWallSeconds']-(time.monotonic()-started);assert remaining>0,'original phase clock expired'
    current=subprocess.Popen(command,cwd=ROOT,env=env,start_new_session=True);row={'pid':current.pid,'joined':False,'command':command};children.append(row)
    try:status=current.wait(timeout=min(timeout,remaining));row['joined']=True
    except BaseException:
        if current.poll() is None:
            os.killpg(current.pid,signal.SIGTERM)
            try:current.wait(timeout=15)
            except subprocess.TimeoutExpired:os.killpg(current.pid,signal.SIGKILL);current.wait(timeout=5)
        row['joined']=True;raise
    finally:current=None
    assert status==0,'owned stage failed; actual primary preserved; no replay'
env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','TEST_RESOURCE_PARENT_RESERVATION':token}
try:
    with R.handled_termination():
        host.acquire(token,80*R.MIB,512*R.MIB,ROOT,root=output);reserved=True
        output.mkdir(parents=True,exist_ok=name=='remaining')
        with (output/(name+'-once.json')).open('x') as stream:
            stream.write(json.dumps({'id':phase['grantId'],'state':'reserved-and-consumed','seriesPlanSha256':sha(BASE/'series-plan.json'),'reservedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})+'\n');stream.flush();os.fsync(stream.fileno())
        started=time.monotonic();ownership['state']='active';R.atomic_json(manifest,ownership)
        for entry in entries:
            active=entry['id'];directory=output/active;directory.mkdir()
            run(['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),'source',active],{**env,'BMW_BREADTH15_CONTEXT_GRANT':entry['allocationId']},120)
            run(['/usr/bin/python3','-I','-B',str(BASE/'supervise.py'),'proof',active],env,45)
            proof=read(directory/'live-validation.json');receipt=read(directory/'receipt.json')
            assert receipt['actualAttempts']==3 and receipt['reason']=='source-contract-diagnostic-observed'
            assert logical_bytes(output)<=series['resources']['retainedBudgetBytes'],'retained budget'
            results.append({'context':active,'gets':receipt['actualAttempts'],'decodedBytes':proof['decodedBytes'],'proofSha256':sha(directory/'live-validation.json'),**proof})
            R.atomic_json(output/(name+'-checkpoint.json'),{'completedContexts':results,'activeContext':active,'admitted':0,'acceptance':False})
            print(json.dumps({'stage':'context-proved','context':active,'proofSha256':results[-1]['proofSha256'],'modelNodes':proof['modelNodes'],'relationships':proof['relationships'],'originalRefusal':proof['originalRefusal']}),flush=True)
        reason='finite-'+name+'-exhausted';active=None
except BaseException as error:error_type=type(error).__name__;raise
finally:finalize()
