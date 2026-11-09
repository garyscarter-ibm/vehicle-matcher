"""Owned exact8 pilot stages. Only --source accepts the separately reviewed source grant."""
import sys
sys.dont_write_bytecode = True
import atexit, hashlib, importlib.util, json, os, pathlib, re, shutil, subprocess, time
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
assert len(sys.argv) == 2 and sys.argv[1] in ['--check','--source','--retained'], 'exact-stage-required'
mode = sys.argv[1][2:]
read = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
digest = lambda v: hashlib.sha256(json.dumps(v, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
a = read(BASE / 'execution-plan.json')
assert digest(a) == read(BASE / 'execution-reservation.json')['executionPlanSha256']
identity = {p: sha(ROOT / p) for p in a['codePins']}; assert identity == a['codePins']
assert all(sha(pathlib.Path(p)) == h for p,h in a['inputPins'].items())
DIRECTORY = pathlib.Path(a['artifactDestination']); OUTPUT_ROOT = pathlib.Path(a['outputRoot'])
PRIMARY = DIRECTORY / a['checkpointFile']
cloud = pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve(strict=True)
assert cloud in OUTPUT_ROOT.resolve().parents and OUTPUT_ROOT in DIRECTORY.parents
if mode in ['check','source']: assert not os.path.lexists(OUTPUT_ROOT), 'spent or pre-existing output root preserved'
if mode == 'source': assert os.environ.get('F70_TRIM_PACKAGE8_SOURCE_GRANT') == a['id'], 'separate-parent-source-release-required'
if mode == 'retained':
    assert PRIMARY.is_file() and read(DIRECTORY / 'receipt.json')['reason'] == 'queue-exhausted'
    assert not (DIRECTORY / 'live-validation.json').exists(), 'existing proof preserved'
    source_cleanup = read(DIRECTORY / 'source-cleanup.json')
    assert all(source_cleanup[k] for k in ['groups_absent','scratch_absent','dependency_link_absent','reservation_absent','code_identity_unchanged'])
    assert source_cleanup['checkpointExport'] and not source_cleanup['retainedWriterMetadata']
spec = importlib.util.spec_from_file_location('resources', ROOT / '_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
spec = importlib.util.spec_from_file_location('source_exporter', ROOT / 'docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py')
E = importlib.util.module_from_spec(spec); spec.loader.exec_module(E)
policy = R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1})
# OUT is a small retained summary, never a primary or disposable source-output root.
OUT = ROOT / '.claude/test-runs/f70-trim-package8-pilot-20261107' / (mode + '-' + str(time.time_ns()))
scratch = R.Scratch(OUT, ROOT, policy, expected=64*R.MIB, checkpoint=PRIMARY if mode != 'check' else None)
host = R.HostBudget(policy); host._dead_owners = lambda: {}
normal_update = host.update
def bounded_update(token, used, rss):
    durable = R.allocated_bytes(OUTPUT_ROOT) if mode == 'source' and OUTPUT_ROOT.exists() else 0
    if durable > a['resources']['retainedShardBytes']: raise R.ResourceError('durable pilot shard exceeded32MiB; preserve checkpoint and stop')
    return normal_update(token, used + durable, rss)
host.update = bounded_update
link = ROOT / 'server/node_modules'
vendor = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules')
entered = reserved = finished = False; link_identity = None; results = []; cleanup = {}; export_status = None
output_manifest = OUT / 'ownership/durable-output.json'
def finalize():
    global entered, reserved, finished, link_identity, cleanup, export_status
    if finished: return
    groups_absent = all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
    if not groups_absent: raise RuntimeError('owned process group absence not proved')
    if entered:
        opened = subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
        if opened.returncode not in [0,1] or opened.stdout.strip(): raise RuntimeError('scratch open-file absence not proved')
    if link_identity is not None:
        info = link.lstat()
        if (info.st_dev,info.st_ino) != link_identity or not link.is_symlink() or link.readlink() != vendor: raise RuntimeError('dependency link changed')
        link.unlink(); link_identity = None
    if mode == 'source' and PRIMARY.exists():
        try: export_status = E.export(DIRECTORY)
        except Exception as error: R.atomic_json(DIRECTORY/'checkpoint-export-failure.json',{'issue':'primary-export-failed','errorType':type(error).__name__,'primaryPreserved':True})
    if entered: scratch.__exit__(None,None,None); entered = False
    if reserved: host.release(scratch.token); reserved = False
    cleanup = {'scratch_absent':not os.path.lexists(scratch.root),'dependency_link_absent':not os.path.lexists(link),
      'groups_absent':groups_absent,'reservation_absent':scratch.token not in (R.read_json(host.path,{}) or {}),
      'removed_allocation_bytes':scratch.record['peak'],'code_identity_unchanged':identity == {p:sha(ROOT/p) for p in identity},
      'source_root_absent':not os.path.lexists(OUTPUT_ROOT),'clockStarted':(OUTPUT_ROOT/'execution-once.json').exists(),
      'checkpointExport':export_status,'retainedPrimary':str(PRIMARY) if mode != 'check' else None,'primaryExists':PRIMARY.exists(),
      'retainedWriterMetadata':[p.name for pattern in ['collector-checkpoint.json.writer-*.json','collector-checkpoint.json.writing-*'] for p in DIRECTORY.glob(pattern)],
      'retainedOutputAllocatedBytes':R.allocated_bytes(OUTPUT_ROOT) if OUTPUT_ROOT.exists() else 0,
      'compatibility_exception':None,'retained_summary':str(OUT/'result.json')}
    R.atomic_json(OUT/'cleanup.json',cleanup)
    if mode == 'source' and DIRECTORY.exists():
        R.atomic_json(DIRECTORY/'source-cleanup.json',cleanup)
        owned=read(output_manifest); owned.update(state='durable-retained',allocatedBytes=cleanup['retainedOutputAllocatedBytes'],primaryExists=PRIMARY.exists())
        R.atomic_json(output_manifest,owned)
    finished = True
# Finalizer exists before scratch, dependency link, output root, or source allocation is created.
atexit.register(finalize)
command = ['/opt/homebrew/bin/node',str(BASE/'run-live.mjs'),'--check' if mode == 'check' else '--source']
plan = {'scope':'scoped exact8 preparation/source/retained stages','mode':mode,'identity':identity,
 'changed_paths':[str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.is_file()],
 'regression':'exact frozen U+EV/U+EW request identity against873-source/876-canonical/1586-spent baseline',
 'callers':['common collector','legacy full F70/AG/date source context','strict source binder','canonical admission'],
 'selected':['exact runner --check'] if mode == 'check' else ['one finite12GET stage'] if mode == 'source' else ['actual cumulative reconciliation','five pure retained semantic checks'],
 'exclusions':'No synthetic full suite, source replay, continuation, publication or application acceptance',
 'limits':a['resources'],'command':command,'expectedPeakDiskBytes':67108864,'expectedPeakRamBytes':536870912,'maximumChunkSeconds':120}
R.atomic_json(OUT/'plan.json',plan)
env = {'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC'}
def run(label, cmd, seconds=120):
    result=R.run_process(cmd,ROOT,env,OUT/(label+'.log'),scratch,policy,64*R.MIB,448*R.MIB,seconds,host)
    log=(OUT/(label+'.log')).read_text(); result.update(stage=label,summary={k:int(v) for k,v in re.findall(r'^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$',log,re.M)})
    results.append(result); R.atomic_json(OUT/'result.json',{'mode':mode,'results':results,'identity':identity,'scope':'scoped','acceptance':False})
    if result['rc'] or result['issue']:
        print(log[-12000:],flush=True); raise RuntimeError(label+' incomplete')
    if label == 'check': result['check']=json.loads(log.strip().splitlines()[-1]); R.atomic_json(OUT/'check-result.json',result['check'])
    (OUT/(label+'.log')).unlink(); result['successfulLogRemoved']=True
    return result
with R.handled_termination():
    try:
        host.acquire(scratch.token,(96 if mode == 'source' else 64)*R.MIB,512*R.MIB,ROOT,root=scratch.root); reserved=True
        scratch.__enter__(); entered=True
        assert not os.path.lexists(link), 'unowned dependency path preserved'
        assert vendor.is_dir(), 'configured dependency environment required'
        link.symlink_to(vendor,target_is_directory=True); info=link.lstat(); link_identity=(info.st_dev,info.st_ino)
        R.atomic_json(OUT/'dependency-link.json',{'path':str(link),'target':str(vendor),'device':info.st_dev,'inode':info.st_ino,'owned':True})
        if mode == 'check':
            env['NODE_V8_COVERAGE']=str(scratch.root/'coverage')
            run('check',command)
        elif mode == 'source':
            # Recheck the exact reviewed command before any root, source marker or900-second clock exists.
            run('check',['/opt/homebrew/bin/node',str(BASE/'run-live.mjs'),'--check'],30)
            assert shutil.disk_usage(cloud).free > policy.reserve + 32*R.MIB
            R.atomic_json(output_manifest,{'allocationId':a['id'],'seriesId':a['seriesId'],'root':str(OUTPUT_ROOT),
                'primary':str(PRIMARY),'owner':R.owner(),'state':'planned-durable-retained','scratch':False,'retainOnInterruption':True})
            OUTPUT_ROOT.mkdir(mode=0o700); DIRECTORY.mkdir(parents=True,mode=0o700)
            info=OUTPUT_ROOT.lstat(); owned=read(output_manifest); owned.update(state='active-durable-retained',device=info.st_dev,inode=info.st_ino)
            R.atomic_json(output_manifest,owned)
            for name,source in [('collection-plan.json',BASE/'collection-plan.json'),('execution-plan.json',BASE/'execution-plan.json'),
                                ('execution-reservation.json',BASE/'execution-reservation.json'),('prior-canonical-index.json',pathlib.Path(a['indexPins']['canonical']['path'])),
                                ('spent-request-index.json',pathlib.Path(a['indexPins']['spent']['path']))]:
                with (DIRECTORY/name).open('xb') as f: f.write(source.read_bytes()); f.flush(); os.fsync(f.fileno())
            R.atomic_json(OUTPUT_ROOT/'output-ownership.json',{'allocationId':a['seriesId'],'manifest':str(output_manifest),'retainOnInterruption':True})
            with (OUTPUT_ROOT/'execution-once.json').open('x') as f:
                json.dump({'id':a['seriesId'],'state':'reserved-and-consumed','reservedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'maximumSeconds':900},f);f.write('\n');f.flush();os.fsync(f.fileno())
            fd=os.open(OUTPUT_ROOT,os.O_RDONLY)
            try: os.fsync(fd)
            finally: os.close(fd)
            env.update(F70_TRIM_PACKAGE8_SOURCE_GRANT=a['id'],F70_TRIM_PACKAGE8_SUPERVISOR=a['id'])
            run('source',command)
        else:
            run('reconcile',['/usr/bin/python3','-I','-B',str(BASE/'reconcile-retained.py')],30)
            env['NODE_V8_COVERAGE']=str(scratch.root/'coverage')
            result=run('retained',['/opt/homebrew/bin/node','--test','--test-reporter=tap','--test-isolation=none','--test-concurrency=1',str(BASE/'retained-check.test.mjs')],30)
            s=result['summary']; assert s.get('tests') == s.get('pass') == 5 and s.get('fail') == s.get('skipped') == s.get('cancelled') == 0
        coverage=[]
        for path in (scratch.root/'coverage').glob('*.json'):
            for script in read(path)['result']:
                if str(ROOT) in script['url'] and '/node_modules/' not in script['url']:
                    coverage.append({'url':script['url'],'functions':script['functions']})
        if coverage: R.atomic_json(OUT/'coverage.json',coverage)
    finally: finalize()
assert all(cleanup[k] for k in ['scratch_absent','dependency_link_absent','groups_absent','reservation_absent','code_identity_unchanged'])
assert not cleanup['retainedWriterMetadata']
if mode == 'check': assert cleanup['source_root_absent'] and not cleanup['clockStarted']
if mode == 'source': assert export_status and not (DIRECTORY/'checkpoint-export-failure.json').exists()
if mode == 'retained':
    canonical=read(DIRECTORY/'final-canonical-index.json'); spent=read(DIRECTORY/'final-spent-request-index.json'); receipt=read(DIRECTORY/'receipt.json')
    R.atomic_json(DIRECTORY/'live-validation.json',{'schemaVersion':'f70-trim-package8-actual-validation.v1','scope':'scoped actual source and five retained semantic checks',
      'sourceTrafficDuringValidation':0,'primarySha256':sha(PRIMARY),'receiptSha256':sha(DIRECTORY/'receipt.json'),
      'finalCanonicalIndexSha256':sha(DIRECTORY/'final-canonical-index.json'),'finalSpentRequestIndexSha256':sha(DIRECTORY/'final-spent-request-index.json'),
      'retainedChecks':results[-1],'retainedCleanup':cleanup,'cleanup':source_cleanup,'actualSource':receipt,
      'cumulativeCanonicalEntries':len(canonical['entries']),'cumulativeSpentSolverRequests':len(spent['entries']),
      'cumulativeAdmittedSourceConfigurations':sum(any(o['kind']=='admitted-source' for o in r['origins']) for r in canonical['entries']),
      'sourceCapacityCredit':receipt['newlyAccepted'],'acceptance':False})
R.atomic_json(OUT/'result.json',{'mode':mode,'results':results,'cleanup':cleanup,'identity':identity,'scope':'scoped','acceptance':False})
print(json.dumps({'mode':mode,'out':str(OUT),'results':results,'cleanup':cleanup}),flush=True)
