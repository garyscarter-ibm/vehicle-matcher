"""One bounded offline F54 packaging chunk with owned teardown and receipts."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
plan=read(BASE/'plan.json');output=pathlib.Path(plan['outputRoot'])
assert not output.exists(),'fresh offline candidate root only; preserve any existing result'
metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f62/fleet-dot6-offline')
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
code_paths=[BASE/'freeze-inputs.py',BASE/'prepare-candidate.mjs',BASE/'supervise.py',BASE/'plan.json',ROOT/'scripts/gcsp/fleet-offline-guard.mjs',ROOT/'server/gcsp/vehicle-evidence/registered-catalogue-sources.js']
for directory in ['server/gcsp/vehicle-evidence','server/gcsp/policy','server/gcsp/repository','server/vehicle-evidence']:
 code_paths.extend((ROOT/directory).glob('*.js'));code_paths.extend((ROOT/directory).glob('*.json'))
identity={str(p):sha(p) for p in sorted(set(code_paths))}
command=['/opt/homebrew/bin/node','--max-old-space-size=256','--expose-gc',str(BASE/'prepare-candidate.mjs')]
selected={'scope':'scoped offline candidate preparation; no HTTP','changedPaths':['server/gcsp/vehicle-evidence/registered-catalogue-sources.js',plan['registeredSource']['path'],str(BASE)],
 'regression':'exact new admission anchor and F54 additive candidate over immutable .5','affectedCallers':['registeredCatalogueSources','writeCorpusCandidate','validateCorpusDirectory'],
 'integrationBoundaries':['strict source envelopes reused from32 actual proofs','F54 corpus validation','immutable .5 files/history/image/VIN'],
 'selectedCommand':command,'exclusions':plan['excluded'],'resources':plan['resources'],'identity':identity,'inputs':plan['baseline']['files'],'sourceInputs':plan['sourceInputs']}
R.atomic_json(metadata/'selection.json',selected)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':120,'log_mib':1})
scratch=R.Scratch(metadata,ROOT,policy,expected=64*R.MIB,checkpoint=output/'candidate-receipt.json')
host=R.HostBudget(policy);host._dead_owners=lambda:{}
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules')
assert vendor.is_dir() and not os.path.lexists(link)
reserved=entered=finished=False;link_identity=None;result={}
R.atomic_json(metadata/'retained-output-ownership.json',{'owner':R.owner(),'outputRoot':str(output),'disposable':False,'expectedRetainedMiB':20,'retainOnInterruption':True,'state':'planned'})
def finalize():
 global entered,reserved,finished,link_identity
 if finished:return
 assert all(R.group_has_live_members(g) is False for g in scratch.record['groups']),'owned group absence required'
 if link_identity is not None:
  info=link.lstat();assert (info.st_dev,info.st_ino)==link_identity and link.is_symlink() and link.readlink()==vendor
  link.unlink();link_identity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10)
  assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in identity.items())
 cleanup={'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'dependencyLinkAbsent':not os.path.lexists(link),
  'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],
  'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),'compatibilityException':None,'leftovers':[],'codeIdentityUnchanged':True}
 R.atomic_json(metadata/'cleanup.json',cleanup);finished=True
 assert all(cleanup[k] for k in ['scratchAbsent','groupsAbsent','dependencyLinkAbsent','reservationAbsent'])
atexit.register(finalize)
with R.handled_termination():
 try:
  host.acquire(scratch.token,96*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True
  scratch.__enter__();entered=True;output.mkdir()
  link.symlink_to(vendor,target_is_directory=True);info=link.lstat();link_identity=(info.st_dev,info.st_ino)
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC'},metadata/'command.log',scratch,policy,64*R.MIB,448*R.MIB,120,host)
  result.update(scope='scoped offline F54 candidate',identity=identity);R.atomic_json(metadata/'result.json',result)
 finally:finalize()
if result.get('rc')==0 and not result.get('issue'):
 (metadata/'command.log').unlink()
 receipt=read(output/'candidate-receipt.json')
 compact={'result':{k:v for k,v in result.items() if k!='identity'},'cleanup':read(metadata/'cleanup.json'),'candidateReceipt':receipt,
  'candidateReceiptSha256':sha(output/'candidate-receipt.json'),'descriptorInputsSha256':sha(output/'descriptor-inputs.json'),'planSha256':sha(BASE/'plan.json'),
  'selectedPlan':str(metadata/'selection.json'),'selectedPlanSha256':sha(metadata/'selection.json'),'outputRoot':str(output),'acceptance':False}
 R.atomic_json(BASE/'results.json',compact)
 R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact/f62-dot6-offline-'+sha(BASE/'plan.json')[:16]+'.json'),
  {'schemaVersion':'test-impact.v1','identity':identity,'planSha256':sha(BASE/'plan.json'),'scope':'scoped','map':{'registered-catalogue-sources.js':'390 code-admitted exact envelopes validated by existing F54 candidate builder','corpus-publisher.js':'870 total/869 source; old480 lines +VIN/image bytes preserved','fleet-release.js':'descriptor input only; final release validation pending root'},
   'timingSeconds':result['wall'],'maxSampledRssBytes':result['peak_rss'],'fixtures':'actual already strict-checked retained rows','excluded':plan['excluded']})
 print(json.dumps({'status':'scoped-offline-candidate-prepared','receipt':receipt,'cleanup':compact['cleanup']}))
else:
 print((metadata/'command.log').read_text()[-12000:]);print(json.dumps(result));sys.exit(1)
