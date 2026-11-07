"""Exact serial six-session options qualification. Separate parent release required."""
import sys
sys.dont_write_bytecode=True
import atexit,datetime,hashlib,importlib.util,json,os,pathlib,subprocess,time
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==2 and sys.argv[1]=='live','explicit-live-phase-required'
ID='scheme-breadth-remaining24-model-options-root-20261107-once'
assert os.environ.get('BMW_BREADTH_REMAINING24_OPTIONS_ROOT_SOURCE_GRANT')==ID,'explicit-root-traffic-grant-required'
read=lambda p:json.loads(p.read_text())
allocation=read(BASE/'execution-plan.json')
assert allocation['id']==ID and allocation['contextIds']==['g21-t3be', 'g21-t3mr', 'g21-t3pf', 'g21-t3pk', 'g21-t3pr', 'u11-ix1h', 'u11-ix1k', 'u11-ix1l', 'u11-x135', 'u11-x1m1', 'u11-x1m2', 'u11-x1m3', 'u11-x1m6', 'u11-x1m7', 'u11-x1x0', 'u11-x1x2', 'u11-x1x3', 'u11-x1x6', 'u11-x1x7', 'u11-x1xl', 'u10-ix25', 'u10-x235', 'g26e-i4mg', 'g26e-i4pc'] and allocation['publicGetCeiling']==96,'source-allocation-mismatch'
assert allocation['qualificationDate']==datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),'source-qualification-date-mismatch'
assert not (BASE/'execution-once.json').exists(),'never-replay-spent-series'
assert all(not (BASE/id/name).exists() for id in allocation['contextIds'] for name in ['execution-once.json','collector-checkpoint.json']),'existing-context-progress-preserved'
hashes=lambda:{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in allocation['codePins']}
runtimes=lambda:{p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in allocation['runtimePins']}
assert hashes()==allocation['codePins'] and runtimes()==allocation['runtimePins'],'source-code-or-runtime-pin-mismatch'
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
spec=importlib.util.spec_from_file_location('options_exporter',BASE/'export-retained.py');E=importlib.util.module_from_spec(spec);spec.loader.exec_module(E)
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth-remaining24-model-options-root/live')
OUT.mkdir(parents=True,exist_ok=False)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1});host=R.HostBudget(policy)
series={'allocationId':ID,'planDigest':allocation['planDigest'],'contexts':[],'newConfigurations':0,'sourceCapacityCredit':0,'acceptance':False}
active=None;entered=reserved=finished=False;started=time.monotonic()
def cleanup_chunk():
    global entered,reserved,active
    if active is None:return
    scratch,directory,row=active
    groups=all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
    if not groups:raise RuntimeError('owned-source-child-absence-unproved')
    try:row['checkpointExport']=E.export(directory)
    except Exception as error:row['exportIssue']={'errorType':type(error).__name__,'primaryPreserved':True}
    try:
        primary=directory/'collector-checkpoint.json'
        if primary.exists():row['checkpointCounts']=read(primary)['content']['counts']
        events=directory/'source-events.jsonl';rows=[json.loads(line) for line in events.read_text().splitlines()] if events.exists() else []
        row['sourceEventsStarted']=sum(r.get('phase')=='started' for r in rows)
        receipt=read(directory/'receipt.json') if (directory/'receipt.json').exists() else None;row['retainedReceipt']=receipt
        if not receipt or receipt.get('reason')!='source-options-qualified' or receipt.get('allocationId')!=ID or receipt.get('planDigest')!=allocation['contextPlanDigests'][row['id']] or receipt.get('modelCode')!=read(directory/'qualification-plan.json')['modelRegistration']['modelCode'] or receipt.get('actualAttempts')!=4 or receipt.get('counts',{}).get('httpAttempts')!=4 or receipt.get('counts',{}).get('operations')!={'page':1,'settings':1,'discover':1,'options':1} or not 0<receipt.get('counts',{}).get('decodedBytes',0)<=4194304 or receipt.get('checkpointSha256')!=row.get('checkpointExport',{}).get('checkpointSha256') or row['sourceEventsStarted']!=4 or [r.get('status') for r in rows if r.get('phase')=='headers-received']!=[200]*4:
            row['evidenceIssue']='matching-complete-source-receipt-required'
    except Exception:row['evidenceIssue']='source-receipt-or-counts-unavailable'
    if entered:
        opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
        if opened.returncode not in [0,1] or opened.stdout.strip():raise RuntimeError('owned-scratch-open-file-absence-unproved')
        scratch.__exit__(None,None,None);entered=False
    if reserved:host.release(scratch.token);reserved=False
    row['cleanup']={'scratchRoot':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':groups,'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedAllocationBytes':scratch.record['peak'],'manifest':str(scratch.manifest),'compatibilityException':None}
    row['writerMetadata']=[p.name for pattern in ['collector-checkpoint.json.writer-*.json','collector-checkpoint.json.writing-*'] for p in directory.glob(pattern)]
    active=None
def finalize():
    global finished
    if finished:return
    cleanup_chunk()
    series.update(elapsedSeconds=round(time.monotonic()-started,3),codeIdentityUnchanged=hashes()==allocation['codePins'],runtimeIdentityUnchanged=runtimes()==allocation['runtimePins'],
      publicGetAttempts=sum(max((r.get('retainedReceipt') or {}).get('actualAttempts',0),r.get('checkpointCounts',{}).get('httpAttempts',0),r.get('sourceEventsStarted',0)) for r in series['contexts']),
      decodedBytes=sum(r.get('checkpointCounts',{}).get('decodedBytes',0) for r in series['contexts']))
    R.atomic_json(OUT/'series-receipt.json',series);finished=True
atexit.register(finalize)
with R.handled_termination():
  try:
    for context in allocation['contextIds']:
      if 2400-(time.monotonic()-started)<105:series['stop']='series-deadline-before-next-session';break
      assert hashes()==allocation['codePins'] and runtimes()==allocation['runtimePins'],'source-code-or-runtime-pin-mismatch'
      directory=BASE/context;scratch=R.Scratch(OUT/context,ROOT,policy,expected=8*R.MIB,checkpoint=directory/'collector-checkpoint.json')
      row={'id':context,'scope':'exact registered model/line typed options only; zero admission/capacity'};series['contexts'].append(row);active=(scratch,directory,row)
      R.atomic_json(OUT/context/'selected-checks.json',{'identity':allocation['codePins'],'planDigest':allocation['contextPlanDigests'][context],'selected':'four exact registered page/settings/tree/options GETs','excluded':'solver/images/browser/admissions/production repair/publication','limits':allocation['resources']})
      limits=host.acquire(scratch.token,64*R.MIB,512*R.MIB,'/private/tmp',root=scratch.root,minimum_disk=8*R.MIB,minimum_ram=128*R.MIB);reserved=True;scratch.__enter__();entered=True
      if not (BASE/'execution-once.json').exists():
        with (BASE/'execution-once.json').open('x') as marker:os.fchmod(marker.fileno(),0o600);json.dump({'allocationId':ID,'planDigest':allocation['planDigest'],'state':'reserved-and-consumed'},marker);marker.flush();os.fsync(marker.fileno())
        parent=os.open(BASE,os.O_RDONLY)
        try:os.fsync(parent)
        finally:os.close(parent)
      env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','TZ':'UTC','NODE_OPTIONS':'--max-old-space-size=320','BMW_BREADTH_REMAINING24_OPTIONS_ROOT_SOURCE_GRANT':ID}
      row['reservedLimits']=limits
      row['result']=R.run_process(['/opt/homebrew/bin/node',str(BASE/'run-live.mjs'),context],ROOT,env,OUT/context/'child.log',scratch,policy,min(64*R.MIB,limits['disk']),min(448*R.MIB,limits['ram']) if limits['ram'] is not None else 448*R.MIB,105,host)
      cleanup_chunk();R.atomic_json(OUT/'series-progress.json',series)
      if row['result']['rc'] or row['result']['issue'] or row.get('exportIssue') or row.get('evidenceIssue') or row['writerMetadata']:series['stop']='context-failed-or-incomplete';break
      (OUT/context/'child.log').unlink()
    else:series['stop']='all-24-model-options-contexts-observed'
  finally:finalize()
print(json.dumps(series,sort_keys=True))
sys.exit(0 if series.get('stop')=='all-24-model-options-contexts-observed' and series['codeIdentityUnchanged'] and series['runtimeIdentityUnchanged'] and series['publicGetAttempts']<=96 and series['decodedBytes']<=100663296 else 1)
