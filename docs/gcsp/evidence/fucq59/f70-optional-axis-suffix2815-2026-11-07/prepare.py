"""Freeze only never-started templates102 onward; no HTTP or traffic grant."""
import sys
sys.dont_write_bytecode=True
import copy,datetime,hashlib,json,pathlib,subprocess
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(pathlib.Path(p).read_text());sha=lambda p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
def put(p,v):
 with p.open('x') as f:f.write(json.dumps(v,indent=2)+'\n')
assert not(BASE/'series-plan.json').exists()
old_base=ROOT/'docs/gcsp/evidence/fucq59/f70-optional-axis-suffix3623-2026-11-07';old=read(old_base/'series-plan.json');previous=pathlib.Path(old['outputRoot']);stopped=read(previous/'stopped-prefix-validation.json')
assert stopped['reconciledSessions']==100 and stopped['actualChargedTraffic']['solver']==802 and stopped['actualChargedTraffic']['gets']==1206
assert stopped['strictChecks']['tests']==stopped['strictChecks']['pass']==500 and stopped['strictChecks']['fail']==stopped['strictChecks']['skipped']==0
assert stopped['originalSeriesExit']==1 and stopped['originalsUnchanged'] and stopped['sourceTrafficDuringReconciliation']==0
assert all(stopped['cleanup'][k] for k in ['allChildrenJoined','allOwnedRootsAbsent','allOwnedTokensAbsent','allOwnedGroupsExplicitlyAbsent','dependencyLinkAbsent','seriesReservationAbsent'])
identifier='f70-optional-axis-suffix2815-20261107-once';output=previous.parent/identifier;supervisor=ROOT/'.claude/f58-63-overnight-20261106/f58/f70-optional-axis-suffix2815'
assert not output.exists() and not(BASE/'parent-release.json').exists()
chunks=copy.deepcopy(old['chunks'][101:]);assert len(chunks)==353
for number,entry in enumerate(chunks,1):
 entry.update(previousContinuationNumber=entry['number'],number=number,cohort=(number-1)//4+1)
 entry.update(outputDirectory=str(output/'sessions'/('session%03d'%number)),supervisorOutput=str(supervisor/('session%03d'%number)))
assert sum(e['candidates'] for e in chunks)==2815 and sum(e['maximumGets'] for e in chunks)==4227
index_pins={}
for name,filename in [('canonical','final-canonical-index.json'),('spent','final-spent-request-index.json')]:
 p=previous/'sessions/session100'/filename;v=read(p);index_pins[name]={'path':str(p),'sha256':sha(p),'digest':digest(v),'entries':len(v['entries'])}
proof=previous/'sessions/session100/live-validation.json';baseline={'admittedSource':4409,'canonical':4412,'spent':5900};execution_baseline={**baseline,'spent':5908}
exclusion=BASE/'conservative-exclusions.json';excluded=read(exclusion);assert len(excluded['entries'])==8 and [r['requestDigest'] for r in excluded['entries']]==old['chunks'][100]['requestDigests']
paths=[p for p in old['codePins'] if not p.startswith('docs/gcsp/evidence/fucq59/f70-optional-axis-suffix3623-2026-11-07/')]
paths += [str(p.relative_to(ROOT)) for p in BASE.iterdir() if p.suffix in ['.py','.mjs'] or p.name=='README.md']
code_pins={p:sha(ROOT/p) for p in sorted(set(paths))};source_pins=dict(old['sourcePins'])
for p in [old_base/'series-plan.json',previous/'suffix-once.json',previous/'suffix-receipt.json',previous/'suffix-cleanup.json',previous/'suffix-process-ownership.json',previous/'stopped-prefix-validation.json',previous/'milestone100-validation.json',proof,previous/'sessions/session100/collector-checkpoint.json',previous/'sessions/session100/receipt.json',previous/'sessions/session100/final-canonical-index.json',previous/'sessions/session100/final-spent-request-index.json',previous/'sessions/session101/collector-checkpoint.json',previous/'sessions/session101/receipt.json',previous/'sessions/session101/source-events.jsonl',previous/'stage-stderr/stage0403.log',exclusion]:
 source_pins[str(p.relative_to(ROOT)) if ROOT in p.parents else str(p)]=sha(p)
original_phase=old['originalPhase'];deadline=datetime.datetime.fromisoformat(original_phase['deadlineAt']);assert datetime.datetime.now(datetime.timezone.utc)<deadline
original_output=pathlib.Path(read(ROOT/'docs/gcsp/evidence/fucq59/f70-optional-axis-suffix5535-2026-11-07/series-plan.json')['outputRoot']);retained_prior=sum(p.stat().st_size for tree in [original_output,previous] for p in tree.rglob('*') if p.is_file());remaining_retained=12*1024**3-retained_prior;assert remaining_retained>5*1024**3
phase={'grantId':identifier+'-suffix2815','sessions':list(range(1,354)),'solverCeiling':2815,'getCeiling':4227,'maximumWallSeconds':21600,'separateExactParentReleaseRequired':True,'clockStartsAtConsumedMarkerAfterRelease':False,'originalAbsoluteDeadlineRequired':True}
series={'schemaVersion':'f70-optional-axis-suffix2815-series-plan.v1','id':identifier,'status':'prepared-unspent; explicit parent release and exact grant required','codeCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'codePins':code_pins,'sourcePins':source_pins,'candidateManifestPath':old['candidateManifestPath'],'candidateManifestSha256':old['candidateManifestSha256'],'preparedIndexPins':index_pins,'preparedStrictProof':{'path':str(proof),'sha256':sha(proof)},'preparedBaseline':baseline,'executionBaseline':execution_baseline,'conservativeExclusions':{'path':str(exclusion),'sha256':sha(exclusion),'entries':8,'doesNotClaimAdditionalHTTPAttempts':True},'priorContinuation':{'allocationId':old['id'],'provedSessions':100,'interruptedSession':101,'actualChargedSolver':802,'actualChargedGET':1206,'excludedSolverDigests':808,'strictAdmissions':592,'failedSessionCapacityCredit':0,'stoppedSummaryPath':str(previous/'stopped-prefix-validation.json'),'stoppedSummarySha256':sha(previous/'stopped-prefix-validation.json')},'candidateAllowance':2815,'attemptAllowance':4227,'chunks':chunks,'phases':{'suffix':phase},'originalPhase':original_phase,'outputRoot':str(output),'outputOwnershipManifest':str(supervisor/'ownership/durable-series.json'),'producerPins':old['producerPins'],'resources':{**old['resources'],'expectedRetainedBytes':5*1024**3,'retainedBudgetBytes':remaining_retained,'priorStoppedRetainedBytes':retained_prior,'combinedOriginalAndContinuationRetainedCeilingBytes':12*1024**3,'peakIncludingRetainedBudgetBytes':remaining_retained+64*1024**2},'reviewedHelpers':old['reviewedHelpers'],'retries':0,'automaticRedirects':0,'browser':0,'images':0,'sourceWrites':0,'trafficExecuted':False,'sourceTrafficGranted':False,'capacityCredit':0,'acceptance':False,'noAutomaticContinuation':True,'finalGlobalUnionRequiredBeforeCumulativeCredit':True,'remaining':old['remaining']}
put(BASE/'series-plan.json',series)
example={'schemaVersion':'f70-optional-axis-parent-release.v1','released':False,'allocationId':identifier,'grantId':phase['grantId'],'seriesPlanSha256':sha(BASE/'series-plan.json'),'candidateManifestSha256':series['candidateManifestSha256'],'codePins':code_pins,'qualificationDate':'2026-11-07','indexPins':index_pins,'strictProof':series['preparedStrictProof'],'baseline':baseline,'executionBaseline':execution_baseline,'conservativeExclusionsSha256':sha(exclusion),'acknowledgedOriginalStoppedDiagnostic':True,'originalPhase':original_phase,'preserveOriginalPhaseDeadline':True,'concurrentDisjointLane':{'permitted':True,'catalogueRangeKey':'G42','modelCodes':['2PMA','2PMB','2PPA','2PPB','2PMC','2PBC']},'finalGlobalUnionRequiredBeforeCumulativeCredit':True}
put(BASE/'parent-release.example.json',example)
print(json.dumps({'prepared':True,'sessions':353,'candidates':2815,'maximumGets':4227,'seriesPlanSha256':sha(BASE/'series-plan.json'),'originalDeadlineAt':deadline.isoformat(),'retainedCeilingBytes':remaining_retained,'sourceTraffic':0}))
