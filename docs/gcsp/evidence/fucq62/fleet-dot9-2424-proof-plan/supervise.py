"""Prepared source-free proof chunks. Exact parent-reviewed packet and candidate required."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,shutil,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
assert len(sys.argv)==6 and sys.argv[2]=='--reviewed-plan-sha256' and sys.argv[4]=='--candidate-receipt-sha256'
phase=sys.argv[1];assert phase in ['publish-restart','audit-direct','http0','http1','http2','rollback','summarize']
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
read=lambda p:json.loads(p.read_text())
assert sha(BASE/'plan.json')==sys.argv[3]
plan=read(BASE/'plan.json');candidate=read(pathlib.Path(plan['candidatePlan']['path']));output=pathlib.Path(candidate['outputRoot']);assert sha(output/'candidate-receipt.json')==sys.argv[5]==plan['candidateReceipt']['sha256'];receipt=read(output/'candidate-receipt.json')
cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve();assert cloud.is_dir() and cloud in output.resolve().parents and output.is_dir()
META=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f62/fleet-dot9-2424-proof')/phase;assert not META.exists(),'Fresh phase identity required; no overwrite.'
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
identity={p['path']:p['sha256'] for p in plan['codePins']};identity[str(BASE/'plan.json')]=sha(BASE/'plan.json');identity[str(ROOT/'_tools/test_resources.py')]=sha(ROOT/'_tools/test_resources.py')
inputs={p['path']:p['sha256'] for p in [plan['candidatePlan'],*receipt['files'],*candidate['baseline']['isolatedHistoryPins'],candidate['canonical'],candidate['spent'],candidate['parentAudit']]};inputs[str(output/'candidate-receipt.json')]=sys.argv[5]
if phase!='publish-restart':
 assert (output/'isolated-store').is_dir()
 inputs.update({str(p):sha(p) for p in (output/'isolated-store').rglob('*') if p.is_file()})
 inputs[str(output/'publish-restart-receipt.json')]=sha(output/'publish-restart-receipt.json')
if phase=='summarize':
 for name in ['strict-direct-audit-receipt.json','http-chunk0-receipt.json','http-chunk1-receipt.json','http-chunk2-receipt.json','rollback-receipt.json']:inputs[str(output/name)]=sha(output/name)
for path,digest in {**identity,**inputs}.items():assert sha(pathlib.Path(path))==digest
script='http-chunk.mjs' if phase.startswith('http') else phase+'.mjs'
command=['/opt/homebrew/bin/node','--max-old-space-size=256',str(BASE/script)]+([phase[-1]] if phase.startswith('http') else [])
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':768,'chunk_seconds':180,'log_mib':1});scratch=R.Scratch(META,ROOT,policy,expected=64*R.MIB,checkpoint=META/'result.json');host=R.HostBudget(policy)
disposable=output/'rollback-scratch';assert not disposable.exists()
diskMiB=224 if phase in ['publish-restart','rollback'] else 64
selection={'scope':'scoped .9 offline '+phase,'command':command,'changedPaths':plan['changedPaths'],'regression':plan['regression'],'affectedCallers':plan['affectedCallers'],'integrationBoundaries':plan['integrationBoundaries'],'excluded':plan['excluded'],'workers':1,'resources':{'scratchMiB':64,'diskReservedMiB':diskMiB,'hostRamMiB':768,'groupRamMiB':672,'seconds':180},'identity':identity,'inputs':inputs,'candidateManifestDigest':receipt['candidateManifestDigest'],'checkpoint':str(META/'result.json'),'acceptance':False}
R.atomic_json(META/'selection.json',selection)
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir() and not os.path.lexists(link)
reserved=entered=finished=False;link_identity=None;result={}
R.atomic_json(META/'ownership.json',{'owner':R.owner(),'runId':'fleet-dot9-proof-'+phase,'outputRoot':str(output),'retainedOutput':True,'ownedDisposableCloudRoot':str(disposable) if phase=='rollback' else None,'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'dependencyLink':str(link),'dependencyTarget':str(vendor),'plannedPeakMiB':diskMiB,'state':'planned'})
def finish():
 global reserved,entered,finished,link_identity
 if finished:return
 assert all(R.group_has_live_members(g) is False for g in scratch.record['groups'])
 if link_identity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==link_identity and link.resolve()==vendor;link.unlink();link_identity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 removed_cloud=0
 if phase=='rollback' and disposable.exists():
  assert not disposable.is_symlink() and disposable.parent==output
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(disposable)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();removed_cloud=R.allocated_bytes(disposable);shutil.rmtree(disposable)
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in {**identity,**inputs}.items()),'immutable code/input changed'
 cleanup={'scratch':str(scratch.root),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'dependencyLinkAbsent':not os.path.lexists(link),'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'removedCloudScratchBytes':removed_cloud,'cloudScratchAbsent':not disposable.exists(),'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()),'retainedAllocationBytes':R.allocated_bytes(output),'compatibilityException':None,'leftovers':[],'immutablePinsUnchanged':True};R.atomic_json(META/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,diskMiB*R.MIB,768*R.MIB,cloud,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino);R.atomic_json(META/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','GCSP_OFFLINE':'1','CANDIDATE_RECEIPT_SHA256':sys.argv[5]},META/'command.log',scratch,policy,64*R.MIB,672*R.MIB,180,host);R.atomic_json(META/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
name={'publish-restart':'publish-restart-receipt.json','audit-direct':'strict-direct-audit-receipt.json','http0':'http-chunk0-receipt.json','http1':'http-chunk1-receipt.json','http2':'http-chunk2-receipt.json','rollback':'rollback-receipt.json','summarize':'offline-proof-summary.json'}[phase]
compact={'scope':'scoped offline '+phase,'result':result,'cleanup':read(META/'cleanup.json'),'planSha256':sys.argv[3],'candidateReceiptSha256':sys.argv[5],'selectionSha256':sha(META/'selection.json'),'acceptance':False}
if (output/name).exists():compact.update({'receipt':read(output/name),'receiptSha256':sha(output/name)})
R.atomic_json(BASE/(phase+'-results.json'),compact)
R.atomic_json(pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs/impact')/('f62-dot9-'+phase+'.json'),{'schemaVersion':'test-impact.v1','scope':'scoped','codeIdentity':identity,'inputIdentity':inputs,'boundaries':plan['integrationBoundaries'],'selected':command,'timingSeconds':result.get('wall'),'maxSampledGroupRssBytes':result.get('peak_rss'),'excluded':plan['excluded'],'acceptance':False})
print((META/'command.log').read_text()[-6000:]);print(json.dumps({k:v for k,v in compact.items() if k!='receipt'}));sys.exit(0 if result.get('rc')==0 and not result.get('issue') else 1)
