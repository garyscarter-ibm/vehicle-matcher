"""Prepared candidate-only supervisor; explicit reviewed plan hash required. No network."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib,shutil,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
assert len(sys.argv)==3 and sys.argv[1]=='--reviewed-plan-sha256'
assert sha(BASE/'plan.json')==sys.argv[2], 'Pass the exact parent-reviewed plan identity.'
plan=json.loads((BASE/'plan.json').read_text());output=pathlib.Path(plan['outputRoot'])
cloud=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude').resolve()
assert cloud.is_dir() and cloud in output.resolve().parents and not output.exists()
metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f62/fleet-dot9-2424-candidate')
assert not metadata.exists(),'Preserve completed/failed chunks; review a fresh continuation rather than overwrite.'
spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
code=[*BASE.glob('*.mjs'),*BASE.glob('*.py'),BASE/'plan.json',ROOT/'scripts/gcsp/fleet-offline-guard.mjs',ROOT/'_tools/test_resources.py']
for directory in ['server/gcsp/vehicle-evidence','server/gcsp/policy','server/gcsp/repository','server/vehicle-evidence']:
 code.extend((ROOT/directory).glob('*.js'));code.extend((ROOT/directory).glob('*.json'))
identity={str(p):sha(p) for p in sorted(set(code))}
inputs={p['path']:p['sha256'] for p in [plan['canonical'],plan['spent'],plan['parentAudit'],plan['baseline']['descriptor'],*plan['baseline']['files'],*plan['baseline']['retainedPackAssets'],*plan['baseline']['isolatedHistoryPins'],*plan['novelRows']['originFilePins'],plan['technicalSupplement'],*plan['productionCodePins'],*plan['preparedScripts']]}
for path,digest in inputs.items():assert sha(pathlib.Path(path))==digest
assert sha(pathlib.Path(plan['sourceRegistrationProposal']['path']))==plan['sourceRegistrationProposal']['afterSha256']
assert not pathlib.Path(plan['sourceRegistrationProposal']['registeredSourcePath']).exists()
command=['/opt/homebrew/bin/node','--max-old-space-size=384',str(BASE/'prepare-candidate.mjs')]
selection={'scope':'scoped offline candidate only','changedPaths':['registered-catalogue-sources.js',plan['sourceRegistrationProposal']['registeredSourcePath'],str(BASE)],'regression':'501 disjoint retained admissions plus exact1configuration/4fact supplement over byte-preserved .8','affectedCallers':['writeCorpusCandidate','validateCorpusDirectory','registeredCatalogueSources','validateRegisteredTechnicalSupplement'],'integrationBoundaries':['all1924prior configuration lines andVIN/images exact','501original accepted rows with strict actual source envelopes','full47file/9version .8history unchanged','2427canonical union excludes exactly2unadmitted observations'],'command':command,'excluded':['source traffic','native SQL','full suite','DTO/HTTP/consumer proof pending separate chunks','isolated publish/package pending separate reviewed scripts','ordinary store','public uploads/downloads','activation'],'identity':identity,'inputs':inputs,'workers':1,'limits':plan['limits'],'checkpoint':str(output/'candidate-receipt.json')}
R.atomic_json(metadata/'selection.json',selection)
policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':768,'chunk_seconds':180,'log_mib':1})
scratch=R.Scratch(metadata,ROOT,policy,expected=64*R.MIB,checkpoint=output/'candidate-receipt.json');host=R.HostBudget(policy)
link=ROOT/'server/node_modules';vendor=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules');assert vendor.is_dir() and not os.path.lexists(link)
reserved=entered=finished=False;link_identity=None;result={}
R.atomic_json(metadata/'retained-output-ownership.json',{'owner':R.owner(),'runId':'fleet-dot9-2424-candidate','outputRoot':str(output),'expectedRetainedMiB':64,'disposable':False,'retainOnInterruption':True,'registeredSourcePath':plan['sourceRegistrationProposal']['registeredSourcePath'],'registeredSourceSha256':plan['novelRows']['aggregate']['sha256'],'scratchRoot':str(scratch.root),'scratchManifest':str(scratch.manifest),'state':'planned'})
def finish():
 global reserved,entered,finished,link_identity
 if finished:return
 assert all(R.group_has_live_members(g) is False for g in scratch.record['groups']),'Stop and join owned groups first.'
 if link_identity:
  st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==link_identity and link.resolve()==vendor;link.unlink();link_identity=None
 if entered:
  opened=subprocess.run(['/usr/sbin/lsof','-t','+D',str(scratch.root)],capture_output=True,timeout=10);assert opened.returncode in [0,1] and not opened.stdout.strip();scratch.__exit__(None,None,None);entered=False
 if reserved:host.release(scratch.token);reserved=False
 assert all(sha(pathlib.Path(p))==h for p,h in identity.items()),'code identity changed'
 assert all(sha(pathlib.Path(p))==h for p,h in inputs.items()),'immutable input changed'
 cleanup={'scratch':str(scratch.root),'manifest':str(scratch.manifest),'scratchAbsent':not os.path.lexists(scratch.root),'groupsAbsent':True,'dependencyLinkAbsent':not os.path.lexists(link),'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),'removedScratchPeakBytes':scratch.record['peak'],'retainedOutput':str(output),'retainedLogicalBytes':sum(p.stat().st_size for p in output.rglob('*') if p.is_file()) if output.exists() else 0,'retainedAllocationBytes':R.allocated_bytes(output) if output.exists() else 0,'compatibilityException':None,'leftovers':[],'codeIdentityUnchanged':True,'inputIdentityUnchanged':True,'freeDiskBytes':shutil.disk_usage(cloud).free}
 R.atomic_json(metadata/'cleanup.json',cleanup);finished=True
atexit.register(finish)
try:
 with R.handled_termination():
  host.acquire(scratch.token,128*R.MIB,768*R.MIB,cloud,root=scratch.root);reserved=True;scratch.__enter__();entered=True
  output.mkdir(mode=0o700)
  link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino);R.atomic_json(metadata/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
  result=R.run_process(command,ROOT,{'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC'},metadata/'command.log',scratch,policy,64*R.MIB,672*R.MIB,180,host);R.atomic_json(metadata/'result.json',result)
finally:
 try:finish()
 finally:atexit.unregister(finish)
compact={'scope':'scoped offline candidate','result':result,'cleanup':R.read_json(metadata/'cleanup.json',{}),'selection':str(metadata/'selection.json'),'selectionSha256':sha(metadata/'selection.json'),'planSha256':sha(BASE/'plan.json'),'acceptance':False}
receipt=output/'candidate-receipt.json'
if receipt.exists():compact.update({'receipt':json.loads(receipt.read_text()),'receiptSha256':sha(receipt)})
R.atomic_json(BASE/'candidate-results.json',compact)
print((metadata/'command.log').read_text()[-6000:]);print(json.dumps(compact));sys.exit(0 if result.get('rc')==0 and result.get('issue') is None else 1)
