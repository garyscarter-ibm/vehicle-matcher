"""Changed selection/base/refusal/freeze/refresh contracts only. Zero source requests."""
import sys
sys.dont_write_bytecode=True
import copy,datetime,hashlib,json,os,pathlib,shutil,subprocess,tempfile,unittest
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text());sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def put(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v)+'\n')
A=read(BASE/'series-plan.json');M=read(BASE/'candidate-manifest.json')
class Focused(unittest.TestCase):
 def test_counts_pins_and_unchanged_protocol(self):
  self.assertEqual(len(A['chunks']),120);self.assertEqual(A['baseline'],{'admittedSource':7517,'canonical':7520,'spent':9759});self.assertTrue(A['baseRefreshRequired'])
  selection=read(BASE.parent/'scheme-breadth30-phase03-candidates960-2026-11-07/candidate-selection.json');req=[d for e in A['chunks']for d in e['requestDigests']]
  self.assertEqual(req,selection['requestDigests']);self.assertEqual(len(set(req)),960);self.assertEqual(sum(e['maximumGets']for e in A['chunks']),1440)
  self.assertFalse(set(req).intersection(r['requestDigest']for r in read(A['indexPins']['spent']['path'])['entries']))
  self.assertEqual([e['originalPoolNumber']for e in A['chunks']],list(range(241,361)))
  self.assertEqual(A['phases']['phase03']['maximumWallSeconds'],1800);self.assertFalse(A['refreshBeforeRelease']['fullPriorPhaseCompletionRequired'])
  for p,h in {**A['codePins'],**A['sourcePins']}.items():self.assertEqual(sha(ROOT/p),h,p)
  for p,h in A['runtimePins'].items():self.assertEqual(sha(p),h,p)
  old=BASE.parent/'scheme-breadth30-phase02-960-series-2026-11-07'
  for name in['actual-event-history.mjs','check-release.mjs','group-proof.py','live-check.test.mjs','prepare-session.py','reconcile-retained.py','run-live.mjs','run-series.py','supervise.py','verify-retained.py']:
   self.assertEqual((BASE/name).read_text().replace('phase03','phase02').replace('PHASE03','PHASE02'),(old/name).read_text(),name)
 def test_entrypoints_refuse_without_grants(self):
  env={k:v for k,v in os.environ.items()if not k.startswith('BREADTH30_PHASE03')}
  for name,arg in[('run-series.py','phase03'),('prepare-session.py','1'),('supervise.py','1'),('run-live.mjs','1')]:
   cmd=([sys.executable,'-I','-B']if name.endswith('.py')else['/opt/homebrew/bin/node'])+[str(BASE/name),arg];r=subprocess.run(cmd,cwd=ROOT,env=env,capture_output=True,text=True,timeout=10)
   self.assertNotEqual(r.returncode,0);self.assertRegex(r.stderr,'grant|required|parent-released-stage')
  self.assertFalse(pathlib.Path(A['outputRoot']).exists())
 def test_first_freeze_and_existing_target_preservation(self):
  with tempfile.TemporaryDirectory(prefix='phase03-freeze-')as folder:
   root=pathlib.Path(folder);code=root/BASE.relative_to(ROOT);code.mkdir(parents=True);shutil.copyfile(BASE/'prepare-session.py',code/'prepare-session.py')
   e=copy.deepcopy(A['chunks'][0]);e.update(outputDirectory=str(root/'output/sessions/session001'),supervisorOutput=str(root/'metadata/session001'))
   for rel in[e['templatePath'],next(c for c in M['contexts']if c['modelRegistration']['modelCode']==e['modelCode'])['typedBasisPath']]:
    target=root/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/rel,target)
   output=root/'output';put(output/'output-ownership.json',{'allocationId':A['id']});put(output/'phase03-once.json',{'id':A['phases']['phase03']['grantId'],'state':'reserved-and-consumed','reservedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
   put(code/'candidate-manifest.json',{**M,'chunks':[e]});put(code/'series-plan.json',{**A,'chunks':[e],'codePins':{},'sourcePins':{},'outputRoot':str(output),'candidateManifestSha256':sha(code/'candidate-manifest.json')})
   env={**os.environ,'BREADTH30_PHASE03_STAGE':A['id'],'BREADTH30_PHASE03_PHASE_GRANT':A['phases']['phase03']['grantId']};command=[sys.executable,'-I','-B',str(code/'prepare-session.py'),'1']
   r=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=10);self.assertEqual(r.returncode,0,r.stderr);execution=pathlib.Path(e['outputDirectory'])/'execution-plan.json';before=sha(execution);self.assertEqual(read(execution)['baseline'],A['baseline'])
   r=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=10);self.assertNotEqual(r.returncode,0);self.assertEqual(sha(execution),before)
 def test_actual_partial_prefix_refresh_once_and_preserve(self):
  with tempfile.TemporaryDirectory(prefix='phase03-refresh-')as folder:
   root=pathlib.Path(folder);code=root/BASE.relative_to(ROOT);code.mkdir(parents=True);shutil.copyfile(BASE/'refresh-base.py',code/'refresh-base.py')
   canonical={'entries':[{'configurationId':'one','origins':[{'kind':'admitted-source','path':'immutable.jsonl'}]}]};spent={'entries':[{'requestDigest':'spent-one','identity':'unchanged'}]};source=root/'actual';session=source/'sessions/session001'
   put(session/'final-canonical-index.json',canonical);put(session/'final-spent-request-index.json',spent);put(session/'live-validation.json',{'retainedChecks':{'summary':{'tests':5,'pass':5}},'finalCanonicalIndexSha256':sha(session/'final-canonical-index.json'),'finalSpentRequestIndexSha256':sha(session/'final-spent-request-index.json')});put(source/'receipt.json',{'completedSessions':[{'session':1}],'reason':'phase-incomplete'})
   parent=root/'parent';put(parent/'canonical.json',canonical);put(parent/'spent.json',spent);audit={'errors':[],'checks':1,'admittedSource':1,'canonical':1,'spent':1,'canonicalPin':{'path':str(parent/'canonical.json'),'sha256':sha(parent/'canonical.json')},'spentPin':{'path':str(parent/'spent.json'),'sha256':sha(parent/'spent.json')}};put(parent/'audit.json',audit)
   fa=copy.deepcopy(A);fa.update(codePins={},sourcePins={},baseline={'admittedSource':1,'canonical':1,'spent':1},outputRoot=str(root/'unspent'),outputOwnershipManifest=str(root/'meta/durable-series.json'));fa['refreshBeforeRelease']['currentPhase02cReceipt']=str(source/'receipt.json');put(code/'series-plan.json',fa);put(code/'candidate-manifest.json',M);before=sha(code/'series-plan.json')
   command=[sys.executable,'-I','-B',str(code/'refresh-base.py'),str(parent/'audit.json'),sha(parent/'audit.json')];r=subprocess.run(command,cwd=root,capture_output=True,text=True,timeout=10);self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(sha(code/'base-history/series-plan.json'),before);self.assertFalse(read(code/'series-plan.json')['baseRefreshRequired']);self.assertEqual(read(code/'series-plan.json')['refreshBeforeRelease']['actualStrictPrefixSessions'],1);self.assertFalse((root/'unspent').exists())
   updated=sha(code/'series-plan.json');r=subprocess.run(command,cwd=root,capture_output=True,text=True,timeout=10);self.assertNotEqual(r.returncode,0);self.assertEqual(sha(code/'series-plan.json'),updated)
if __name__=='__main__':unittest.main(verbosity=2)
