"""Prepare four finite inventory inputs and inspect prior local request registrations, offline only."""
import sys
sys.dont_write_bytecode = True
import datetime, hashlib, json, pathlib, subprocess
BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parents[4]
PROJECT = pathlib.Path('/Users/usget/Claude/vehicle-matcher')
CONTROL = PROJECT / '.claude/f58-63-overnight-20261106/f58'
read = lambda p: json.loads(pathlib.Path(p).read_text())
sha = lambda p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
digest = lambda b: hashlib.sha256(b).hexdigest()
put = lambda p, j: pathlib.Path(p).write_text(json.dumps(j, indent=2) + '\n')
leads = read(BASE / 'leads.json')
assert len(leads['leads']) == 4 and [e['id'] for e in leads['leads']] == ['u06','g20','g22','g23']
for entry in leads['leads']:
    entry['exactLiteralUrlSha256'] = digest(entry['exactLiteralUrl'].encode())
    assert entry['exactLiteralUrl'].startswith('https://configure.bmw.co.uk/en_GB/configure/' + entry['parsedRequestTokens']['catalogueRangeKey'] + '/' + entry['parsedRequestTokens']['pageModelCode'] + '/')
    assert not any(c.isspace() for c in entry['exactLiteralUrl']) and '?' not in entry['exactLiteralUrl']
    if entry['id'] == 'g20':
        entry['samePageSupportingFetch'] = {'requestId':'extract_4b526263b06034970d53f2f5be23cc55','acquiredAt':'2026-09-21T00:00:00Z','role':'Same page and route tokens corroborated; fetched full URL is line-wrapped, so the exact literal URL and offset above use the search excerpt instead.'}
put(BASE / 'leads.json', leads)
template = read(ROOT / 'docs/gcsp/evidence/fucq59/scheme-line-breadth-preparation-2026-11-07/g21/qualification-plan.json')
contexts = []
for entry in leads['leads']:
    plan = json.loads(json.dumps(template))
    plan['planId'] = 'f58-four-model-inventory-20261107-once-' + entry['id']
    plan['inventoryRegistration'].update(entry['parsedRequestTokens'])
    # These are explicit query inputs, not observed catalogue validity or vehicle dates.
    plan['inventoryRegistration'].update(treeEffectDate='2026-11-07', treeOrderDate='2026-11-07')
    folder = BASE / entry['id']; folder.mkdir(exist_ok=True)
    put(folder / 'qualification-plan.json', plan)
    contexts.append({'id':entry['id'],'originalRow':entry['originalRow'],'target':entry['target'],'qualificationPlanPath':str((folder/'qualification-plan.json').relative_to(ROOT)),'qualificationPlanSha256':sha(folder/'qualification-plan.json'),'registration':plan['inventoryRegistration'],'literalLeadSha256':entry['exactLiteralUrlSha256'],'allocationId':plan['planId']})
script = "import{readFileSync}from'node:fs';import{bmwInventoryRequestUrls}from'./scripts/gcsp/bmw-public-registration.mjs';console.log(JSON.stringify(JSON.parse(readFileSync(0,'utf8')).map(r=>({id:r.id,urls:bmwInventoryRequestUrls(r.registration)}))));"
runtime = pathlib.Path('/opt/homebrew/bin/node').resolve()
urls = json.loads(subprocess.run([str(runtime),'--input-type=module','-e',script], input=json.dumps(contexts),cwd=ROOT,text=True,capture_output=True,check=True,timeout=10).stdout)
for context, request in zip(contexts, urls):
    assert request['id'] == context['id']; context['requests'] = request['urls']
    context['requestIdentitySha256'] = {k:digest(('GET '+v).encode()) for k,v in request['urls'].items()}
    context['settingsRequest'] = {'method':'GET','url':'unknown until this page identifies exactly one safe settings path','policy':'existing publicBmwInventoryOperations path grammar and configure.bmw.co.uk origin only; no guessed filename; one request counted; settings may be a shared bootstrap URL already observed in older contexts'}
planned = {url:(c['id'],kind) for c in contexts for kind,url in c['requests'].items()}
page_pairs = {(c['registration']['catalogueRangeKey'],c['registration']['pageModelCode']):c['id'] for c in contexts}
inventory = []
roots = [PROJECT/'docs/gcsp/evidence'] + sorted((PROJECT/'.claude/worktrees').glob('*/docs/gcsp/evidence')) + [CONTROL]
seen = set(); matches = []; registrations = []; parse_failures = []; total_bytes = 0
def inspect(value, source, pointer=''):
    if isinstance(value,dict):
        if value.get('catalogueRangeKey') and (value.get('pageModelCode') or value.get('modelCode')):
            pair=(value['catalogueRangeKey'],value.get('pageModelCode') or value.get('modelCode'))
            registrations.append({'source':source,'pointer':pointer,'catalogueRangeKey':pair[0],'pageModelCode':pair[1]})
            if pair in page_pairs:matches.append({'kind':'registered-range-model-pair','context':page_pairs[pair],'source':source,'pointer':pointer})
        for key,item in value.items():inspect(item,source,pointer+'/'+str(key).replace('~','~0').replace('/','~1'))
    elif isinstance(value,list):
        for index,item in enumerate(value):inspect(item,source,pointer+'/'+str(index))
    elif isinstance(value,str) and value in planned:
        context,kind=planned[value];matches.append({'kind':'exact-'+kind+'-URL','context':context,'source':source,'pointer':pointer})
