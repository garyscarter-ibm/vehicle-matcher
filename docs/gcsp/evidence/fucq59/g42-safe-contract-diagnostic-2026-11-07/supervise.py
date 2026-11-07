"""Bounded diagnostic validation/live supervisor; live remains separately released."""
import sys
sys.dont_write_bytecode = True
import atexit, datetime, hashlib, importlib.util, json, os, pathlib, re, subprocess
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
PHASE = sys.argv[1] if len(sys.argv) == 2 else ''
assert PHASE in ['red','validate','live'], 'explicit phase required'
ALLOCATION = 'g42-safe-contract-diagnostic-20261107-once'
if PHASE == 'live':
    assert os.environ.get('BMW_G42_DIAGNOSTIC_SOURCE_GRANT') == ALLOCATION, 'explicit-root-traffic-grant-required'
    assert not (BASE/'execution-once.json').exists() and not (BASE/'collector-checkpoint.json').exists(), 'spent-or-existing-primary-preserved'
    allocation=json.loads((BASE/'execution-plan.json').read_text())
    assert allocation['id']==ALLOCATION and allocation['qualificationDate']==datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'), 'source-plan-identity-or-date-mismatch'
    assert all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in allocation['codePins'].items()), 'source-code-pin-mismatch'
    assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h for p,h in allocation['runtimePins'].items()), 'source-runtime-pin-mismatch'
spec = importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py')
R = importlib.util.module_from_spec(spec); spec.loader.exec_module(R)
OUT = pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/g42-safe-contract-diagnostic')/PHASE
policy = R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1})
scratch = R.Scratch(OUT,ROOT,policy,expected=64*R.MIB,checkpoint=BASE/'collector-checkpoint.json')
host = R.HostBudget(policy)
paths = [p for p in BASE.iterdir() if p.is_file() and p.suffix in ['.mjs','.py','.json'] and p.name not in ['validation.json']]
paths += [ROOT/p for p in ['scripts/gcsp/collection-session.mjs','scripts/gcsp/public-bmw-source.mjs','scripts/gcsp/bmw-public-registration.mjs','scripts/gcsp/configuration-key.mjs','scripts/gcsp/bmw-source-qualification.mjs','scripts/gcsp/settings-shape-report.mjs','server/gcsp/repository/core.js','server/gcsp/repository/schema.js','server/test/gcsp-bmw-range-inventory.test.js','_tools/test_resources.py','docs/gcsp/evidence/fucq61/source-interruption-retention-2026-11-07/export_checkpoint.py']]
identity = {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
command = ['/opt/homebrew/bin/node','--test','--test-concurrency=1',str(BASE/'diagnostic.test.mjs'),str(ROOT/'server/test/gcsp-bmw-range-inventory.test.js')] if PHASE != 'live' else ['/opt/homebrew/bin/node',str(BASE/'run-live.mjs')]
R.atomic_json(OUT/'selected-checks.json',{'phase':PHASE,'identity':identity,'changed_paths':[str(BASE.relative_to(ROOT))],
 'regression':'safe exact line/variant key diagnosis, finite contract-only projection, no bootstrap retention, durable no-refetch checkpoint and no-grant refusal',
 'callers':['evidence-local diagnostic runner','existing inventory registrations and transport'],
 'command':command,'selection':'explicit focused synthetic diagnostic checks; production source is unchanged',
 'exclusions':'full suite, source requests during validation, options, solver, images, admissions, runtime UI and publication',
 'forecast':{'scratch_bytes':1048576,'ram_bytes':134217728,'seconds':10},
 'limits':{'workers':1,'scratch_bytes':64*R.MIB,'host_ram_bytes':512*R.MIB,'child_ram_bytes':448*R.MIB,'seconds':120}})
entered = reserved = finished = False
result = {}
def finalize():
    global entered,reserved,finished
    if finished: return
    groups_absent = all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
    if not groups_absent: raise RuntimeError('owned-process-group-absence-unproved')
    exported=export_issue=None
    if PHASE=='live' and (BASE/'collector-checkpoint.json').exists():
        try:
            spec=importlib.util.spec_from_file_location('diagnostic_exporter',BASE/'export-retained.py')
            E=importlib.util.module_from_spec(spec);spec.loader.exec_module(E)
            exported=E.export(BASE)
        except Exception as error:
            export_issue={'issue':'diagnostic-export-failed','errorType':type(error).__name__,'primaryPreserved':True}
    if entered:
        opened = subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
        if opened.returncode not in [0,1] or opened.stdout.strip(): raise RuntimeError('owned-scratch-open-file-absence-unproved')
        scratch.__exit__(None,None,None); entered=False
    if reserved: host.release(scratch.token); reserved=False
    R.atomic_json(OUT/'cleanup.json',{'scratch_absent':not os.path.lexists(scratch.root),'scratchRoot':str(scratch.root),
      'groups_absent':groups_absent,'reservation_absent':scratch.token not in (R.read_json(host.path,{}) or {}),
      'removed_allocation_bytes':scratch.record['peak'],'manifest':str(scratch.manifest),'compatibility_exception':None,
      'retained_summary':str(OUT/'result.json'),'retainedPrimary':str(BASE/'collector-checkpoint.json') if PHASE=='live' else None,
      'checkpointExport':exported,'exportIssue':export_issue,'leftovers':[]})
    finished=True
    if export_issue: raise RuntimeError('diagnostic-export-failed-primary-preserved')
atexit.register(finalize)
with R.handled_termination():
    try:
        host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root); reserved=True
        scratch.__enter__(); entered=True
        env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC'}
        if PHASE == 'live': env['BMW_G42_DIAGNOSTIC_SOURCE_GRANT']=ALLOCATION
        result=R.run_process(command,ROOT,env,OUT/'check.log',scratch,policy,64*R.MIB,448*R.MIB,105,host)
        content=(OUT/'check.log').read_text()
        result['testCounts']={key:int(match.group(1)) for key in ['tests','pass','fail','skipped'] if (match:=re.search(r'(?:#|ℹ) '+key+r' (\d+)',content))} if PHASE!='live' else None
        result.update(identity=identity,scope='scoped; source traffic only if exact live release')
        R.atomic_json(OUT/'result.json',result)
        if result['rc'] or result['issue']: print((OUT/'check.log').read_text()[-12000:])
        else: (OUT/'check.log').unlink()
    finally: finalize()
print(json.dumps({'result':result,'cleanup':R.read_json(OUT/'cleanup.json')}))
sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
