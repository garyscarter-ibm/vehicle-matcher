"""Offline exact request plan from observed successful trim and package axes."""
import sys
sys.dont_write_bytecode=True
import base64,collections,hashlib,json,pathlib
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
old=ROOT/'docs/gcsp/evidence/fucq59/f70-typed-axis1024-series-2026-11-07'
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
digest=lambda v:hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def write(p,v):
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,indent=2)+'\n')
prior=read(old/'candidate-manifest.json');actual=read(old/'actual-series.json')
assert sha(old/'actual-series.json')=='137d2eb6029058be379e8a8397961ee72c795c0e3a13b61c1d0b2f849d916c2d'
provenance={r['candidateId']:r for r in prior['candidateProvenance']};outcomes=collections.defaultdict(collections.Counter);admitted={}
for chunk in actual['chunks']:
 d=pathlib.Path(chunk['directory']);assert sha(d/'collector-checkpoint.json')==chunk['primarySha256'] and sha(d/'live-validation.json')==chunk['proofSha256']
 state=read(d/'collector-checkpoint.json')['content'];accepted={r['sourceEvidence']['solver']:r for r in state['accepted']};du={r['candidateId'] for r in state['duplicates']}
 for capture in state['sourceCaptures']:
  p=provenance[capture['candidateId']];axis=','.join(p['addedTypedCodes']);row=accepted.get(capture['solver']['sha256'])
  outcomes[axis]['accepted' if row else 'duplicates']+=1
  if row:admitted[p['actualCoreConfigurationId'],axis]={'configurationId':row['configurationId'],'codes':row['canonicalIdentity']['factoryOptionCodes'],'solverSha256':capture['solver']['sha256'],'primaryPath':str(d/'collector-checkpoint.json'),'primarySha256':chunk['primarySha256']}
 for rejection in state['rejected']:outcomes[','.join(provenance[rejection['candidateId']]['addedTypedCodes'])]['rejected']+=1
assert sum(v['accepted'] for v in outcomes.values())==390
last=pathlib.Path(actual['chunks'][-1]['directory']);spent=read(last/'final-spent-request-index.json');known=read(last/'final-canonical-index.json')
assert len(spent['entries'])==1582 and len(known['entries'])==872
spent_ids={e['requestDigest'] for e in spent['entries']};known_ids={e['configurationId'] for e in known['entries']}
cores=prior['actualCoreSelections'];assert len(cores)==130
definitions={d['code']:d for d in prior['actualTypedBasis']['typedOptionalDefinitions']}
assert definitions['S043U']['optionType']=='trim' and all(definitions[p]['optionType']=='package' for p in ['S07EV','S07EW'])
candidates=[];forecast_ids=set()
for core in cores:
 identity=core['configurationId'];baseline=set(base64.b64decode(identity).decode().split(':',1)[1].split(','));u=admitted[identity,'S043U']
 for package in ['S07EV','S07EW']:
  p=admitted[identity,package];request={'includedElements':sorted(set(core['candidate']['request']['includedElements'])|{'S043U',package}),'mandatoryElements':['S033B']}
  rd=digest({'modelRegistration':prior['modelRegistration'],'request':request});assert rd not in spent_ids
  # This is a deliberately unverified set-delta forecast, never a source envelope.
  proposed=(baseline|(set(u['codes'])-baseline)|(set(p['codes'])-baseline))-((baseline-set(u['codes']))|(baseline-set(p['codes'])))
  forecast=base64.b64encode(('1F7E:'+','.join(sorted(proposed))).encode()).decode();forecast_ids.add(forecast)
  candidates.append({'candidateId':'candidate-'+rd[:24],'request':request,'requestDigest':rd,'coreConfigurationId':identity,
   'addedTypedCodes':['S043U',package],'actualSingleAxisEvidence':{'trim':u,'package':p},
   'unverifiedSetDeltaForecast':{'configurationIdSha256':hashlib.sha256(forecast.encode()).hexdigest(),'alreadyCanonical':forecast in known_ids}})
assert len(candidates)==260 and len({c['requestDigest'] for c in candidates})==260
# Deterministic diverse cores discriminate cross-axis interaction across existing source paints/fabrics/rims.
selected=[];seen=set();remaining=list(cores)
for _ in range(4):
 best=max(remaining,key=lambda c:(len(set(c['candidate']['request']['includedElements'])-seen),c['candidate']['candidateId']))
 selected.append(best['configurationId']);seen.update(best['candidate']['request']['includedElements']);remaining.remove(best)
