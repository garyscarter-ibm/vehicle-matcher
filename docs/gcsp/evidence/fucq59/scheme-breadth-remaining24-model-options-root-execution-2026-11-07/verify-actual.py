"""Bounded retained actual evidence proof. Never invokes source traffic."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth-remaining24-model-options-root/actual-proof')
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1})
scratch=R.Scratch(OUT,ROOT,policy,expected=R.MIB);host=R.HostBudget(policy)
allocation=json.loads((BASE/'execution-plan.json').read_text())
names=[str(BASE/'execution-plan.json')]+[str(ROOT/p) for p in allocation['codePins']]
identity={str(pathlib.Path(n).relative_to(ROOT)):hashlib.sha256(pathlib.Path(n).read_bytes()).hexdigest() for n in names}
command=['/opt/homebrew/bin/node','--test','--test-concurrency=1',str(BASE/'verify-actual.test.mjs')]
R.atomic_json(OUT/'selected-checks.json',{'scope':'scoped six-context retained actual proof; zeroHTTP','identity':identity,'changed_paths':[str(BASE.relative_to(ROOT))],'input_paths':names,'regression':'actual live primary seals, production observation binding, real GETevents, safe exported artifacts, copied-primary zerofetch resume',
 'callers':['existing generic model-options qualifier/registration/executor','evidence-local runner/supervisor/exporter'],'command':command,
 'exclusions':['public source requests','preparation fixtures','full suite','solver/images/admissions/publication'],
 'forecast':{'scratch_bytes':R.MIB,'ram_bytes':128*R.MIB,'seconds':5},'limits':{'workers':1,'scratch_bytes':64*R.MIB,'host_ram_bytes':512*R.MIB,'child_ram_bytes':448*R.MIB,'seconds':120}})
entered=reserved=finished=False;result={}
def finalize():
    global entered,reserved,finished
    if finished:return
    groups=all(R.group_has_live_members(pid) is False for pid in scratch.record['groups'])
    if not groups:raise RuntimeError('owned-group-absence-unproved')
    if entered:
        opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
        if opened.returncode not in [0,1] or opened.stdout.strip():raise RuntimeError('owned-open-file-absence-unproved')
        scratch.__exit__(None,None,None);entered=False
    if reserved:host.release(scratch.token);reserved=False
    R.atomic_json(OUT/'cleanup.json',{'groups_absent':groups,'scratchRoot':str(scratch.root),'scratch_absent':not os.path.lexists(scratch.root),
      'reservation_absent':scratch.token not in (R.read_json(host.path,{}) or {}),'removed_allocation_bytes':scratch.record['peak'],'manifest':str(scratch.manifest),'compatibility_exception':None,'leftovers':[]})
    finished=True
atexit.register(finalize)
with R.handled_termination():
    try:
        host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True;scratch.__enter__();entered=True
        result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','TZ':'UTC','LANG':'en_GB.UTF-8'},OUT/'check.log',scratch,policy,64*R.MIB,448*R.MIB,105,host)
        content=(OUT/'check.log').read_text();result['testCounts']={key:int(m.group(1)) for key in ['tests','pass','fail','skipped'] if (m:=re.search(r'(?:#|ℹ) '+key+r' (\d+)',content))}
        result['nestedSupervisorProof']=[json.loads(line.removeprefix('# ')) for line in content.splitlines() if line.removeprefix('# ').startswith('{"fixtureSupervisorCleanup":')]
        result['identity']=identity;result['identityUnchanged']=all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in identity.items())
        R.atomic_json(OUT/'result.json',result)
        if result['rc'] or result['issue']:print(content[-12000:])
        else:(OUT/'check.log').unlink()
    finally:finalize()
print(json.dumps({'result':result,'cleanup':R.read_json(OUT/'cleanup.json')}))
sys.exit(0 if result.get('rc')==0 and not result.get('issue') and result.get('identityUnchanged') else 1)
