"""Only changed finite slice/baseline/receipt guards; reuse prior34-check unchanged boundary proof."""
import sys
sys.dont_write_bytecode=True
import copy,hashlib,importlib.util,json,os,pathlib,subprocess,tempfile
B=pathlib.Path(__file__).resolve().parent;W=B.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text());sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
s=read(B/'series-plan.json');old=read(W/'docs/gcsp/evidence/fucq59/f70-optional-axis-suffix1556-2026-11-07/series-plan.json');count=0
def passed():
 global count
 count+=1
sp=importlib.util.spec_from_file_location('release',B/'release-context.py');V=importlib.util.module_from_spec(sp);sp.loader.exec_module(V)
assert len(s['chunks'])==145 and s['candidateAllowance']==sum(e['candidates'] for e in s['chunks'])==1156 and s['attemptAllowance']==sum(e['maximumGets'] for e in s['chunks'])==1736;passed()
for i,(entry,prior) in enumerate(zip(s['chunks'],old['chunks'][50:]),1):
 assert entry['number']==i and entry['previousContinuationNumber']==prior['number'] and entry['poolNumber']==552+i and entry['originalSuffixNumber']==548+i
 assert all(entry[k]==prior[k] for k in prior if k not in ['number','cohort','outputDirectory','supervisorOutput','previousContinuationNumber'])
assert [e['cohort'] for e in s['chunks']]==[(i-1)//4+1 for i in range(1,146)];passed()
assert s['preparedBaseline']=={'admittedSource':5507,'canonical':5510,'spent':7559} and s['executionBaseline']=={'admittedSource':5507,'canonical':5510,'spent':7567};passed()
assert s['originalPhase']==old['originalPhase'] and s['resources']['retainedBudgetBytes']+s['resources']['priorStoppedRetainedBytes']==12*1024**3 and s['resources']['workers']==1;passed()
for p,h in {**s['codePins'],**s['sourcePins']}.items():assert sha(W/p)==h,p
assert sha(B/'reconcile-retained.py')==sha(W/'docs/gcsp/evidence/fucq59/f70-optional-axis-suffix1556-2026-11-07/reconcile-retained.py');passed()
with tempfile.TemporaryDirectory(prefix='delta-release-',dir=os.environ['TMPDIR']) as temporary:
 p=pathlib.Path(temporary)/'release.json';r=read(B/'parent-release.example.json');r['released']=True;p.write_text(json.dumps(r));v,c,x=V.validate_release(s,p)
 assert V.counts(c,x)==s['executionBaseline'] and len(x['entries'])==7567;passed()
 ex=read(s['conservativeExclusions']['path']);assert len(ex['entries'])==8 and ex['actualChargedSolverAttempts']==8 and ex['actualChargedGETAttempts']==12 and ex['loggedGETStarts']==11 and ex['missingStartedAttempts']==[9];passed()
 requested=[d for e in s['chunks'] for d in e['requestDigests']];assert len(set(requested))==1156 and not set(requested).intersection(e['requestDigest'] for e in x['entries']);passed()
 original_read=V.read;receipt_path=pathlib.Path(ex['sourceReceiptPath'])
 for key,value in [('reason','operation-timeout'),('actualAttempts',5),('solve',1)]:
  changed=read(receipt_path)
  if key=='solve':changed['counts']['operations']['solve']=value
  else:changed[key]=value
  V.read=lambda q:changed if pathlib.Path(q)==receipt_path else original_read(q)
  try:V.validate_release(s,p)
  except AssertionError:passed()
  else:raise AssertionError('stale failed receipt accepted: '+key)
 V.read=original_read
 for grant,message in [(None,'separate exact parent phase traffic grant required'),(s['phases']['suffix']['grantId'],'parent-release.json')]:
  env=dict(os.environ);env.pop('F70_OPTIONAL_AXIS_PHASE_GRANT',None)
  if grant:env['F70_OPTIONAL_AXIS_PHASE_GRANT']=grant
  result=subprocess.run(['/usr/bin/python3','-I','-B',str(B/'run-series.py'),'suffix'],cwd=W,env=env,capture_output=True,text=True,timeout=10)
  assert result.returncode!=0 and message in result.stderr,result.stderr
  assert not pathlib.Path(s['outputRoot']).exists();passed()
assert not (B/'parent-release.json').exists() and not pathlib.Path(s['outputRoot']).exists()
print(json.dumps({'checks':count,'pass':count,'sourceTraffic':0,'scope':'changed1156finite count/base/exclusion/receipt guards and unreleased-run refusal only','reusedUnchangedPreparationChecks':34,'sourceOutputAbsent':True,'capacityCredit':0}))
