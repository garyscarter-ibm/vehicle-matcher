"""Bounded offline .8 chunks; OneDrive outputs, exact ownership and cleanup."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,shutil,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text())
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def group_absent(R,g):
 if R.group_has_live_members(g) is False:return True
 try:os.killpg(g,0)
 except ProcessLookupError:return True
 return False
phase=sys.argv[1];assert phase in ['candidate','candidate2','describe','pack','audit','http-complement','recovery','diagnose','audit-summary','audit-summary2','http-complement2','recovery2']
plan=read(BASE/'plan.json');output=pathlib.Path(plan['outputRoot']);cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents
metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f62/fleet-dot8-1923-offline')/phase
assert not metadata.exists(),'fresh chunk required; preserve completed results'
assert not output.exists() if phase=='candidate' else output.is_dir()
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
code=list(BASE.glob('*.mjs'))+list(BASE.glob('*.py'))+[BASE/'plan.json',ROOT/'scripts/gcsp/fleet-offline-guard.mjs',ROOT/'scripts/gcsp/verify-fleet.mjs']
for directory in ['server/gcsp/vehicle-evidence','server/gcsp/policy','server/gcsp/repository','server/vehicle-evidence']:
 code.extend((ROOT/directory).glob('*.js'));code.extend((ROOT/directory).glob('*.json'))
identity={str(p):sha(p) for p in sorted(set(code))}
inputs={str(p):sha(p) for p in pathlib.Path(plan['baseline']['store']).rglob('*') if p.is_file()}
for item in plan['sourceInputs']:
 for key in ['path','primary','proof']:inputs[item[key]]=sha(pathlib.Path(item[key]))
for p in (ROOT/'server/data/gcsp/vehicle-evidence/registered-sources').glob('*.jsonl'):inputs[str(p)]=sha(p)
for p in (ROOT/'assets/gcsp-vehicle-evidence').glob('*.webp'):inputs[str(p)]=sha(p)
if phase!='candidate':
 for name in ['manifest.json','configurations.jsonl','vins.jsonl','images.jsonl']:p=output/'candidate'/name;inputs[str(p)]=sha(p)
 if phase!='candidate2':inputs[str(output/'descriptor-inputs.json')]=sha(output/'descriptor-inputs.json')
if phase in ['pack','audit','http-complement','recovery','diagnose','audit-summary','audit-summary2','http-complement2','recovery2']:inputs[str(output/'descriptor.json')]=sha(output/'descriptor.json')
node='/opt/homebrew/bin/node';script={'candidate2':'prepare-candidate.mjs','candidate':'prepare-candidate.mjs','describe':'prepare-package.mjs','pack':'prepare-package.mjs','http-complement':'http-complement.mjs','diagnose':'diagnose.mjs','audit-summary2':'summarize-audit.mjs','http-complement2':'http-complement.mjs','audit-summary':'summarize-audit.mjs','audit':'audit.mjs','recovery2':'recover.mjs','recovery':'recover.mjs'}[phase]
command=[node,'--max-old-space-size=320','--expose-gc',str(BASE/script)]+([phase] if phase in ['describe','pack'] else [])
selected={'scope':'scoped offline '+phase,'changedPaths':['registered-catalogue-sources.js',plan['registeredSource']['path'],str(BASE),'fleet-releases.json','registered-corpus-images.js'],
 'regression':'790 retained admissions plus one additive v2 representative image over immutable .6',
 'affectedCallers':['writeCorpusCandidate','SyntheticRegistry.publish/load','validateRelease','packFleetRelease','verifyActiveFleet','restoreFleetRelease'],
 'integrationBoundaries':['strict actual source envelopes and original accepted-line hashes','all1134 prior lines and full durable history','all1925 direct/HTTP lookups and manifest-specific recovery'],
 'command':command,'excluded':plan['excluded'],'resources':plan['resources'],'identity':identity,'inputs':inputs,'checkpoint':str(output/(phase+'-receipt.json'))}
R.atomic_json(metadata/'selection.json',selected)
policy=R.Policy({'chunk_scratch_mib':192,'chunk_ram_mib':640,'chunk_seconds':600,'log_mib':1});scratch=R.Scratch(metadata,ROOT,policy,expected=192*R.MIB,checkpoint=pathlib.Path(selected['checkpoint']));host=R.HostBudget(policy)
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir() and not os.path.lexists(link)
reserved=entered=finished=False;link_identity=None;result={};disposable=output/'recovery-scratch'
R.atomic_json(metadata/'retained-output-ownership.json',{'owner':R.owner(),'runId':plan['runId'],'phase':phase,'outputRoot':str(output),'disposable':False,'expectedRetainedMiB':512,'retainOnInterruption':True,'ownedDisposableCloudRoot':str(disposable) if phase.startswith('recovery') else None,'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'state':'planned'})
def finish():
 global reserved,entered,finished,link_identity
 if finished:return
 assert all(group_absent(R,g) for g in scratch.record['groups']),'owned groups must be joined'
 if link_identity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==link_identity and link.resolve()==vendor;link.unlink();link_identity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 cloud_removed=0
 if phase.startswith('recovery') and disposable.exists():
  assert not disposable.is_symlink() and disposable.parent==output
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(disposable)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();cloud_removed=R.allocated_bytes(disposable);shutil.rmtree(disposable)
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in identity.items()),'code identity changed'
 assert all(sha(pathlib.Path(p))==h for p,h in inputs.items()),'immutable input changed'
 cleanup={'scratch':str(scratch.root),'manifest':str(scratch.manifest),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'dependencyLinkAbsent':not os.path.lexists(link),'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'removedCloudScratchAllocationBytes':cloud_removed,'cloudScratchAbsent':not disposable.exists(),'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),'retainedAllocationBytes':R.allocated_bytes(output),'compatibilityException':None,'leftovers':[],'codeIdentityUnchanged':True,'inputIdentityUnchanged':True,'freeDiskBytes':shutil.disk_usage(cloud).free}
 R.atomic_json(metadata/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,704*R.MIB,640*R.MIB,cloud,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  if phase=='candidate':output.mkdir(mode=0o700)
  link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino);R.atomic_json(metadata/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC'}
  if phase=='audit':
   coverage=scratch.root/'coverage';coverage.mkdir();env['NODE_V8_COVERAGE']=str(coverage)
  result=R.run_process(command,ROOT,env,metadata/'command.log',scratch,policy,192*R.MIB,576*R.MIB,600,host);R.atomic_json(metadata/'result.json',result)
  if phase=='audit':
   contexts=[]
   for p in coverage.glob('*.json'):
    for item in read(p)['result']:
     if str(ROOT) in item['url']:contexts.append({'url':item['url'],'functions':len(item['functions']),'executedRanges':sum(r['count']>0 for f in item['functions'] for r in f['ranges'])})
   R.atomic_json(BASE/'coverage-summary.json',{'scope':'required strict offline audit only','contexts':contexts,'boundedRawBytes':sum(p.stat().st_size for p in coverage.glob('*.json'))})
finally:
 try:finish()
 finally:atexit.unregister(finish)
if result.get('rc')==0 and result.get('issue') is None:
 receipt=output/({'candidate2':'candidate','describe':'publication','pack':'pack','candidate':'candidate','diagnose':'diagnose','audit-summary2':'audit','http-complement2':'http-complement','audit-summary':'audit','audit':'audit','http-complement':'http-complement','recovery2':'recovery','recovery':'recovery'}[phase]+'-receipt.json')
 compact={'scope':'scoped offline '+phase,'result':result,'cleanup':read(metadata/'cleanup.json'),'receipt':read(receipt),'receiptSha256':sha(receipt),'selection':str(metadata/'selection.json'),'selectionSha256':sha(metadata/'selection.json'),'planSha256':sha(BASE/'plan.json'),'acceptance':False}
 R.atomic_json(BASE/(phase+'-results.json'),compact)
 R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot8-'+phase+'-'+sha(BASE/'plan.json')[:16]+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','identity':identity,'inputs':inputs,'map':selected['integrationBoundaries'],'fixtureConfigSubprocessEdges':'actual admitted790 + retained .6 source rows; existing F54 writer/registry/release/pack, bounded child and offline guard; no fixture capacity credited','timingSeconds':result['wall'],'maxSampledRssBytes':result['peak_rss'],'excluded':plan['excluded']})
 (metadata/'command.log').unlink();print(json.dumps({'phase':phase,'result':result,'cleanup':compact['cleanup']}))
else:
 print((metadata/'command.log').read_text()[-16000:]);print(json.dumps(result));sys.exit(1)
