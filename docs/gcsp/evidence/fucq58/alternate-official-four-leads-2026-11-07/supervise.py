"""One owned source/proof/offline-check chunk. Never retries a source allocation."""
import sys
sys.dont_write_bytecode=True
import atexit,datetime,hashlib,importlib.util,json,os,pathlib,re,subprocess,time
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==3 and sys.argv[1] in ['source','proof','validate'],'exact-stage-and-context-required'
stage,context=sys.argv[1:]
if stage=='source':assert os.environ.get('BMW_F58_FOUR_MODEL_CONTEXT_GRANT') and os.environ.get('BMW_F58_FOUR_MODEL_PHASE_GRANT'),'exact-root-context-and-phase-grants-required'
spec=importlib.util.spec_from_file_location('release',BASE/'release.py');G=importlib.util.module_from_spec(spec);spec.loader.exec_module(G)
series=G.load_series();read=G.read;sha=G.sha
entry=next((e for e in series['contexts'] if e['id']==context),None)
assert stage=='validate' and context=='prepared' or entry is not None,'exact-declared-context-required'
directory=pathlib.Path(series['outputRoot'])/context;seconds=105 if stage in ['source','validate'] else 30
if stage=='source':
    phase,release=G.phase_release(series,entry['phase'])
    assert os.environ['BMW_F58_FOUR_MODEL_CONTEXT_GRANT']==entry['allocationId'],'exact-root-context-grant-required'
    assert not directory.is_symlink() and directory.is_dir() and not (directory/'execution-once.json').exists() and not (directory/'collector-checkpoint.json').exists(),'spent-primary-preserved'
    marker=read(pathlib.Path(series['outputRoot'])/(entry['phase']+'-once.json'))
    assert marker['id']==phase['grantId'] and marker['state']=='reserved-and-consumed' and marker['planSha256']==sha(BASE/'series-plan.json') and marker['releaseSha256']==sha(BASE/phase['releaseFile']),'exact-consumed-phase-required'
    elapsed=time.time()-datetime.datetime.fromisoformat(marker['reservedAt']).timestamp();assert 0<=elapsed<phase['maximumWallSeconds'],'original-phase-clock-expired'
    seconds=min(seconds,phase['maximumWallSeconds']-elapsed)
    assert 0<seconds<=105,'original-phase-clock-expired'
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
spec=importlib.util.spec_from_file_location('exporter',ROOT/'docs/gcsp/evidence/fucq59/scheme-line-breadth15-2026-11-07/export-retained.py');E=importlib.util.module_from_spec(spec);spec.loader.exec_module(E)
OUT=pathlib.Path(series['supervisorRoot'])/(context+'-'+stage)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1})
scratch=R.Scratch(OUT,ROOT,policy,expected=R.MIB,checkpoint=directory/'collector-checkpoint.json' if entry else None);host=R.HostBudget(policy)
node=series['nodeRuntime'];command=[node,str(BASE/'run-live.mjs'),context] if stage=='source' else [node,str(BASE/'audit-live.mjs'),context] if stage=='proof' else [node,'--test','--test-concurrency=1',str(BASE/'prepared-check.test.mjs')]
R.atomic_json(OUT/'selected-checks.json',{'scope':'scoped '+stage,'changedPaths':[str(BASE.relative_to(ROOT))],'regression':'exact4datedinputs/finite3GET, safe URL identity log, durable primary/export, no replay and zero-fetch retained audit','affectedCallers':['existing runContext/createContractDiagnostic/export/audit; unchanged adapter/transport'],'identity':series['codePins'],'command':command,'excluded':['full suite','existing production protocol proof replays','grammar repair','options','solver','images','admissions','UI/SQL/VIN activation'],'forecast':{'scratchBytes':R.MIB,'ramBytes':128*R.MIB,'seconds':10},'limits':series['resources']})
entered=reserved=finished=False;result={};exported=None;export_issue=None;allocation=None
def finalize():
    global entered,reserved,finished,exported,export_issue
    if finished:return
    groups=all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
    if not groups:raise RuntimeError('owned-process-group-absence-unproved')
    if stage=='source' and (directory/'collector-checkpoint.json').exists():
        try:exported=E.export(directory)
        except Exception as error:
            export_issue={'issue':'diagnostic-export-failed','errorType':type(error).__name__,'primaryPreserved':True};R.atomic_json(directory/'checkpoint-export-failure.json',export_issue)
    if entered:
        opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
        if opened.returncode not in [0,1] or opened.stdout.strip():raise RuntimeError('owned-open-file-absence-unproved')
        scratch.__exit__(None,None,None);entered=False
    if reserved:host.release(scratch.token);reserved=False
    cleanup={'scratchRoot':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groups':scratch.record['groups'],'groupsAbsent':groups,'reservationToken':scratch.token,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'manifest':str(scratch.manifest),'removedBytes':scratch.record['peak'],'checkpointExport':exported,'exportIssue':export_issue,'retainedPrimary':str(directory/'collector-checkpoint.json') if entry else None,'identityUnchanged':all(sha(ROOT/p)==h for p,h in {**series['codePins'],**series['sourcePins']}.items()),'dependencyPathTouched':False,'dependencyLinkAbsent':not os.path.lexists(ROOT/'server/node_modules'),'compatibilityException':None,'leftovers':[]}
    R.atomic_json(OUT/'cleanup.json',cleanup);finished=True
atexit.register(finalize)
with R.handled_termination():
    try:
        allocation=host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root,minimum_disk=16*R.MIB,minimum_ram=256*R.MIB);reserved=True;scratch.__enter__();entered=True
        env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC'}
        if stage=='source':env.update(BMW_F58_FOUR_MODEL_CONTEXT_GRANT=entry['allocationId'],BMW_F58_FOUR_MODEL_PHASE_GRANT=phase['grantId'])
        if stage=='validate':env['NODE_V8_COVERAGE']=str(scratch.root/'v8-coverage')
        result=R.run_process(command,ROOT,env,OUT/'check.log',scratch,policy,allocation['disk'],min(448*R.MIB,allocation['ram']-64*R.MIB),seconds,host)
        log=(OUT/'check.log').read_text();result['testCounts']={k:int(m.group(1)) for k in ['tests','pass','fail','skipped'] if (m:=re.search(r'(?:#|ℹ) '+k+r' (\d+)',log))} if stage=='validate' else None
        if stage=='validate':
            contexts=[]
            for path in (scratch.root/'v8-coverage').glob('*.json'):
                for item in read(path).get('result',[]):
                    url=item.get('url','')
                    if url.startswith('file://'+str(ROOT)+'/'):
                        functions=item.get('functions',[]);contexts.append({'path':url.removeprefix('file://'+str(ROOT)+'/'),'functionsObserved':sum(any(r.get('count',0)>0 for r in f.get('ranges',[])) for f in functions),'functionsListed':len(functions)})
            R.atomic_json(OUT/'coverage-contexts.json',{'scope':'selected new-harness checks only; observed contexts are not exhaustive per-test attribution','contexts':contexts,'missingObservationsDoNotProveIrrelevance':True})
        result['codeIdentityUnchanged']=all(sha(ROOT/p)==h for p,h in {**series['codePins'],**series['sourcePins']}.items());result['resourceAllocation']=allocation;R.atomic_json(OUT/'result.json',result)
        if result['rc'] or result['issue']:print(log[-12000:])
        else:(OUT/'check.log').unlink()
    finally:finalize()
print(json.dumps({'stage':stage,'context':context,'rc':result.get('rc'),'issue':result.get('issue'),'wall':result.get('wall'),'testCounts':result.get('testCounts'),'cleanup':read(OUT/'cleanup.json')}))
raise SystemExit(0 if result.get('rc')==0 and not result.get('issue') and result.get('codeIdentityUnchanged') and not export_issue else 1)
