"""Prepare exact first120 breadth templates. No source grant; fresh final G42/F70 union remains required."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,copy,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
poolbase=BASE.parent/'scheme-breadth30-typed-unspent10940-2026-11-07';pool=read(poolbase/'pool.json')
assert pool['sourceGrant']is False and pool['remainingSolverRequests']==10940
oldbase=BASE.parent/'g42-unspent1304-series-2026-11-07';old=read(oldbase/'series-plan.json')
globalroot=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/global-union4666-20261107')
audit=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/global-union4666-parent-audit.json')
assert sha(audit)=='7a9fa86e2b55cbc04510a29e30052971692f6ba75f836123c073cd48ac448951'
indexes={}
for key,name,expected,count in [('canonical','final-canonical-index.json','a2ad005405b00ab964245265eac10106d221dc4997121e3b65d6dc6142959e1d',4669),('spent','final-spent-request-index.json','1110cc201c789fb28648e5b9489a9e2eef9762245a97f7ea2d13ccca4985e567',6140)]:
 path=globalroot/name;value=read(path);assert sha(path)==expected and len(value['entries'])==count
 indexes[key]={'path':str(path),'sha256':expected,'digest':digest(value),'entries':count}
output=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/scheme-breadth30-phase01-960-20261107-once')
metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth30-phase01-960')
assert not output.exists()and not (BASE/'series-plan.json').exists(),'preserve an existing prepared or spent phase'
chunks=[]
for prior in pool['chunks'][:120]:
 entry=copy.deepcopy(prior);number=entry['number'];entry.update(originalPoolNumber=number,phase='phase01',cohort=(number-1)//4+1,decodedBytes=4194304,outputDirectory=str(output/'sessions'/('session%03d'%number)),supervisorOutput=str(metadata/('session%03d'%number)))
 assert sha(ROOT/entry['templatePath'])==entry['templateSha256'];chunks.append(entry)
requests=[r for c in chunks for r in c['requestDigests']];used={r['requestDigest']for r in read(globalroot/'final-spent-request-index.json')['entries']}
assert len(chunks)==120 and len(requests)==len(set(requests))==960 and not used.intersection(requests)
assert sum(c['maximumGets']for c in chunks)==1440 and requests==pool['requestDigests'][:960]
manifest={'schemaVersion':'breadth30-phase01-candidate-manifest.v1','id':'scheme-breadth30-phase01-960-20261107-once','poolPin':{'path':str(poolbase/'pool.json'),'sha256':sha(poolbase/'pool.json')},'baseline':{'canonical':4669,'admittedSource':4666,'spent':6140},'indexPins':indexes,'contexts':pool['contexts'],'chunks':chunks,'requestDigests':requests,'trafficExecuted':False,'sourceGrant':False,'capacityCredit':0,'poolRemainingAfterThisPhase':9980}
(BASE/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(BASE/'scheme-context-gaps.json').write_text(json.dumps({'scope':'unchanged original acceptance gates; actual30options inputs grant no scheme joins/capacity','remaining':old['remaining'],'sourceGrant':False,'capacityCredit':0,'acceptance':False},indent=2)+'\n')
series=copy.deepcopy(old);series.pop('originalConsumedPhase',None)
series.update(schemaVersion='breadth30-phase01-series-plan.v1',id=manifest['id'],status='concrete finite prepared phase; fresh final global base and separate exact release required',codeCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),candidateManifestSha256=sha(BASE/'candidate-manifest.json'),schemeContextGapsSha256=sha(BASE/'scheme-context-gaps.json'),indexPins=indexes,baseline=manifest['baseline'],baseRefreshRequired=True,parentPilotAudit={'path':str(audit),'sha256':sha(audit),'scope':'independent4666admitted/6140spent union; active1304/finalF70 refresh remains required'},candidateAllowance=960,attemptAllowance=1440,decodedBytes=120*4194304,outputRoot=str(output),outputOwnershipManifest=str(metadata/'ownership/durable-series.json'),chunks=chunks,phases={'phase01':{'grantId':manifest['id']+'-phase01','sessions':list(range(1,121)),'solverCeiling':960,'getCeiling':1440,'maximumWallSeconds':1800,'separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':True}})
series['resources'].update(expectedRetainedBytes=1800000000,perSessionRetainedShardBytes=33554432)
series['forecast'].update(seconds=900,retainedBytes=1800000000,basis='120exactchunks; previousactual8candidate sessions about6seconds includingstrictproof; cumulative4666+finalactiveindexes grow;32MiB/shard and4GiBphase caps')
series['refreshBeforeRelease']={'required':True,'reason':'reconcile every actual spent/admitted1304 and F70 prefix into fresh parent-audited global input; preserve all origins and no replay','preparedPoolSha256':sha(poolbase/'pool.json'),'noSourceBeforeRefresh':True,'requiredG42Final':{'receipt':str(pathlib.Path(old['outputRoot'])/'continuation-receipt.json'),'canonical':str(pathlib.Path(old['outputRoot'])/'sessions/session163/final-canonical-index.json'),'spent':str(pathlib.Path(old['outputRoot'])/'sessions/session163/final-spent-request-index.json'),'completedSessions':163,'solverRequests':1304}}
series['commandAfterExactParentRelease']=['/usr/bin/python3','-I','-B',str(BASE/'run-series.py'),'phase01'];series['sourceGrantEnvironment']={'BREADTH30_PHASE01_PHASE_GRANT':series['phases']['phase01']['grantId']}
own={str(p.relative_to(ROOT))for p in BASE.iterdir()if p.suffix in ['.py','.mjs']};own.update(str((BASE/n).relative_to(ROOT))for n in ['candidate-manifest.json','scheme-context-gaps.json'])
shared={p for p in old['codePins']if not p.startswith(str(oldbase.relative_to(ROOT))+'/')};series['codePins']={p:sha(ROOT/p)for p in sorted(shared|own)}
sourcepaths=set(pool['sourcePins']);sourcepaths.update(str((poolbase/n).relative_to(ROOT))for n in ['pool.json','preparation-result.json','validation.json','validation-cleanup.json']);sourcepaths.update(c['templatePath']for c in chunks)
series['sourcePins']={p:sha(ROOT/p)for p in sorted(sourcepaths)}
(BASE/'series-plan.json').write_text(json.dumps(series,indent=2)+'\n')
print(json.dumps({'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'codePins':len(series['codePins']),'sourcePins':len(series['sourcePins']),'solver':960,'GET':1440,'baseRefreshRequired':True,'sourceGrant':False}))
