"""Pinned serial 16-GET ceiling. Root must separately release the exact allocation."""
import sys
sys.dont_write_bytecode = True
import atexit, hashlib, importlib.util, json, os, pathlib, time
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
assert len(sys.argv) == 2 and sys.argv[1] == 'live', 'explicit-live-phase-required'
read = lambda path: json.loads(path.read_text())
allocation = read(BASE/'execution-plan.json')
assert os.environ.get('F70_REMAINING_OPTIONS_SOURCE_GRANT') == allocation['id'], 'explicit-root-traffic-grant-required'
assert not (BASE/'execution-once.json').exists(), 'never-replay-series-allocation'
assert all(not (BASE/id/'execution-once.json').exists() and not (BASE/id/'collector-checkpoint.json').exists() for id in allocation['contextIds']), 'existing-context-progress-preserved'
assert allocation['publicGetCeiling'] == 16 and allocation['contextIds'] == ['1f7a','1f7c','1f7d','1f7f']
hashes = lambda: {name: hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in allocation['codePins']}
assert hashes() == allocation['codePins'], 'source-code-pin-mismatch'
spec = importlib.util.spec_from_file_location('resources', ROOT/'_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
spec = importlib.util.spec_from_file_location('safe_exporter', ROOT/'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py')
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
OUT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/f70-remaining-options/live')
OUT.mkdir(parents=True, exist_ok=False)
policy = R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':60,'log_mib':1})
host = R.HostBudget(policy)
series = {'allocationId':allocation['id'],'planDigest':allocation['planDigest'],'contexts':[],'sourceCapacityCredit':0,'newConfigurations':0,'acceptance':False}
active = None; entered = reserved = finished = False
started = time.monotonic()
def export_primary(directory):
    primary=directory/'collector-checkpoint.json'
    if not primary.exists(): return {'status':'no-primary','primaryPreserved':True}
    exported=E.export(directory); state=read(primary)['content']
    for field,name in [('contextObservation','tree.json'),('optionsObservation','options.json'),('trimRelationships','line-relationships.json')]:
        value=state.get(field)
        if value is None: continue
        data=E.encoded(value['document'] if field!='trimRelationships' else value)
        if field!='trimRelationships' and (hashlib.sha256(data).hexdigest()!=value['sha256'] or len(data)!=value['bytes']): raise ValueError('safe-artifact-integrity')
        target=directory/name
        if target.exists():
            if target.is_symlink() or target.read_bytes()!=data: raise ValueError('safe-export-conflict')
        else:
            with target.open('xb') as stream: os.fchmod(stream.fileno(),0o600); stream.write(data); stream.flush(); os.fsync(stream.fileno())
    return exported

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
        if not receipt or receipt.get('reason')!='source-options-qualified' or receipt.get('allocationId')!=allocation['id'] or receipt.get('planDigest')!=allocation['contextPlanDigests'][row['id']] or receipt.get('modelCode')!=row['id'].upper() or receipt.get('actualAttempts')!=4 or receipt.get('counts',{}).get('httpAttempts')!=4 or receipt.get('counts',{}).get('operations')!={'page':1,'settings':1,'discover':1,'options':1} or not row.get('checkpointExport',{}).get('checkpointSha256') or receipt.get('checkpointSha256')!=row['checkpointExport']['checkpointSha256']:
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
    global finished
    if finished:return
    cleanup_chunk()
    series.update(elapsedSeconds=round(time.monotonic()-started,3),codeIdentityUnchanged=hashes()==allocation['codePins'],
      publicGetAttempts=sum(max((row.get('retainedReceipt') or {}).get('actualAttempts',0),row.get('checkpointCounts',{}).get('httpAttempts',0),row.get('sourceEventsStarted',0)) for row in series['contexts']))
    R.atomic_json(OUT/'series-receipt.json',series); finished=True
atexit.register(finalize)
with R.handled_termination():
  try:
    for id in allocation['contextIds']:
      assert time.monotonic()-started < 135, 'series-source-deadline'
      assert hashes()==allocation['codePins'], 'source-code-pin-mismatch'
      directory=BASE/id; scratch=R.Scratch(OUT/id,ROOT,policy,expected=8*R.MIB,checkpoint=directory/'collector-checkpoint.json')
      row={'id':id,'scope':'one exact fresh model/options context; zero configuration capacity'}
      series['contexts'].append(row); active=(scratch,directory,row)
      host.acquire(scratch.token,64*R.MIB,512*R.MIB,'/private/tmp',root=scratch.root); reserved=True
      scratch.__enter__(); entered=True
      if not (BASE/'execution-once.json').exists():
        with (BASE/'execution-once.json').open('x') as marker:
          os.fchmod(marker.fileno(),0o600); json.dump({'allocationId':allocation['id'],'planDigest':allocation['planDigest'],'state':'reserved-and-consumed'},marker); marker.flush(); os.fsync(marker.fileno())
        parent=os.open(BASE,os.O_RDONLY)
        try: os.fsync(parent)
        finally: os.close(parent)
      env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','TZ':'UTC','NODE_OPTIONS':'--max-old-space-size=320','F70_REMAINING_OPTIONS_SOURCE_GRANT':allocation['id']}
      row['result']=R.run_process(['/opt/homebrew/bin/node',str(BASE/'run-live.mjs'),id],ROOT,env,OUT/id/'child.log',scratch,policy,64*R.MIB,448*R.MIB,45,host=host)
      if (directory/'collector-checkpoint.json').exists(): row['checkpointCounts']=read(directory/'collector-checkpoint.json')['content']['counts']
      cleanup_chunk()
      R.atomic_json(OUT/'series-progress.json',series)
      if row['result']['rc'] or row['result']['issue'] or row.get('exportIssue') or row.get('evidenceIssue') or row['writerMetadata']:
        series['stop']='context-failed-or-incomplete';break
      (OUT/id/'child.log').unlink()
    else:series['stop']='all-four-model-options-contexts-observed'
  finally:finalize()
print(json.dumps(series,sort_keys=True))
sys.exit(0 if series.get('stop')=='all-four-model-options-contexts-observed' and series['codeIdentityUnchanged'] and series['publicGetAttempts']<=16 else 1)
