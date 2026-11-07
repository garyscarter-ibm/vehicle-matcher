"""Prepare exact original templates81–120 after partial79; local independently reviewed prefix is sufficient."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,copy,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
poolbase=BASE.parent/'scheme-breadth30-typed-unspent10940-2026-11-07';pool=read(poolbase/'pool.json')
assert pool['sourceGrant']is False and pool['remainingSolverRequests']==10940
oldbase=BASE.parent/'scheme-breadth30-phase01-960-series-2026-11-07';old=read(oldbase/'series-plan.json')
globalroot=pathlib.Path(old['outputRoot'])/'sessions/session079'
audit=oldbase/'actual-interruption-audit.json'
assert sha(audit)=='cbb46cf59de1dcf372be9264fe23aff401b08cc166a3d736af948b121b4f9d3c'
indexes={}
for key,name,expected,count in [('canonical','final-canonical-index.json','75f91eee61285525fab904443d1dc51223d5d1a24b14af1f165eed8dd49afa45',6309),('spent','final-spent-request-index.json','0441a9cc020fd503c2b694e792f08f2efa868de34a26c1e3345ba6ce55bfd41b',8076)]:
 path=globalroot/name;value=read(path);assert sha(path)==expected and len(value['entries'])==count
 indexes[key]={'path':str(path),'sha256':expected,'digest':digest(value),'entries':count}
output=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/scheme-breadth30-phase01c-320-20261107-once')
metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth30-phase01c-320')
assert not output.exists()and not (BASE/'series-plan.json').exists(),'preserve an existing prepared or spent phase'
chunks=[]
for number,prior in enumerate(pool['chunks'][80:120],1):
 entry=copy.deepcopy(prior);poolnumber=entry['number'];entry.update(number=number,originalPoolNumber=poolnumber,phase='phase01c',cohort=(number-1)//4+1,decodedBytes=4194304,outputDirectory=str(output/'sessions'/('session%03d'%number)),supervisorOutput=str(metadata/('session%03d'%number)))
 assert sha(ROOT/entry['templatePath'])==entry['templateSha256'];chunks.append(entry)
requests=[r for c in chunks for r in c['requestDigests']];used={r['requestDigest']for r in read(globalroot/'final-spent-request-index.json')['entries']}
assert len(chunks)==40 and len(requests)==len(set(requests))==320 and not used.intersection(requests)
assert sum(c['maximumGets']for c in chunks)==480 and requests==pool['requestDigests'][640:960]
manifest={'schemaVersion':'breadth30-phase01c-candidate-manifest.v1','id':'scheme-breadth30-phase01c-320-20261107-once','poolPin':{'path':str(poolbase/'pool.json'),'sha256':sha(poolbase/'pool.json')},'baseline':{'canonical':6309,'admittedSource':6306,'spent':8076},'indexPins':indexes,'contexts':pool['contexts'],'chunks':chunks,'requestDigests':requests,'trafficExecuted':False,'sourceGrant':False,'capacityCredit':0,'poolRemainingAfterThisPhase':9980}
(BASE/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(BASE/'scheme-context-gaps.json').write_text(json.dumps({'scope':'unchanged original acceptance gates; actual30options inputs grant no scheme joins/capacity','remaining':old['remaining'],'sourceGrant':False,'capacityCredit':0,'acceptance':False},indent=2)+'\n')
series=copy.deepcopy(old);series.pop('originalConsumedPhase',None)
series.update(schemaVersion='breadth30-phase01c-series-plan.v1',id=manifest['id'],status='concrete finite prepared phase; independent partial-prefix review and separate exact release required',codeCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),candidateManifestSha256=sha(BASE/'candidate-manifest.json'),schemeContextGapsSha256=sha(BASE/'scheme-context-gaps.json'),indexPins=indexes,baseline=manifest['baseline'],baseRefreshRequired=True,parentPilotAudit={'path':str(audit),'sha256':sha(audit),'scope':'child interruption proof only; independent parent partial-prefix review required before release'},candidateAllowance=320,attemptAllowance=480,decodedBytes=40*4194304,outputRoot=str(output),outputOwnershipManifest=str(metadata/'ownership/durable-series.json'),chunks=chunks,phases={'phase01c':{'grantId':manifest['id']+'-phase01c','sessions':list(range(1,41)),'solverCeiling':320,'getCeiling':480,'maximumWallSeconds':1800,'separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':False,'originalConsumedAt':'2026-11-07T05:46:57.228279+00:00','originalAbsoluteDeadline':'2026-11-07T06:16:57.228279+00:00'}})
series['continuationAccounting']={'actualBefore':{'GET':950,'solver':632,'retainedLogicalBytes':1085613331},'originalCeiling':{'GET':1440,'solver':960,'retainedBytes':4294967296},'maximumAfter':{'GET':1430,'solver':952,'retainedLogicalBytes':2696226067},'excludedUnsolvedSolver':8,'originalAbsoluteDeadline':'2026-11-07T06:16:57.228279+00:00'}
series['interruption']={'sourceReceipt':str(pathlib.Path(old['outputRoot'])/'phase01-receipt.json'),'sourceReceiptSha256':sha(pathlib.Path(old['outputRoot'])/'phase01-receipt.json'),'failedSession':80,'actualFailedGET':2,'actualFailedSolver':0,'conservativelyExcludedRequestDigests':old['chunks'][79]['requestDigests'],'originalSeriesSha256':sha(oldbase/'series-plan.json'),'originalConsumedMarker':str(pathlib.Path(old['outputRoot'])/'phase01-once.json'),'originalConsumedMarkerSha256':sha(pathlib.Path(old['outputRoot'])/'phase01-once.json')}
series['resources'].update(expectedRetainedBytes=650000000,perSessionRetainedShardBytes=33554432,retainedBudgetBytes=1610612736,peakIncludingRetainedBudgetBytes=1677721600)
series['forecast'].update(seconds=300,retainedBytes=650000000,basis='40 exact chunks; prior actual breadth sessions about 7 seconds including strict proof; fresh cumulative indexes grow; 32 MiB per shard and 4 GiB phase caps')
series['refreshBeforeRelease']={'required':True,'reason':'independent parent review of valid79-session local prefix plus explicit failed80 exclusions; global union is not a BUILD gate','preparedPoolSha256':sha(poolbase/'pool.json'),'noSourceBeforeRefresh':True,'requiredBreadth01Prefix':{'receipt':str(pathlib.Path(old['outputRoot'])/'phase01-receipt.json'),'canonical':str(pathlib.Path(old['outputRoot'])/'sessions/session079/final-canonical-index.json'),'spent':str(pathlib.Path(old['outputRoot'])/'sessions/session079/final-spent-request-index.json'),'completedSessions':79,'solverRequests':632,'GET':950,'reason':'phase-incomplete','receiptSha256':sha(pathlib.Path(old['outputRoot'])/'phase01-receipt.json')}}
series['commandAfterExactParentRelease']=['/usr/bin/python3','-I','-B',str(BASE/'run-series.py'),'phase01c'];series['sourceGrantEnvironment']={'BREADTH30_PHASE01C_PHASE_GRANT':series['phases']['phase01c']['grantId']}
assert not set(requests).intersection(series['interruption']['conservativelyExcludedRequestDigests'])
own={str(p.relative_to(ROOT))for p in BASE.iterdir()if p.suffix in ['.py','.mjs']};own.update(str((BASE/n).relative_to(ROOT))for n in ['candidate-manifest.json','scheme-context-gaps.json'])
shared={p for p in old['codePins']if not p.startswith(str(oldbase.relative_to(ROOT))+'/')};series['codePins']={p:sha(ROOT/p)for p in sorted(shared|own)}
sourcepaths=set(pool['sourcePins']);sourcepaths.update(str((poolbase/n).relative_to(ROOT))for n in ['pool.json','preparation-result.json','validation.json','validation-cleanup.json']);sourcepaths.update(c['templatePath']for c in chunks)
series['sourcePins']={p:sha(ROOT/p)for p in sorted(sourcepaths)}
(BASE/'series-plan.json').write_text(json.dumps(series,indent=2)+'\n')
print(json.dumps({'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'codePins':len(series['codePins']),'sourcePins':len(series['sourcePins']),'solver':320,'GET':480,'baseRefreshRequired':True,'sourceGrant':False}))
