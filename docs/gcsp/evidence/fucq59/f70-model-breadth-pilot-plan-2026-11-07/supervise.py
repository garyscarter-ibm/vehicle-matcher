"""Pinned serial 20-GET ceiling. Root must separately release the exact allocation."""
import sys
sys.dont_write_bytecode = True
import atexit, hashlib, importlib.util, json, os, pathlib, time
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
assert len(sys.argv) == 2 and sys.argv[1] == 'live', 'explicit-live-phase-required'
read = lambda path: json.loads(path.read_text())
allocation = read(BASE/'execution-plan.json')
assert os.environ.get('F70_MODEL_BREADTH_SOURCE_GRANT') == allocation['id'], 'explicit-root-traffic-grant-required'
assert not (BASE/'execution-once.json').exists(), 'never-replay-series-allocation'
assert all(not (BASE/id/'execution-once.json').exists() and not (BASE/id/'collector-checkpoint.json').exists() for id in allocation['contextIds']), 'existing-context-progress-preserved'
assert allocation['publicGetCeiling'] == 20 and allocation['contextIds'] == ['1f7a','1f7c','1f7d','1f7f']
hashes = lambda: {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in allocation['codePins']}
assert hashes() == allocation['codePins'], 'source-code-pin-mismatch'
spec = importlib.util.spec_from_file_location('resources', ROOT/'_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
spec = importlib.util.spec_from_file_location('safe_exporter', ROOT/'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py')
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
OUT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-model-breadth/live')
OUT.mkdir(parents=True, exist_ok=False)
resources=allocation['resources']
assert 0 < resources['childRamMiB'] < resources['hostRamMiB'] <= 512 and 0 < resources['scratchMiB'] <= 64 and 0 < resources['chunkSeconds'] <= 120 and 0 < resources['seriesSeconds'] <= 300
policy = R.Policy({'chunk_scratch_mib':resources['scratchMiB'],'chunk_ram_mib':resources['hostRamMiB'],'chunk_seconds':resources['chunkSeconds'],'log_mib':1})
host = R.HostBudget(policy)
series = {'allocationId':allocation['id'],'planDigest':allocation['planDigest'],'contexts':[],'newConfigurations':0,'acceptance':False}
active = None; entered = reserved = finished = False
owned_link = None
started = time.monotonic()
def export_primary(directory):
    primary=directory/'collector-checkpoint.json'
    if not primary.exists(): return {'status':'no-primary','primaryPreserved':True}
    return E.export(directory)

def cleanup_chunk():
    global entered,reserved,active
    if active is None: return
    scratch,directory,row=active
    groups_absent=all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
    if not groups_absent: raise RuntimeError('owned-source-child-still-live')
    try: row['checkpointExport']=export_primary(directory)
    except Exception as error: row['exportIssue']={'errorType':type(error).__name__,'primaryPreserved':True}
    try:
        primary=directory/'collector-checkpoint.json'
        if primary.exists(): row['checkpointCounts']=read(primary)['content']['counts']
        events=directory/'source-events.jsonl'
        row['sourceEventsStarted']=sum(json.loads(line).get('phase')=='started' for line in events.read_text().splitlines()) if events.exists() else 0
        receipt=read(directory/'receipt.json') if (directory/'receipt.json').exists() else None
        row['retainedReceipt']=receipt
        if not receipt or receipt.get('reason')!='queue-exhausted' or receipt.get('status')!='complete' or receipt.get('admitted')!=1 or receipt.get('records')!=1 or receipt.get('retainedSolverCaptures')!=1 or receipt.get('duplicates')!=0 or receipt.get('rejected')!=0 or receipt.get('allocationId')!=allocation['id'] or receipt.get('planDigest')!=allocation['contextPlanDigests'][row['id']] or receipt.get('modelCode')!=row['id'].upper() or receipt.get('actualAttempts')!=5 or (receipt.get('counts') or {}).get('httpAttempts')!=5 or (receipt.get('counts') or {}).get('operations')!={'page':1,'settings':1,'discover':1,'options':1,'solve':1} or not row.get('checkpointExport',{}).get('checkpointSha256') or receipt.get('checkpointSha256')!=row['checkpointExport']['checkpointSha256']:
            row['evidenceIssue']='matching-complete-source-receipt-required'
    except Exception as error: row['evidenceIssue']='source-receipt-or-counts-unavailable'
    if entered: scratch.__exit__(None,None,None); entered=False
    if reserved: host.release(scratch.token); reserved=False
    live=R.read_json(host.path,{}) or {}
    row['cleanup']={'scratchRoot':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':groups_absent,
      'reservationAbsent':scratch.token not in live,'removedAllocationBytes':scratch.record['peak'],'manifest':str(scratch.manifest),'compatibilityException':None}
    row['writerMetadata']=[p.name for pattern in ['collector-checkpoint.json.writer-*.json','collector-checkpoint.json.writing-*'] for p in directory.glob(pattern)]
    active=None

def finalize():
    global finished, owned_link
    if finished:return
    cleanup_chunk()
    if owned_link is not None:
        link=ROOT/'server/node_modules'
        assert link.is_symlink() and link.lstat().st_ino==owned_link, 'owned-dependency-link-changed'
        link.unlink(); owned_link=None
        series['dependencyLinkRemoved']=not os.path.lexists(link)
    series['newConfigurations']=sum((row.get('retainedReceipt') or {}).get('admitted',0) for row in series['contexts'])
    series.update(elapsedSeconds=round(time.monotonic()-started,3),codeIdentityUnchanged=hashes()==allocation['codePins'],
      publicGetAttempts=sum(max((row.get('retainedReceipt') or {}).get('actualAttempts',0),row.get('checkpointCounts',{}).get('httpAttempts',0),row.get('sourceEventsStarted',0)) for row in series['contexts']))
    R.atomic_json(OUT/'series-receipt.json',series); finished=True
atexit.register(finalize)
with R.handled_termination():
  try:
    link=ROOT/'server/node_modules'
    if not os.path.lexists(link):
      R.atomic_json(OUT/'dependency-link.json',{'path':str(link),'state':'planned','source':'/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules'})
      link.symlink_to('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules',target_is_directory=True); owned_link=link.lstat().st_ino
      R.atomic_json(OUT/'dependency-link.json',{'path':str(link),'inode':owned_link,'state':'active'})
    for id in allocation['contextIds']:
      assert time.monotonic()-started < resources['seriesSeconds'], 'series-source-deadline'
      assert hashes()==allocation['codePins'], 'source-code-pin-mismatch'
      directory=BASE/id; scratch=R.Scratch(OUT/id,ROOT,policy,expected=min(8,resources['scratchMiB'])*R.MIB,checkpoint=directory/'collector-checkpoint.json')
      row={'id':id,'scope':'one exact fresh full model/line/options context and one solver candidate; acceptance remains open'}
      series['contexts'].append(row); active=(scratch,directory,row)
      host.acquire(scratch.token,resources['scratchMiB']*R.MIB,resources['hostRamMiB']*R.MIB,'/private/tmp',root=scratch.root); reserved=True
      scratch.__enter__(); entered=True
      if not (BASE/'execution-once.json').exists():
        with (BASE/'execution-once.json').open('x') as marker:
          os.fchmod(marker.fileno(),0o600); json.dump({'allocationId':allocation['id'],'planDigest':allocation['planDigest'],'state':'reserved-and-consumed'},marker); marker.flush(); os.fsync(marker.fileno())
        parent=os.open(BASE,os.O_RDONLY)
        try: os.fsync(parent)
        finally: os.close(parent)
      env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','TZ':'UTC','NODE_OPTIONS':'--max-old-space-size=320','F70_MODEL_BREADTH_SOURCE_GRANT':allocation['id']}
      remaining_seconds=resources['seriesSeconds']-(time.monotonic()-started)
      assert remaining_seconds > 0, 'series-source-deadline'
      child_seconds=min(90,resources['chunkSeconds'],remaining_seconds)
      row['allocatedChildSeconds']=child_seconds
      row['result']=R.run_process(['/opt/homebrew/bin/node',str(BASE/'run-live.mjs'),id],ROOT,env,OUT/id/'child.log',scratch,policy,resources['scratchMiB']*R.MIB,resources['childRamMiB']*R.MIB,child_seconds,host=host)
      if (directory/'collector-checkpoint.json').exists(): row['checkpointCounts']=read(directory/'collector-checkpoint.json')['content']['counts']
      cleanup_chunk()
      R.atomic_json(OUT/'series-progress.json',series)
      if row['result']['rc'] or row['result']['issue'] or row.get('exportIssue') or row.get('evidenceIssue') or row['writerMetadata']:
        series['stop']='context-failed-or-incomplete';break
      (OUT/id/'child.log').unlink()
    else:series['stop']='all-four-model-solver-contexts-observed'
  finally:finalize()
print(json.dumps(series,sort_keys=True))
sys.exit(0 if series.get('stop')=='all-four-model-solver-contexts-observed' and series['codeIdentityUnchanged'] and series['publicGetAttempts']<=20 else 1)
