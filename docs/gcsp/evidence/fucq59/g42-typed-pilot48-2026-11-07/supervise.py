"""Exact serial six-model solver pilot. Separate fresh base and source release required."""
import sys
sys.dont_write_bytecode=True
import atexit,datetime,hashlib,importlib.util,json,os,pathlib,subprocess,time
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==2 and sys.argv[1]=='live','explicit-live-phase-required'
ID='g42-typed-pilot48-20261107-once'
assert os.environ.get('BMW_G42_TYPED_PILOT_SOURCE_GRANT')==ID,'explicit-root-traffic-grant-required'
read=lambda p:json.loads(p.read_text())
allocation=read(BASE/'execution-plan.json')
assert allocation['id']==ID and allocation['contextIds']==['2pma','2pmb','2ppa','2ppb','2pbc','2pmc'] and allocation['publicGetCeiling']==72,'source-allocation-mismatch'
assert not allocation['baseRefreshRequired'],'fresh-root-audited-cumulative-base-required'
assert allocation['qualificationDate']==datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'),'source-qualification-date-mismatch'
assert not (BASE/'execution-once.json').exists(),'never-replay-spent-series'
assert all(not (BASE/id/name).exists() for id in allocation['contextIds'] for name in ['execution-once.json','collector-checkpoint.json']),'existing-context-progress-preserved'
hashes=lambda:{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in allocation['codePins']}
sources=lambda:{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in allocation['sourcePins']}
indexes=lambda:all(hashlib.sha256(pathlib.Path(v['path']).read_bytes()).hexdigest()==v['sha256'] for v in allocation['indexPins'].values())
runtimes=lambda:{p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in allocation['runtimePins']}
assert hashes()==allocation['codePins'] and sources()==allocation['sourcePins'] and indexes() and runtimes()==allocation['runtimePins'],'source-code-or-runtime-pin-mismatch'
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
spec=importlib.util.spec_from_file_location('batch_exporter',ROOT/'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py');E=importlib.util.module_from_spec(spec);spec.loader.exec_module(E)
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-typed-pilot48/live')
OUT.mkdir(parents=True,exist_ok=False)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1});host=R.HostBudget(policy)
series={'allocationId':ID,'planDigest':allocation['planDigest'],'contexts':[],'newConfigurations':0,'sourceCapacityCredit':0,'acceptance':False}
active=None;entered=reserved=finished=False;owned_link=None;started=time.monotonic()
def cleanup_chunk():
    global entered,reserved,active
    if active is None:return
    scratch,directory,row=active
    groups=all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
    if not groups:raise RuntimeError('owned-source-child-absence-unproved')
    try:row['checkpointExport']=E.export(directory) if (directory/'collector-checkpoint.json').exists() else {'status':'no-primary','primaryPreserved':True}
    except Exception as error:row['exportIssue']={'errorType':type(error).__name__,'primaryPreserved':True}
    try:
        primary=directory/'collector-checkpoint.json'
        if primary.exists():row['checkpointCounts']=read(primary)['content']['counts']
        events=directory/'source-events.jsonl';rows=[json.loads(line) for line in events.read_text().splitlines()] if events.exists() else []
        row['sourceEventsStarted']=sum(r.get('phase')=='started' for r in rows)
        receipt=read(directory/'receipt.json') if (directory/'receipt.json').exists() else None;row['retainedReceipt']=receipt
        if not receipt or receipt.get('reason')!='queue-exhausted' or receipt.get('status')!='complete' or receipt.get('processedCandidates')!=8 or sum(receipt.get(k,0) for k in ['admitted','duplicates','rejected'])!=8 or receipt.get('retainedSolverCaptures')!=receipt.get('admitted',0)+receipt.get('duplicates',0) or receipt.get('allocationId')!=ID or receipt.get('planDigest')!=allocation['contextPlanDigests'][row['id']] or receipt.get('modelCode')!=row['id'].upper() or receipt.get('actualAttempts')!=12 or receipt.get('counts',{}).get('httpAttempts')!=12 or receipt.get('counts',{}).get('operations')!={'page':1,'settings':1,'discover':1,'options':1,'solve':8} or not 0<receipt.get('counts',{}).get('decodedBytes',0)<=4194304 or receipt.get('checkpointSha256')!=row.get('checkpointExport',{}).get('checkpointSha256') or row['sourceEventsStarted']!=12 or [r.get('status') for r in rows if r.get('phase')=='headers-received']!=[200]*12:
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
    global finished,owned_link
    if finished:return
    cleanup_chunk()
    if owned_link is not None:
        link=ROOT/'server/node_modules';assert link.is_symlink() and link.lstat().st_ino==owned_link,'owned-dependency-link-changed'
        link.unlink();owned_link=None;series['dependencyLinkRemoved']=not os.path.lexists(link)
    series['newConfigurations']=sum((r.get('retainedReceipt') or {}).get('admitted',0) for r in series['contexts'])
    series.update(elapsedSeconds=round(time.monotonic()-started,3),codeIdentityUnchanged=hashes()==allocation['codePins'],sourceIdentityUnchanged=sources()==allocation['sourcePins'],indexIdentityUnchanged=indexes(),runtimeIdentityUnchanged=runtimes()==allocation['runtimePins'],
      publicGetAttempts=sum(max((r.get('retainedReceipt') or {}).get('actualAttempts',0),r.get('checkpointCounts',{}).get('httpAttempts',0),r.get('sourceEventsStarted',0)) for r in series['contexts']),
      decodedBytes=sum(r.get('checkpointCounts',{}).get('decodedBytes',0) for r in series['contexts']))
    R.atomic_json(OUT/'series-receipt.json',series);finished=True
