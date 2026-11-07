"""Owned bounded offline historical packet proof; no source grant or HTTP."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,re,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
name=sys.argv[1] if len(sys.argv)==2 else 'green'
assert name in ['red','green','driver-red','final']
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/historical-g26e-3get')/name
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
policy=R.Policy({'chunk_scratch_mib':32,'chunk_ram_mib':256,'chunk_seconds':60,'log_mib':1});scratch=R.Scratch(OUT,ROOT,policy,expected=R.MIB);host=R.HostBudget(policy)
command=['/opt/homebrew/bin/node','--test','--test-concurrency=1']
if name=='red':command+=['--test-name-pattern','historical G26E|direct derivative|current M60|unsafe derivative|memory-only public']
command+=[str(BASE/'driver.test.mjs')]if name=='driver-red'else[str(BASE/'catalogue.test.mjs')]+([str(BASE/'driver.test.mjs')]if name=='final'else[])
identity={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest()for p in BASE.iterdir()if p.suffix in ['.py','.mjs','.json']}
R.atomic_json(OUT/'selected-checks.json',{'scope':'scoped evidence-only historical G26E finite client preparation','changedPaths':[str(BASE.relative_to(ROOT))],'regression':'exact one-range/no-fallback historical request, direct safe derivative and no successor substitution','callers':['evidence-local historical source client only'],'command':command,'exclusions':['actual source traffic','public production adapters','options/solver','full suite','UI/database/profile/F61acceptance'],'forecast':{'scratchBytes':R.MIB,'ramBytes':128*R.MIB,'seconds':12},'limits':{'workers':1,'scratchBytes':32*R.MIB,'ramBytes':256*R.MIB,'seconds':60},'identity':identity})
entered=reserved=finished=False;result={}
def finalize():
 global entered,reserved,finished
 if finished:return
 groups=scratch.record['groups'];probe=subprocess.run(['/bin/ps','-axo','pgid='],capture_output=True,text=True,timeout=10);assert probe.returncode==0
 absent=not set(groups)&{int(x)for x in probe.stdout.split()};assert absent,'owned groups still live or query unknown'
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1]and not opened.stdout.strip()
  scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 R.atomic_json(OUT/'cleanup.json',{'scratchRoot':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groups':groups,'groupsAbsent':absent,'token':scratch.token,'reservationAbsent':scratch.token not in(R.read_json(host.path,{})or{}),'removedAllocationBytes':scratch.record['peak'],'dependencyPathTouched':False,'compatibilityException':None,'leftovers':[]})
 finished=True
atexit.register(finalize)
with R.handled_termination():
 try:
  host.acquire(scratch.token,32*R.MIB,256*R.MIB,ROOT,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','TZ':'UTC','LANG':'en_GB.UTF-8','NODE_V8_COVERAGE':str(scratch.root/'coverage')},OUT/'check.log',scratch,policy,32*R.MIB,256*R.MIB,55,host)
  content=(OUT/'check.log').read_text();result['testCounts']={k:int(m.group(1))for k in ['tests','pass','fail','skipped']if(m:=re.search(r'(?:#|ℹ) '+k+r' (\d+)',content))}
  result['observedCoverage']=[]
  for c in(scratch.root/'coverage').glob('*.json'):
   for s in R.read_json(c,{}).get('result',[]):
    if s.get('url','').endswith('/catalogue.mjs'):result['observedCoverage'].append({'script':s['url'],'functions':[{'name':f['functionName'],'calls':f['ranges'][0]['count']}for f in s['functions']if f['functionName']and f['ranges']and f['ranges'][0]['count']>0]})
  result['identity']=identity;result['identityUnchanged']=all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in identity.items());result['sourceTraffic']=0
  R.atomic_json(OUT/'result.json',result)
  if result['rc']or result['issue']:print(content[-10000:])
  else:(OUT/'check.log').unlink()
 finally:finalize()
print(json.dumps({'result':{k:v for k,v in result.items()if k not in ['identity','observedCoverage']},'cleanup':R.read_json(OUT/'cleanup.json')}))
sys.exit(0 if name in['red','driver-red']and result.get('testCounts',{}).get('fail',0)>0 and not result.get('issue') else 0 if result.get('rc')==0 and not result.get('issue')and result.get('identityUnchanged')else 1)
