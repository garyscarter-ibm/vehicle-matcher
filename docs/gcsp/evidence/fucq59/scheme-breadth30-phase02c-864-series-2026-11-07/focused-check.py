"""Only changed counts, local base, refusal/freeze and unchanged clock contracts. Zero HTTP."""
import sys
sys.dont_write_bytecode=True
import ast,copy,datetime,hashlib,json,os,pathlib,shutil,subprocess,tempfile,unittest
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text())
sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def put(p,v):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v)+'\n')
A=read(BASE/'series-plan.json');M=read(BASE/'candidate-manifest.json')
class Focused(unittest.TestCase):
 def test_counts_base_original_budget_and_unchanged_clock(self):
  old=read(BASE.parent/'scheme-breadth30-phase02-960-series-2026-11-07/series-plan.json')
  self.assertEqual(len(A['chunks']),108);self.assertEqual(A['baseline'],{'admittedSource':7583,'canonical':7586,'spent':9847})
  used={r['requestDigest']for r in read(A['indexPins']['spent']['path'])['entries']}
  req=[d for e in A['chunks']for d in e['requestDigests']]
  self.assertEqual(req,[d for e in old['chunks'][12:]for d in e['requestDigests']]);self.assertEqual(len(set(req)),864)
  self.assertFalse(used.intersection(req));self.assertFalse(set(A['interruption']['conservativelyExcludedRequestDigests']).intersection(req))
  self.assertEqual(sum(e['maximumGets']for e in A['chunks']),1296)
  for p,h in {**A['codePins'],**A['sourcePins']}.items():self.assertEqual(sha(ROOT/p),h,p)
  for p,h in A['runtimePins'].items():self.assertEqual(sha(p),h)
  for pin in A['indexPins'].values():self.assertEqual(sha(pin['path']),pin['sha256'])
  self.assertEqual(sha(A['parentPilotAudit']['path']),A['parentPilotAudit']['sha256'])
  self.assertEqual(A['continuationAccounting']['maximumCumulative'],{'GET':1439,'solver':959,'retainedLogicalBytes':3412995333})
  self.assertEqual(A['resources']['retainedBudgetBytes'],3221225472)
  self.assertEqual(A['phases']['phase02c']['originalAbsoluteDeadline'],'2026-11-07T06:48:01.823979+00:00')
  prior=ast.parse((BASE.parent/'scheme-breadth30-phase01c-320-series-2026-11-07/run-series.py').read_text());now=ast.parse((BASE/'run-series.py').read_text())
  def parts(tree):
   run=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='run')
   assignments=[n for n in ast.walk(tree)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id in ['started','cohort_started']for t in n.targets)and isinstance(n.value,(ast.Call,ast.BinOp))]
   return ast.dump(run),[ast.dump(n)for n in assignments]
  self.assertEqual(parts(prior),parts(now))
 def test_entrypoints_refuse_without_grants(self):
  env={k:v for k,v in os.environ.items()if not k.startswith('BREADTH30_PHASE02C')}
  for name,arg in [('run-series.py','phase02c'),('prepare-session.py','1'),('supervise.py','1'),('run-live.mjs','1')]:
   command=([sys.executable,'-I','-B']if name.endswith('.py')else['/opt/homebrew/bin/node'])+[str(BASE/name),arg]
   r=subprocess.run(command,cwd=ROOT,env=env,capture_output=True,text=True,timeout=10)
   self.assertNotEqual(r.returncode,0);self.assertRegex(r.stderr,'grant|required|parent-released-stage')
  self.assertFalse(pathlib.Path(A['outputRoot']).exists())
 def test_first_freeze_uses_strict11_and_never_resets_target(self):
  with tempfile.TemporaryDirectory(prefix='phase02c-freeze-')as folder:
   root=pathlib.Path(folder);code=root/BASE.relative_to(ROOT);code.mkdir(parents=True)
   shutil.copyfile(BASE/'prepare-session.py',code/'prepare-session.py')
   e=copy.deepcopy(A['chunks'][0]);e.update(outputDirectory=str(root/'output/sessions/session001'),supervisorOutput=str(root/'metadata/session001'))
   for rel in [e['templatePath'],next(c for c in M['contexts']if c['modelRegistration']['modelCode']==e['modelCode'])['typedBasisPath']]:
    target=root/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/rel,target)
   output=root/'output';put(output/'output-ownership.json',{'allocationId':A['id']});put(output/'phase02c-once.json',{'id':A['phases']['phase02c']['grantId'],'state':'reserved-and-consumed','reservedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
   fm={**M,'chunks':[e]};put(code/'candidate-manifest.json',fm);fa={**A,'chunks':[e],'codePins':{},'sourcePins':{},'outputRoot':str(output),'candidateManifestSha256':sha(code/'candidate-manifest.json')};put(code/'series-plan.json',fa)
   env={**os.environ,'BREADTH30_PHASE02C_STAGE':A['id'],'BREADTH30_PHASE02C_PHASE_GRANT':A['phases']['phase02c']['grantId']}
   command=[sys.executable,'-I','-B',str(code/'prepare-session.py'),'1'];r=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=10)
   self.assertEqual(r.returncode,0,r.stderr);self.assertEqual(read(pathlib.Path(e['outputDirectory'])/'execution-plan.json')['baseline'],A['baseline'])
   r=subprocess.run(command,cwd=root,env=env,capture_output=True,text=True,timeout=10);self.assertNotEqual(r.returncode,0)
 def test_original_expired_deadline_refuses_before_ownership(self):
  with tempfile.TemporaryDirectory(prefix='phase02c-expiry-')as folder:
   root=pathlib.Path(folder);code=root/BASE.relative_to(ROOT);code.mkdir(parents=True)
   shutil.copyfile(BASE/'run-series.py',code/'run-series.py');shutil.copyfile(BASE/'candidate-manifest.json',code/'candidate-manifest.json');shutil.copyfile(BASE/'scheme-context-gaps.json',code/'scheme-context-gaps.json')
   fa=copy.deepcopy(A);fa.update(codePins={},sourcePins={},runtimePins={},outputOwnershipManifest=str(root/'metadata/durable-series.json'))
   stamp=datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=1801);marker=root/'original-once.json';put(marker,{'reservedAt':stamp.isoformat()})
   fa['interruption'].update(originalConsumedMarker=str(marker),originalConsumedMarkerSha256=sha(marker));fa['phases']['phase02c'].update(originalConsumedAt=stamp.isoformat(),originalAbsoluteDeadline=(stamp+datetime.timedelta(seconds=1800)).isoformat())
   put(code/'series-plan.json',fa);r=subprocess.run([sys.executable,'-I','-B',str(code/'run-series.py'),'phase02c'],cwd=root,env={**os.environ,'BREADTH30_PHASE02C_PHASE_GRANT':A['phases']['phase02c']['grantId']},capture_output=True,text=True,timeout=10)
   self.assertNotEqual(r.returncode,0);self.assertIn('original-absolute-deadline-expired',r.stderr);self.assertFalse((root/'metadata').exists());self.assertFalse(pathlib.Path(A['outputRoot']).exists())
if __name__=='__main__':unittest.main(verbosity=2)
