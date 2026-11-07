"""Freeze only never-started templates021 onward; no HTTP or traffic grant."""
import sys
sys.dont_write_bytecode=True
import copy,datetime,hashlib,json,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text());sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def put(p,v):
 with p.open('x') as f:f.write(json.dumps(v,indent=2)+'\n')
assert not(BASE/'series-plan.json').exists()
old_base=ROOT/'docs/gcsp/evidence/fucq59/f70-optional-axis-suffix2815-2026-11-07';old=read(old_base/'series-plan.json');previous=pathlib.Path(old['outputRoot']);stopped=read(previous/'stopped-prefix-validation.json')
assert stopped['reconciledSessions']==19 and stopped['actualChargedTraffic']['solver']==151 and stopped['actualChargedTraffic']['gets']==231
assert stopped['strictChecks']['tests']==stopped['strictChecks']['pass']==95 and stopped['strictChecks']['fail']==stopped['strictChecks']['skipped']==0
assert stopped['originalSeriesExit']==1 and stopped['originalsUnchanged'] and stopped['sourceTrafficDuringReconciliation']==0
assert all(stopped['cleanup'][k] for k in ['allChildrenJoined','allOwnedRootsAbsent','allOwnedTokensAbsent','allOwnedGroupsExplicitlyAbsent','dependencyLinkAbsent','seriesReservationAbsent'])
identifier='f70-optional-axis-suffix2660-20261107-once';output=previous.parent/identifier;supervisor=ROOT/'.claude/f58-63-overnight-20261106/f58/f70-optional-axis-suffix2660'
assert not output.exists() and not(BASE/'parent-release.json').exists()
chunks=copy.deepcopy(old['chunks'][20:]);assert len(chunks)==333
for number,entry in enumerate(chunks,1):
 entry.update(previousContinuationNumber=entry['number'],number=number,cohort=(number-1)//4+1)
 entry.update(outputDirectory=str(output/'sessions'/('session%03d'%number)),supervisorOutput=str(supervisor/('session%03d'%number)))
assert sum(e['candidates'] for e in chunks)==2660 and sum(e['maximumGets'] for e in chunks)==3992
index_pins={}
for name,filename in [('canonical','final-canonical-index.json'),('spent','final-spent-request-index.json')]:
 p=previous/'sessions/session019'/filename;v=read(p);index_pins[name]={'path':str(p),'sha256':sha(p),'digest':digest(v),'entries':len(v['entries'])}
proof=previous/'sessions/session019/live-validation.json';baseline={'admittedSource':4509,'canonical':4512,'spent':6055};execution_baseline={**baseline,'spent':6063}
exclusion=BASE/'conservative-exclusions.json';excluded=read(exclusion);assert len(excluded['entries'])==8 and [r['requestDigest'] for r in excluded['entries']]==old['chunks'][19]['requestDigests']
paths=[p for p in old['codePins'] if not p.startswith('docs/gcsp/evidence/fucq59/f70-optional-axis-suffix2815-2026-11-07/')]
paths += [str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.suffix in ['.py','.mjs'] or p.name=='README.md']
code_pins={p:sha(ROOT/p) for p in sorted(set(paths))};source_pins=dict(old['sourcePins'])
for p in [old_base/'series-plan.json',previous/'suffix-once.json',previous/'suffix-receipt.json',previous/'suffix-cleanup.json',previous/'suffix-process-ownership.json',previous/'stopped-prefix-validation.json',previous/'milestone019-validation.json',proof,previous/'sessions/session019/collector-checkpoint.json',previous/'sessions/session019/receipt.json',previous/'sessions/session019/final-canonical-index.json',previous/'sessions/session019/final-spent-request-index.json',previous/'sessions/session020/collector-checkpoint.json',previous/'sessions/session020/receipt.json',previous/'sessions/session020/source-events.jsonl',previous/'sessions/session020/reconciliation-event-evidence.json',old_base/'parent-release.json',exclusion]:
 source_pins[str(p.relative_to(ROOT)) if ROOT in p.parents else str(p)]=sha(p)
original_phase=old['originalPhase'];deadline=datetime.datetime.fromisoformat(original_phase['deadlineAt']);assert datetime.datetime.now(datetime.timezone.utc)<deadline
original_output=pathlib.Path(read(ROOT/'docs/gcsp/evidence/fucq59/f70-optional-axis-suffix5535-2026-11-07/series-plan.json')['outputRoot']);older_continuation=pathlib.Path(read(ROOT/'docs/gcsp/evidence/fucq59/f70-optional-axis-suffix3623-2026-11-07/series-plan.json')['outputRoot']);retained_prior=sum(p.stat().st_size for tree in [original_output,older_continuation,previous] for p in tree.rglob('*') if p.is_file());remaining_retained=12*1024**3-retained_prior;assert remaining_retained>5*1024**3
phase={'grantId':identifier+'-suffix2660','sessions':list(range(1,334)),'solverCeiling':2660,'getCeiling':3992,'maximumWallSeconds':21600,'separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':False,'originalAbsoluteDeadlineRequired':True}
series={'schemaVersion':'f70-optional-axis-suffix2660-series-plan.v1','id':identifier,'status':'prepared-unspent; explicit parent release and exact grant required','codeCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'codePins':code_pins,'sourcePins':source_pins,'candidateManifestPath':old['candidateManifestPath'],'candidateManifestSha256':old['candidateManifestSha256'],'preparedIndexPins':index_pins,'preparedStrictProof':{'path':str(proof),'sha256':sha(proof)},'preparedBaseline':baseline,'executionBaseline':execution_baseline,'conservativeExclusions':{'path':str(exclusion),'sha256':sha(exclusion),'entries':8,'doesNotClaimAdditionalHTTPAttempts':True},'priorContinuation':{'allocationId':old['id'],'provedSessions':19,'interruptedSession':20,'actualChargedSolver':151,'actualChargedGET':231,'excludedSolverDigests':155,'strictAdmissions':100,'failedSessionCapacityCredit':0,'stoppedSummaryPath':str(previous/'stopped-prefix-validation.json'),'stoppedSummarySha256':sha(previous/'stopped-prefix-validation.json')},'candidateAllowance':2660,'attemptAllowance':3992,'chunks':chunks,'phases':{'suffix':phase},'originalPhase':original_phase,'outputRoot':str(output),'outputOwnershipManifest':str(supervisor/'ownership/durable-series.json'),'producerPins':old['producerPins'],'resources':{**old['resources'],'expectedRetainedBytes':5*1024**3,'retainedBudgetBytes':remaining_retained,'priorStoppedRetainedBytes':retained_prior,'combinedOriginalAndContinuationRetainedCeilingBytes':12*1024**3,'peakIncludingRetainedBudgetBytes':remaining_retained+64*1024**2},'reviewedHelpers':old['reviewedHelpers'],'retries':0,'automaticRedirects':0,'browser':0,'images':0,'sourceWrites':0,'trafficExecuted':False,'sourceTrafficGranted':False,'capacityCredit':0,'acceptance':False,'noAutomaticContinuation':True,'finalGlobalUnionRequiredBeforeCumulativeCredit':True,'remaining':old['remaining']}
put(BASE/'series-plan.json',series)
example={'schemaVersion':'f70-optional-axis-parent-release.v1','released':False,'allocationId':identifier,'grantId':phase['grantId'],'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':series['candidateManifestSha256'],'codePins':code_pins,'qualificationDate':'2026-11-07','indexPins':index_pins,'strictProof':series['preparedStrictProof'],'baseline':baseline,'executionBaseline':execution_baseline,'conservativeExclusionsSha256':sha(exclusion),'acknowledgedOriginalStoppedDiagnostic':True,'originalPhase':original_phase,'preserveOriginalPhaseDeadline':True,'concurrentDisjointLane':{'permitted':True,'catalogueRangeKey':'G42','modelCodes':['2PMA','2PMB','2PPA','2PPB','2PMC','2PBC']},'finalGlobalUnionRequiredBeforeCumulativeCredit':True}
put(BASE/'parent-release.example.json',example)
print(json.dumps({'prepared':True,'sessions':333,'candidates':2660,'maximumGets':3992,'seriesPlanSha256':sha(BASE/'series-plan.json'),'originalDeadlineAt':deadline.isoformat(),'retainedCeilingBytes':remaining_retained,'sourceTraffic':0}))