for root in roots:
    if not root.is_dir():continue
    for path in sorted(root.rglob('*.json')):
        if BASE == path.parent or BASE in path.parents:continue
        if not any(token in path.name for token in ['plan','registration','release','execution-once','reservation']):continue
        resolved=str(path.resolve())
        if resolved in seen:continue
        seen.add(resolved); b=path.read_bytes(); total_bytes+=len(b)
        inventory.append({'path':str(path),'bytes':len(b),'sha256':digest(b)})
        try:inspect(json.loads(b),str(path))
        except (json.JSONDecodeError,UnicodeDecodeError) as error:parse_failures.append({'path':str(path),'error':type(error).__name__})
assert not parse_failures, parse_failures
assert not matches, matches
parent_audit = CONTROL / 'global-union10351-parent-audit.json'
parent = read(parent_audit); spent_path=pathlib.Path(parent['spentPin']['path']); spent=read(spent_path)
assert sha(spent_path)==parent['spentPin']['sha256'] and len(spent['entries'])==parent['spent']==13747
exclusions={'schemaVersion':'f58-four-model-inventory-prior-exclusions.v1','auditedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'Exact canonical page/tree URL strings and registered range/page-model pairs in named local evidence plan/registration/release/once/reservation JSON files. Solver index is separately pinned; its digests do not prove absence of page/tree requests. No source replay.','roots':[str(p) for p in roots],'fileCount':len(inventory),'readBytes':total_bytes,'files':inventory,'registrationCount':len(registrations),'targetMatches':matches,'parseFailures':parse_failures,'spentIndex':{'path':str(spent_path),'bytes':spent_path.stat().st_size,'sha256':sha(spent_path),'entries':len(spent['entries']),'role':'global prior candidate/solver index, including labelled conservative exclusions; no new candidate or solver request in this proposal'},'parentAudit':{'path':str(parent_audit),'sha256':sha(parent_audit)},'boundary':'Snapshot of the named local registration metadata, not a claim of all historical public requests. Parent must reconcile any outside/parallel allocation before release. Settings URL is undiscovered and cannot be declared fresh; four bootstrap settings calls must be explicitly included in release. F44, I20 and consumed selector allocations remain excluded.'}
put(BASE/'prior-exclusions.json',exclusions)
code_paths=['scripts/gcsp/bmw-public-registration.mjs','scripts/gcsp/public-bmw-source.mjs','scripts/gcsp/bmw-source-qualification.mjs','scripts/gcsp/collection-session.mjs','scripts/gcsp/configuration-key.mjs','scripts/gcsp/settings-shape-report.mjs','server/gcsp/repository/core.js','server/gcsp/repository/schema.js','docs/gcsp/evidence/fucq59/g42-safe-contract-diagnostic-2026-11-07/diagnostic.mjs','docs/gcsp/evidence/fucq59/scheme-line-breadth15-2026-11-07/contract-runner.mjs','_tools/test_resources.py']
output='/Users/usget/Library/CloudStorage/OneDrive-IBM/Claude/vehicle-matcher/.agent-output/f58-four-model-inventory-20261107-once'
supervisor=str(CONTROL/'four-model-inventory')
assert not pathlib.Path(output).exists() and not pathlib.Path(supervisor).exists()
proposal={'schemaVersion':'f58-four-model-inventory-context-proposal.v1','id':'f58-four-model-inventory-20261107-once','status':'prepared-unreleased-input-plan; execution harness not yet frozen; no live command','qualificationDate':'2026-11-07','sourceBasis':{'path':str((BASE/'leads.json').relative_to(ROOT)),'sha256':sha(BASE/'leads.json'),'role':'exact dated official-page literal routes only; no full vehicle facts'},'priorExclusions':{'path':str((BASE/'prior-exclusions.json').relative_to(ROOT)),'sha256':sha(BASE/'prior-exclusions.json')},'contexts':contexts,'source':'existing selected bmw-uk-public public BMW adapter with createContractDiagnostic; preserve production grammar refusal and collect only safe direct model/alias/line relationship facts','codePins':{p:sha(ROOT/p) for p in code_paths},'runtime':{'path':str(runtime),'sha256':sha(runtime)},'sourceBudget':{'GET':12,'perContextSequence':['page','freshly-discovered-settings','discover'],'perContextGET':3,'workers':1,'responseBytes':1048576,'decodedBytesPerContext':4194304,'decodedBytesAggregate':16777216,'operationTimeoutMs':10000,'sourceDeadlineMs':90000,'childSeconds':105,'supervisorSecondsPerChunk':120,'seriesSeconds':600,'maxAttempts':1,'retryDelayMs':0,'redirects':0,'settingsSharedBootstrapGET':4,'options':0,'solver':0,'images':0,'browser':0,'sourceWrites':0},'resourcePlan':{'hostRAMBytes':536870912,'childRAMBytes':469762048,'scratchBytesPerChunk':67108864,'retainedBudgetBytes':8388608,'expectedRetainedBytes':2097152,'expectedScratchBytes':1048576,'expectedRAMBytes':134217728,'expectedSeconds':60,'outputRoot':output,'supervisorRoot':supervisor,'chunks':['u06','g20','g22','g23'],'ownership':'Before allocation create per-chunk absolute owned scratch and outside manifest, register parent supervisor finalizer and short-held shared host reservation; propagate TMPDIR/TMP/TEMP. First output write is retained primary in OneDrive. Do not touch either worktree dependency link.','checkpoint':'Consumed once marker per exact context and phase; retain actual request-start/header counts, safe primary, receipt and sealed projection on every outcome before scratch removal. Stop after first context for parent actual-size/shape/proof review before releasing the remaining nine GETs. Never replay a consumed failed allocation.','teardown':'Stop/join all owned children; independent group/scratch/reservation and immutable pin checks. Remove disposable scratch before next chunk; retain bounded summary and useful failure logs; report final actual retained bytes, removed allocation, compatibility exceptions and named leftovers. No source/compiler/browser-profile exception planned.'},'phases':{'first':{'contexts':['u06'],'GET':3,'requires':'exact parent release matching final executable packet hashes'},'remaining':{'contexts':['g20','g22','g23'],'GET':9,'requires':'separate exact parent release and hash of actual reviewed first-context proof'}},'claimBoundary':{'preparer':'Charlie Dog /root/charlie_dog; requested Sol/high, effective runtime not independently confirmed; no descendants','worktree':str(ROOT),'branch':'dev/DEV-2026-11-04-035','existingWorkItem':'DEV-2026-11-04-035 / FUCQ-62 remains claimed by usget; preparation serves root-authorised FUCQ-58 coverage work; no claim/status/ownership changes','launcherResponsibility':'Root retains all existing claims, source release and resource lifecycle responsibility'},'releasePreconditions':['freeze final runner/supervisor/export/auditor/metadata pins and review scoped offline lifecycle evidence; existing protocol checks reused only when identity matches','parent reviews exact canonical page/tree requests, derived page normalization from preserved literal route and explicit 7November query dates; these dates are not observed catalogue validity','parent reconciles fresh named exclusion snapshot against any outside or parallel allocations and explicitly approves counted shared settings bootstrap reads','parent writes exact release and environment grant; absent grant refuses before allocation/network; exclusive output/consumed markers prevent replay'],'expectedFacts':'Observe actual seed presence, all full model/AG/raw range/steering/dates, complete aliases and line/default/included relationships from the returned tree; catalogue route prefixes/labels never establish those facts. Current inventory cannot establish October2024 eligibility or physical profile/year/plant/era/fiveWMI semantics.','excluded':['failed selector allocation missing20-selector-20261107-once','F44 prior empty/HTTP400 contexts','I20 diagnostic-alias-limit allocation','all existing source model/AG/alias assumptions','generation successors including G50 replacing G20','combustion/electric/body substitution','options/solver/candidate/image collection','real VIN/plate/serial sampling or retained raw HTML/settings/headers','production source grammar repair or dependency-link mutation'],'sourceGrant':False,'additionalSourceRequests':0,'admissions':0,'capacityCredit':0,'qualifiedModelFacts':0,'qualifiedPhysicalFacts':0,'qualifiedSchemeJoins':0,'acceptance':False}
put(BASE/'inventory-proposal.json',proposal)
print(json.dumps({'status':'prepared-unreleased','contexts':len(contexts),'GETCeiling':12,'priorFilesChecked':len(inventory),'priorTargetMatches':len(matches),'sourceTraffic':False,'leadsSha256':sha(BASE/'leads.json'),'proposalSha256':sha(BASE/'inventory-proposal.json'),'priorExclusionsSha256':sha(BASE/'prior-exclusions.json')}))
