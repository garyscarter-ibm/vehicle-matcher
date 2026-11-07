"""Freeze untouched original phase02 templates133–240 from the actual strict11 prefix. No source traffic."""
import sys
sys.dont_write_bytecode=True
import copy,datetime,hashlib,json,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text());sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
oldbase=BASE.parent/'scheme-breadth30-phase02-960-series-2026-11-07';old=read(oldbase/'series-plan.json')
assert sha(oldbase/'series-plan.json')=='ef251096585a9da6ebaf9c66d379bbabc4e28cde43056290e58c6d35535d596e'
oldmanifest=read(oldbase/'candidate-manifest.json');prior=pathlib.Path(old['outputRoot']);receipt=read(prior/'phase02-receipt.json');cleanup=read(prior/'phase02-cleanup.json')
assert receipt['reason']=='phase-incomplete'and len(receipt['completedSessions'])==11 and receipt['aggregateGets']==143 and receipt['aggregateSolverRequests']==95
assert cleanup['retainedLogicalBytes']==191769861
local=prior/'sessions/session011';audit=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/breadth30-phase02-actual-interruption-audit.json')
assert sha(audit)=='5f7a5614f53828bd3b94a5ef5eafe52d4f6cc43306610dfe2fba43917d2139ad';assert read(audit)['errors']==[]
indexes={}
for key,name,expected,count in [('canonical','final-canonical-index.json','4e851458f6a8b4fc644b8892a854e12ebf7b59d477229a26f23f5a9f9e14c4ce',7586),('spent','final-spent-request-index.json','01bb1fd4d8b5866e3f70eb19e14c36197c2735962cae533c12c5d706099e7299',9847)]:
 p=local/name;v=read(p);assert sha(p)==expected and len(v['entries'])==count;indexes[key]={'path':str(p),'sha256':expected,'digest':digest(v),'entries':count}
output=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/scheme-breadth30-phase02c-864-20261107-once');control=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth30-phase02c-864')
assert not output.exists()and not(BASE/'series-plan.json').exists()
chunks=[]
for n,entry in enumerate(old['chunks'][12:],1):
 e=copy.deepcopy(entry);e.update(number=n,originalPhase02Number=entry['number'],phase='phase02c',cohort=(n-1)//4+1,outputDirectory=str(output/'sessions'/('session%03d'%n)),supervisorOutput=str(control/('session%03d'%n)));chunks.append(e)
requests=[d for e in chunks for d in e['requestDigests']];excluded=old['chunks'][11]['requestDigests'];used={r['requestDigest']for r in read(local/'final-spent-request-index.json')['entries']}
assert len(chunks)==108 and len(requests)==len(set(requests))==864 and not used.intersection(requests)and not set(excluded).intersection(requests)
assert [e['originalPoolNumber']for e in chunks]==list(range(133,241))and sum(e['maximumGets']for e in chunks)==1296
manifest=copy.deepcopy(oldmanifest);manifest.update(schemaVersion='breadth30-phase02c-candidate-manifest.v1',id='scheme-breadth30-phase02c-864-20261107-once',baseline={'canonical':7586,'admittedSource':7583,'spent':9847},indexPins=indexes,chunks=chunks,requestDigests=requests,sourceGrant=False,trafficExecuted=False,capacityCredit=0,conservativelyExcludedPhase02Session012RequestDigests=excluded)
(BASE/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(BASE/'scheme-context-gaps.json').write_bytes((oldbase/'scheme-context-gaps.json').read_bytes())
marker=prior/'phase02-once.json';consumed=read(marker);assert consumed['reservedAt']=='2026-11-07T06:18:01.823979+00:00'
s=copy.deepcopy(old);s.update(schemaVersion='breadth30-phase02c-series-plan.v1',id=manifest['id'],status='concrete finite untouched continuation; separate exact parent source release required',codeCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),candidateManifestSha256=sha(BASE/'candidate-manifest.json'),schemeContextGapsSha256=sha(BASE/'scheme-context-gaps.json'),baseline=manifest['baseline'],indexPins=indexes,chunks=chunks,baseRefreshRequired=False,parentPilotAudit={'path':str(audit),'sha256':sha(audit),'scope':'child read-only strict11 actual prefix audit; independent exact parent review/release still required; no global union BUILD gate'},candidateAllowance=864,attemptAllowance=1296,decodedBytes=108*4194304,outputRoot=str(output),outputOwnershipManifest=str(control/'ownership/durable-series.json'),phases={'phase02c':{'grantId':manifest['id']+'-phase02c','sessions':list(range(1,109)),'solverCeiling':864,'getCeiling':1296,'maximumWallSeconds':1800,'originalConsumedAt':consumed['reservedAt'],'originalAbsoluteDeadline':'2026-11-07T06:48:01.823979+00:00','separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':False}},sourceGrant=False)
s['resources'].update(retainedBudgetBytes=3221225472,peakIncludingRetainedBudgetBytes=3288334336,expectedRetainedBytes=1800000000)
s['forecast'].update(seconds=900,retainedBytes=1800000000,basis='108 untouched original templates; proved preceding strict sessions; unchanged64MiB/512MiB/32MiB shard; remaining original clock and3GiB continuation cap')
s['refreshBeforeRelease']={'required':False,'sourceGrant':False,'reason':'exact local strict11 prefix independently auditable; original full120 completion and global union are not BUILD gates'}
s['interruption']={'session':12,'GET':11,'solver':7,'rawAdmissionsWithheld':5,'sourceCapacityCredit':0,'conservativelyExcludedRequestDigests':excluded,'originalConsumedMarker':str(marker),'originalConsumedMarkerSha256':sha(marker),'sourceReceipt':str(prior/'phase02-receipt.json'),'sourceReceiptSha256':sha(prior/'phase02-receipt.json'),'noFull120CompletionBuildGate':True}
s['continuationAccounting']={'actualBefore':{'GET':143,'solver':95,'retainedLogicalBytes':191769861},'originalCeiling':{'GET':1440,'solver':960,'retainedBytes':4294967296},'maximumCumulative':{'GET':1439,'solver':959,'retainedLogicalBytes':3412995333}}
s['commandAfterExactParentRelease']=['/usr/bin/python3','-I','-B',str(BASE/'run-series.py'),'phase02c'];s['sourceGrantEnvironment']={'BREADTH30_PHASE02C_PHASE_GRANT':s['phases']['phase02c']['grantId']}
own={str(p.relative_to(ROOT))for p in BASE.iterdir()if p.suffix in ['.py','.mjs']};own.update(str((BASE/n).relative_to(ROOT))for n in ['candidate-manifest.json','scheme-context-gaps.json'])
shared={p for p in old['codePins']if not p.startswith(str(oldbase.relative_to(ROOT))+'/')};s['codePins']={p:sha(ROOT/p)for p in sorted(shared|own)};s['sourcePins']=old['sourcePins']
(BASE/'series-plan.json').write_text(json.dumps(s,indent=2)+'\n')
print(json.dumps({'seriesSha256':sha(BASE/'series-plan.json'),'manifestSha256':sha(BASE/'candidate-manifest.json'),'sessions':108,'solver':864,'GET':1296,'baseline':s['baseline'],'sourceGrant':False}))