atexit.register(finalize)
with R.handled_termination():
  try:
    link=ROOT/'server/node_modules'
    if not os.path.lexists(link):
      R.atomic_json(OUT/'dependency-link.json',{'path':str(link),'state':'planned','source':allocation['dependencySource']})
      link.symlink_to(allocation['dependencySource'],target_is_directory=True);owned_link=link.lstat().st_ino
      R.atomic_json(OUT/'dependency-link.json',{'path':str(link),'inode':owned_link,'state':'active'})
    for context in allocation['contextIds']:
      if 600-(time.monotonic()-started)<105:series['stop']='series-deadline-before-next-session';break
      assert hashes()==allocation['codePins'] and sources()==allocation['sourcePins'] and indexes() and runtimes()==allocation['runtimePins'],'source-code-or-runtime-pin-mismatch'
      directory=BASE/context;scratch=R.Scratch(OUT/context,ROOT,policy,expected=8*R.MIB,checkpoint=directory/'collector-checkpoint.json')
      row={'id':context,'scope':'exact registered model/line typed eight-candidate solver pilot; no acceptance'};series['contexts'].append(row);active=(scratch,directory,row)
      R.atomic_json(OUT/context/'selected-checks.json',{'identity':allocation['codePins'],'planDigest':allocation['contextPlanDigests'][context],'selected':'twelve exact registered page/settings/tree/options/solve GETs','excluded':'images/browser/production repair/publication','limits':allocation['resources']})
      limits=host.acquire(scratch.token,64*R.MIB,512*R.MIB,'/private/tmp',root=scratch.root,minimum_disk=8*R.MIB,minimum_ram=128*R.MIB);reserved=True;scratch.__enter__();entered=True
      if not (BASE/'execution-once.json').exists():
        with (BASE/'execution-once.json').open('x') as marker:os.fchmod(marker.fileno(),0o600);json.dump({'allocationId':ID,'planDigest':allocation['planDigest'],'state':'reserved-and-consumed'},marker);marker.flush();os.fsync(marker.fileno())
        parent=os.open(BASE,os.O_RDONLY)
        try:os.fsync(parent)
        finally:os.close(parent)
      env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','TZ':'UTC','NODE_OPTIONS':'--max-old-space-size=320','BMW_G42_TYPED_PILOT_SOURCE_GRANT':ID}
      row['reservedLimits']=limits
      row['result']=R.run_process(['/opt/homebrew/bin/node',str(BASE/'run-live.mjs'),context],ROOT,env,OUT/context/'child.log',scratch,policy,min(64*R.MIB,limits['disk']),min(448*R.MIB,limits['ram']) if limits['ram'] is not None else 448*R.MIB,105,host)
      cleanup_chunk();R.atomic_json(OUT/'series-progress.json',series)
      if row['result']['rc'] or row['result']['issue'] or row.get('exportIssue') or row.get('evidenceIssue') or row['writerMetadata']:series['stop']='context-failed-or-incomplete';break
      (OUT/context/'child.log').unlink()
    else:series['stop']='all-six-model-solver-pilots-complete'
  finally:finalize()
print(json.dumps(series,sort_keys=True))
sys.exit(0 if series.get('stop')=='all-six-model-solver-pilots-complete' and series['codeIdentityUnchanged'] and series['runtimeIdentityUnchanged'] and series['sourceIdentityUnchanged'] and series['indexIdentityUnchanged'] and series['publicGetAttempts']<=72 and series['decodedBytes']<=25165824 else 1)
