"""Prepare untouched original templates241–360. Zero source; exact current-prefix refresh required."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,copy,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text());sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
prior=BASE.parent/'scheme-breadth30-phase02-960-series-2026-11-07';old=read(prior/'series-plan.json')
selectionbase=BASE.parent/'scheme-breadth30-phase03-candidates960-2026-11-07';selection=read(selectionbase/'candidate-selection.json')
assert sha(selectionbase/'candidate-selection.json')=='c23d9c84875f6631aad0fbff8304ada2faa99359ce6b528f147fafcd577bcafe'
audit=selection['preparedParentAudit'];assert sha(audit['path'])==audit['sha256'];parent=read(audit['path']);assert parent['errors']==[]
indexes={}
for key,pin in selection['preparedIndexPins'].items():
 value=read(pin['path']);assert sha(pin['path'])==pin['sha256'];indexes[key]={**pin,'digest':digest(value),'entries':len(value['entries'])}
baseline=selection['preparedBaseline'];assert baseline=={'admittedSource':7517,'canonical':7520,'spent':9759}
output=pathlib.Path('/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/scheme-breadth30-phase03-960-20261107-once')
metadata=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f58/scheme-breadth30-phase03-960')
assert not output.exists()and not(BASE/'series-plan.json').exists(),'Never replace prepared/spent packet'
chunks=[]
for number,original in enumerate(selection['chunks'],1):
 entry=copy.deepcopy(original);entry.update(number=number,originalPoolNumber=original['number'],phase='phase03',cohort=(number-1)//4+1,decodedBytes=4194304,outputDirectory=str(output/'sessions'/('session%03d'%number)),supervisorOutput=str(metadata/('session%03d'%number)))
 assert sha(ROOT/entry['templatePath'])==entry['templateSha256'];chunks.append(entry)
requests=[d for e in chunks for d in e['requestDigests']];used={r['requestDigest']for r in read(indexes['spent']['path'])['entries']}
assert len(chunks)==120 and len(requests)==len(set(requests))==960 and requests==selection['requestDigests']and not used.intersection(requests)
pool=read(selection['poolPin']['path']);assert sha(selection['poolPin']['path'])==selection['poolPin']['sha256']and requests==pool['requestDigests'][1920:2880]
manifest={'schemaVersion':'breadth30-phase03-candidate-manifest.v1','id':'scheme-breadth30-phase03-960-20261107-once','poolPin':selection['poolPin'],'selectionPin':{'path':str(selectionbase/'candidate-selection.json'),'sha256':sha(selectionbase/'candidate-selection.json')},'baseline':baseline,'indexPins':indexes,'contexts':pool['contexts'],'chunks':chunks,'requestDigests':requests,'trafficExecuted':False,'sourceGrant':False,'capacityCredit':0,'poolRemainingAfterThisPhase':8060}
(BASE/'candidate-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(BASE/'scheme-context-gaps.json').write_text(json.dumps({'scope':'unchanged original acceptance gates; metadata grants no scheme joins/capacity','remaining':old['remaining'],'sourceGrant':False,'capacityCredit':0,'acceptance':False},indent=2)+'\n')
series=copy.deepcopy(old)
for key in ['originalConsumedPhase','interruption','continuationAccounting']:series.pop(key,None)
series.update(schemaVersion='breadth30-phase03-series-plan.v1',id=manifest['id'],status='concrete finite prepared phase; fresh actual parent prefix and separate exact release required',codeCommit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),candidateManifestSha256=sha(BASE/'candidate-manifest.json'),schemeContextGapsSha256=sha(BASE/'scheme-context-gaps.json'),indexPins=indexes,baseline=baseline,baseRefreshRequired=True,parentPilotAudit={**audit,'scope':'prepared7517 baseline only; actual current-prefix refresh required'},candidateAllowance=960,attemptAllowance=1440,decodedBytes=120*4194304,outputRoot=str(output),outputOwnershipManifest=str(metadata/'ownership/durable-series.json'),chunks=chunks,phases={'phase03':{'grantId':manifest['id']+'-phase03','sessions':list(range(1,121)),'solverCeiling':960,'getCeiling':1440,'maximumWallSeconds':1800,'separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':True}})
series['resources'].update(expectedRetainedBytes=2000000000,perSessionRetainedShardBytes=33554432)
series['forecast'].update(seconds=1000,retainedBytes=2000000000,basis='120 untouched eight-request templates; one worker, growing cumulative indexes;32MiB shard/4GiB phase caps')
series['refreshBeforeRelease']={'required':True,'reason':'fresh independent actual current-prefix audit; preserve strict origins/spent identity and excluded failed templates; full prior phase completion is not a BUILD gate','preparedPoolSha256':selection['poolPin']['sha256'],'noSourceBeforeRefresh':True,'currentPhase02cReceipt':'/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/scheme-breadth30-phase02c-864-20261107-once/phase02c-receipt.json','fullPriorPhaseCompletionRequired':False}
series['commandAfterExactParentRelease']=['/usr/bin/python3','-I','-B',str(BASE/'run-series.py'),'phase03'];series['sourceGrantEnvironment']={'BREADTH30_PHASE03_PHASE_GRANT':series['phases']['phase03']['grantId']}
own={str(p.relative_to(ROOT))for p in BASE.iterdir()if p.suffix in['.py','.mjs']};own.update(str((BASE/n).relative_to(ROOT))for n in['candidate-manifest.json','scheme-context-gaps.json'])
shared={p for p in old['codePins']if not p.startswith(str(prior.relative_to(ROOT))+'/')};series['codePins']={p:sha(ROOT/p)for p in sorted(shared|own)}
sourcepaths=set(pool['sourcePins']);poolbase=pathlib.Path(selection['poolPin']['path']).parent
sourcepaths.update(str((poolbase/n).relative_to(ROOT))for n in['pool.json','preparation-result.json','validation.json','validation-cleanup.json']);sourcepaths.update(e['templatePath']for e in chunks);sourcepaths.update(str((selectionbase/n).relative_to(ROOT))for n in['candidate-selection.json','selection-validation.json'])
series['sourcePins']={p:sha(ROOT/p)for p in sorted(sourcepaths)}
(BASE/'series-plan.json').write_text(json.dumps(series,indent=2)+'\n')
print(json.dumps({'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'baseline':baseline,'codePins':len(series['codePins']),'sourcePins':len(series['sourcePins']),'solver':960,'GET':1440,'baseRefreshRequired':True,'sourceGrant':False}))