pilot=[c for identity in selected for c in candidates if c['coreConfigurationId']==identity]
pilot_ids={c['candidateId'] for c in pilot};continuation=[c for c in candidates if c['candidateId'] not in pilot_ids]
chunks=[pilot]+[continuation[i:i+32] for i in range(0,len(continuation),32)];assert len(pilot)==8 and len(chunks)==9
template=read(old/'templates/chunk01.json');entries=[]
for i,chunk in enumerate(chunks,1):
 t=json.loads(json.dumps(template));n=len(chunk)
 t.update(planId=f'f70-trim-package260-chunk{i:02}-20261107',seed=f'actual-trim-package260-chunk{i:02}',candidateCount=n,target=n,candidates=[{'candidateId':c['candidateId'],'request':c['request']} for c in chunk])
 t['candidateDefinitionBasis']['role']='Observed directly typed S043U trim and S07EV/S07EW packages; both single axes actually admitted for each core, combined constructibility unknown.'
 t['limits'].update(maxCandidates=n,sourceAttempts=n+4,requestBudgets={'page':1,'settings':1,'discover':1,'options':1,'solve':n})
 path=BASE/f'templates/chunk{i:02}.json';write(path,t)
 entries.append({'number':i,'phase':'pilot' if i==1 else 'continuation-only-after-pilot-review','templatePath':str(path.relative_to(ROOT)),'templateSha256':sha(path),'planDigest':digest(t),'candidates':n,'maximumGets':n+4,'requestDigests':[c['requestDigest'] for c in chunk]})
pins={str(p.relative_to(ROOT)):sha(p) for p in [ROOT/n for n in prior['sourceCodePins']]}
write(BASE/'candidate-manifest.json',{'schemaVersion':'f70-trim-package260-candidates.v1','modelRegistration':prior['modelRegistration'],
 'priorActualSeriesSha256':sha(old/'actual-series.json'),'observedAxisOutcomes':outcomes,'typedDefinitions':{k:definitions[k] for k in ['S043U','S07EV','S07EW']},
 'candidates':candidates,'pilotCoreConfigurationIds':selected,'chunks':entries,'sourceCodePins':pins,
 'forecast':{'method':'Unverified composition of actual independent single-axis set deltas; no source response or admission claimed','requestUpperBound':260,
  'setDeltaDistinctForecast':len(forecast_ids),'setDeltaForecastNovelAgainst872':len(forecast_ids-known_ids),'guaranteedNewAdmissions':0},
 'priorCanonicalIndex':{'path':str(last/'final-canonical-index.json'),'sha256':sha(last/'final-canonical-index.json'),'entries':872},
 'spentRequestIndex':{'path':str(last/'final-spent-request-index.json'),'sha256':sha(last/'final-spent-request-index.json'),'entries':1582}})
write(BASE/'plan.json',{'schemaVersion':'f70-trim-package260-offline-proposal.v1','status':'prepared data only; no source release or executable source launcher',
 'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'chunks':entries,'pilot':{'candidates':8,'maximumGets':12,'reviewBeforeContinuation':True,
  'continuationRule':'Continue each trim/package axis only if actual pilot retained strict proof shows novel, constructible resolved selections without canonical collapse; otherwise stop that axis and replan unspent candidates.'},
 'maximumCandidates':260,'maximumGets':296,'maximumDecodedBytes':9*8*1024**2,'responseBytes':1048576,'maximumWallSecondsFromFirstMarker':900,
 'continuationDeadline':'Any continuation uses the same original reservation time and remaining900-second budget; a pause never resets the deadline. Expired unspent suffix needs a newly reviewed finite plan, with spent prefix retained.',
 'resources':{'workers':1,'hostRamMiB':512,'childRamMiB':448,'scratchMiB':64,'sourceSecondsPerChunk':120,'retainedShardMiB':32,'retainedBudgetMiB':320,'forecastDurationSeconds':300},
 'outputRoot':'/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f70-trim-package260-20261107-once',
 'requiredExecutionBeforeTraffic':['parent review/release','pin exact execution wrapper and code in then-current integrated tree','outside output/scratch ownership manifests and supervisor finalizer','one-shot consumed marker before first request','exact canonical/spent baseline and non-overlap recheck','fresh four-GET complete context and typed options per chunk'],
 'requiredProofAfterEachChunk':['actual primary export and all safe source artifacts','five strict retained checks including actual event history and source binder','cumulative canonical/spent extension and exact input hashes','stop/join owned child groups; remove scratch/link/reservation; independent absence evidence before next freeze'],
 'excluded':['known rejectedS043T/S02TF axes','canonical-collapseS043Z/S02TE axes and redundantS043Z+S02TE+S07EW','S07EV+S07EW combination','210other definitions without direct types','52deferredS01H0 cores','G42','Charlie four-model pilot','active corpus/publication/runtime writes'],
 'capacityCreditBeforeSource':0,'acceptance':False,'remaining':'Even the260-request maximum cannot establish10000, model/profile/year/plant/five-WMI breadth or parent acceptance.'})
print(json.dumps({'candidateManifestSha256':sha(BASE/'candidate-manifest.json'),'planSha256':sha(BASE/'plan.json'),'candidates':260,'pilot':8,'remaining':252,'forecastNovel':len(forecast_ids-known_ids),'sourceRequests':0}))
