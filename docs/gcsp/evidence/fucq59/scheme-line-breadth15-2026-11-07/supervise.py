"""Owned bounded source, retained proof or preparation check; no retries."""
import sys
sys.dont_write_bytecode=True
import atexit,datetime,hashlib,importlib.util,json,os,pathlib,re,subprocess,time
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==3 and sys.argv[1] in ['source','proof','validate'],'exact stage and context required'
stage,context=sys.argv[1:]
if stage=='source':assert os.environ.get('BMW_BREADTH15_CONTEXT_GRANT'),'explicit-root-context-grant-required'
series=json.loads((BASE/'series-plan.json').read_text());entry=next((e for e in series['contexts'] if e['id']==context),None)
assert stage=='validate' and context=='prepared' or entry is not None,'exact declared context required'
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert all(sha(ROOT/p)==h for p,h in {**series['codePins'],**series['sourcePins']}.items()),'frozen code/input mismatch'
assert all(sha(pathlib.Path(p))==h for p,h in series['runtimePins'].items()),'frozen runtime mismatch'
directory=pathlib.Path(series['outputRoot'])/context
seconds=105 if stage in ['source','validate'] else 30
if stage=='source':
    assert os.environ.get('BMW_BREADTH15_CONTEXT_GRANT')==entry['allocationId'],'explicit-root-context-grant-required'
    assert series['qualificationDate']==datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),'source-date-mismatch'
    assert not (directory/'execution-once.json').exists() and not (directory/'collector-checkpoint.json').exists(),'spent-primary-preserved'
    phase=series['phases'][entry['phase']];marker=read(pathlib.Path(series['outputRoot'])/(entry['phase']+'-once.json'))
    assert marker['id']==phase['grantId'] and marker['state']=='reserved-and-consumed'
    seconds=min(seconds,phase['maximumWallSeconds']-(time.time()-datetime.datetime.fromisoformat(marker['reservedAt']).timestamp()))
    assert seconds>0,'original-phase-clock-expired'
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
spec=importlib.util.spec_from_file_location('exporter',BASE/'export-retained.py');E=importlib.util.module_from_spec(spec);spec.loader.exec_module(E)
OUT=pathlib.Path(series['supervisorRoot'])/(context+'-'+stage)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1})
scratch=R.Scratch(OUT,ROOT,policy,expected=R.MIB,checkpoint=directory/'collector-checkpoint.json' if entry else None);host=R.HostBudget(policy)
command=['/opt/homebrew/bin/node',str(BASE/'run-live.mjs'),context] if stage=='source' else ['/opt/homebrew/bin/node',str(BASE/'audit-live.mjs'),context] if stage=='proof' else ['/opt/homebrew/bin/node','--test','--test-concurrency=1',str(BASE/'prepared-check.test.mjs')]
R.atomic_json(OUT/'selected-checks.json',{'scope':'scoped '+stage,'changedPaths':[str(BASE.relative_to(ROOT))],
 'regression':'exact literal input/finite3GET safe projection, durable actual primary/export, no replay and zero-fetch retained audit',
 'callers':['existing diagnostic','unchanged range registration and shared transport'],'identity':series['codePins'],'command':command,
 'exclusions':['full suite','production grammar repair','options','solver','images','admissions','UI/publication'],
 'forecast':{'scratchBytes':R.MIB,'ramBytes':128*R.MIB,'seconds':10},'limits':series['resources']})
entered=reserved=finished=False;result={};exported=None;export_issue=None
def finalize():
    global entered,reserved,finished,exported,export_issue
    if finished:return
    groups=all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
    if not groups:raise RuntimeError('owned-process-group-absence-unproved')
    if stage=='source' and (directory/'collector-checkpoint.json').exists():
        try:exported=E.export(directory)
        except Exception as error:
            export_issue={'issue':'diagnostic-export-failed','errorType':type(error).__name__,'primaryPreserved':True}
            R.atomic_json(directory/'checkpoint-export-failure.json',export_issue)
    if entered:
        opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
        if opened.returncode not in [0,1] or opened.stdout.strip():raise RuntimeError('owned-open-file-absence-unproved')
        scratch.__exit__(None,None,None);entered=False
    if reserved:host.release(scratch.token);reserved=False
    R.atomic_json(OUT/'cleanup.json',{'scratchRoot':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':groups,
      'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'manifest':str(scratch.manifest),'removedBytes':scratch.record['peak'],
      'checkpointExport':exported,'exportIssue':export_issue,'retainedPrimary':str(directory/'collector-checkpoint.json') if entry else None,
      'compatibilityException':None,'leftovers':[]})
    finished=True
atexit.register(finalize)
with R.handled_termination():
    try:
        host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True;scratch.__enter__();entered=True
        env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC'}
        if stage=='source':env['BMW_BREADTH15_CONTEXT_GRANT']=entry['allocationId']
        if stage=='validate':env['NODE_V8_COVERAGE']=str(scratch.root/'v8-coverage')
        result=R.run_process(command,ROOT,env,OUT/'check.log',scratch,policy,64*R.MIB,448*R.MIB,seconds,host)
        log=(OUT/'check.log').read_text();result['testCounts']={k:int(m.group(1)) for k in ['tests','pass','fail','skipped'] if (m:=re.search(r'(?:#|ℹ) '+k+r' (\d+)',log))} if stage=='validate' else None
        if stage=='validate':
            contexts=[]
            for path in (scratch.root/'v8-coverage').glob('*.json'):
                coverage=read(path)
                for item in coverage.get('result',[]):
                    url=item.get('url','')
                    if url.startswith('file://'+str(ROOT)+'/'):
                        functions=item.get('functions',[])
                        contexts.append({'path':url.removeprefix('file://'+str(ROOT)+'/'),'functionsObserved':sum(any(r.get('count',0)>0 for r in f.get('ranges',[])) for f in functions),'functionsListed':len(functions)})
            R.atomic_json(OUT/'coverage-contexts.json',{'scope':'bounded required preparation validation; process contexts, not exhaustive per-test attribution','contexts':contexts,'missingObservationsDoNotProveIrrelevance':True})
            result['coverageContextPath']=str(OUT/'coverage-contexts.json')
        result['codeIdentityUnchanged']=all(sha(ROOT/p)==h for p,h in series['codePins'].items());R.atomic_json(OUT/'result.json',result)
        if result['rc'] or result['issue']:print(log[-12000:])
        else:(OUT/'check.log').unlink()
    finally:finalize()
print(json.dumps({'stage':stage,'context':context,'rc':result.get('rc'),'issue':result.get('issue'),'wall':result.get('wall'),'testCounts':result.get('testCounts'),'cleanup':read(OUT/'cleanup.json')}))
sys.exit(0 if result.get('rc')==0 and not result.get('issue') and result.get('codeIdentityUnchanged') and not export_issue else 1)
