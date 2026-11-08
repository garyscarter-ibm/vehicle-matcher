"""Bounded offline preparation proof. Never invokes source traffic."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth30-phase01-960/preparation/attempt02')
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
spec = importlib.util.spec_from_file_location('group_proof', BASE / 'group-proof.py')
G = importlib.util.module_from_spec(spec); spec.loader.exec_module(G)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1})
scratch=R.Scratch(OUT,ROOT,policy,expected=R.MIB);host=R.HostBudget(policy)
allocation=json.loads((BASE/'series-plan.json').read_text())
names=[str(BASE/'series-plan.json')]+[str(ROOT/p) for p in {**allocation['codePins'],**allocation['sourcePins']}]+[v['path'] for v in allocation['indexPins'].values()]
identity={str(pathlib.Path(n).relative_to(ROOT)) if ROOT in pathlib.Path(n).parents else str(pathlib.Path(n)):hashlib.sha256(pathlib.Path(n).read_bytes()).hexdigest() for n in names}
command=['/opt/homebrew/bin/node','--test','--test-concurrency=1',str(BASE/'prepared-check.test.mjs')]
R.atomic_json(OUT/'selected-checks.json',{'scope':'scoped exactphase01 960solver protocol preparation','identity':identity,'changed_paths':[str(BASE.relative_to(ROOT))],'input_paths':names,'regression':'120exactplans/960unspentpool, all pins, no-grant refusal, first-session freeze, copied actual breadthpilot event/reconcile/strict5protocol',
 'callers':['existing generic model-batch strict binder/registration/executor','evidence-local runner/supervisor/exporter'],'command':command,
 'exclusions':['public source requests','production inventory repair','full suite','public solver/images/admissions/publication'],
 'forecast':{'scratch_bytes':R.MIB,'ram_bytes':384*R.MIB,'seconds':8},'limits':{'workers':1,'scratch_bytes':64*R.MIB,'host_ram_bytes':512*R.MIB,'child_ram_bytes':448*R.MIB,'seconds':120}})
entered=reserved=finished=False;owned_link=None;result={}
def finalize():
    global entered,reserved,finished,owned_link
    if finished:return
    groups=G.prove_groups_absent(R,scratch.record['groups'],OUT/'group-queries.json')
    if not groups:raise RuntimeError('owned-group-absence-unproved')
    if owned_link is not None:
        link=ROOT/'server/node_modules';assert link.is_symlink() and link.lstat().st_ino==owned_link,'owned-dependency-link-changed'
        link.unlink();owned_link=None
    if entered:
        opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
        if opened.returncode not in [0,1] or opened.stdout.strip():raise RuntimeError('owned-open-file-absence-unproved')
        scratch.__exit__(None,None,None);entered=False
    if reserved:host.release(scratch.token);reserved=False
    R.atomic_json(OUT/'cleanup.json',{'groups_absent':groups,'scratchRoot':str(scratch.root),'scratch_absent':not os.path.lexists(scratch.root),
      'reservation_absent':scratch.token not in (R.read_json(host.path,{}) or {}),'removed_allocation_bytes':scratch.record['peak'],'manifest':str(scratch.manifest),'compatibility_exception':None,'dependencyLinkAbsent':not os.path.lexists(ROOT/'server/node_modules'),'leftovers':[]})
    finished=True
atexit.register(finalize)
with R.handled_termination():
    try:
        host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True;scratch.__enter__();entered=True
        link=ROOT/'server/node_modules'
        if not os.path.lexists(link):
            R.atomic_json(OUT/'dependency-link.json',{'path':str(link),'source':'/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules','state':'planned'})
            link.symlink_to('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules',target_is_directory=True);owned_link=link.lstat().st_ino
            R.atomic_json(OUT/'dependency-link.json',{'path':str(link),'inode':owned_link,'state':'active'})
        result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','TZ':'UTC','LANG':'en_GB.UTF-8','NODE_V8_COVERAGE':str(scratch.root/'coverage')},OUT/'check.log',scratch,policy,64*R.MIB,448*R.MIB,105,host)
        content=(OUT/'check.log').read_text();result['testCounts']={key:int(m.group(1)) for key in ['tests','pass','fail','skipped'] if (m:=re.search(r'(?:#|ℹ) '+key+r' (\d+)',content))}
        result['nestedSupervisorProof']=[json.loads(line.removeprefix('# ')) for line in content.splitlines() if line.removeprefix('# ').startswith('{"fixtureSupervisorCleanup":')]
        observed=[]
        for coverage in(scratch.root/'coverage').glob('*.json'):
            for script in R.read_json(coverage,{}).get('result',[]):
                if any(script.get('url','').endswith('/'+name)for name in ['scripts/gcsp/bmw-public-registration.mjs','scripts/gcsp/bmw-selection-binding.mjs']):
                    observed.append({'script':script['url'],'functions':[{'name':f['functionName'],'calls':f['ranges'][0]['count']}for f in script['functions']if f['functionName']and f['ranges']and f['ranges'][0]['count']>0]})
        result['observedCoverage']=observed;result['coverageBoundary']='measured one-worker offline chunk and copied actual strict child; no per-test context support in Node V8 output'
        result['identity']=identity;result['identityUnchanged']=all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in identity.items())
        R.atomic_json(OUT/'result.json',result)
        if result['rc'] or result['issue']:print(content[-12000:])
        else:(OUT/'check.log').unlink()
    finally:finalize()
print(json.dumps({'result':{k:v for k,v in result.items()if k not in ['identity','observedCoverage']},'cleanup':R.read_json(OUT/'cleanup.json')}))
sys.exit(0 if result.get('rc')==0 and not result.get('issue') and result.get('identityUnchanged') else 1)
