"""Derive finite options proposals from actual full models and literal explicit line relationships."""
import sys
sys.dont_write_bytecode=True
import pathlib,json,hashlib,re
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4]
read=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
out=BASE/'qualification-pool';out.mkdir(exist_ok=True);contexts=[];gaps=[];total_models=0
for name in ['g21','u11','u10','g26e']:
    directory=BASE/'actual'/name;doc=read(directory/'diagnostic.json');report=doc['report'];request=report['requestScope'];proof=read(directory/'live-validation.json')
    assert proof['checksPassed']==5 and proof['admitted']==proof['sourceCapacityCredit']==0
    nodes={}
    for node in report['modelNodes']:
        assert not node['issues'] and not node['invalidFields'] and not node['missingFields']
        code=node['facts']['modelCode'];entry=nodes.setdefault(code,{'facts':node['facts'],'pointers':[]})
        assert entry['facts']==node['facts'];entry['pointers'].append(node['pointer'])
    total_models+=len(nodes);relationships={r['path']:r for r in report['relationships']};options={code:[] for code in nodes}
    for row in report['relationships']:
        match=re.fullmatch(r'/([^/]+)/modelRanges/([^/]+)/lines/([^/]+)/option',row['path'])
        if not match or not row.get('value'):continue
        alias,catalogue,line=match.groups();assert catalogue==request['catalogueRangeKey'] and row['value']==line
        prefix=row['path'].removesuffix('/option');default={field:relationships[prefix+'/defaultModel/'+field]['value'] for field in ['modelCode','agModelCode']}
        for variant in report['relationships']:
            included=re.fullmatch(re.escape(prefix)+r'/includedTransmissionVariants/(\d+)/configuration/modelCode',variant['path'])
            if included and variant.get('value') in nodes:
                code=variant['value'];options[code].append({'lineKey':line,'defaultModel':default,'includedIndex':int(included.group(1)),'optionsQuery':{'kind':'trim','code':line},'basis':{'alias':alias,'lineOptionPointer':row['path'],'includedModelPointer':variant['path']}})
    for code,model in sorted(nodes.items()):
        choices=options[code]
        if not choices:
            gaps.append({'context':name,'modelCode':code,'facts':model['facts'],'basisPointers':model['pointers'],'reason':'No literal explicit line option connects this full model in retained relationships; BASIC_LINE/M_PERFORMANCE_LINE are not inferred trim codes.'});continue
        choices.sort(key=lambda c:(c['lineKey'],c['basis']['alias'],c['includedIndex']));choice=choices[0];f=model['facts']
        registration={'schemaVersion':'bmw-public-model-registration.v1','modelCode':code,'agModelCode':f['agModelCode'],'catalogueRangeKey':request['catalogueRangeKey'],'rawModelRange':f['modelRange'],'aliases':sorted({p.split('/')[1] for p in model['pointers']}),'market':request['market'],'locale':request['locale'],'steering':f['steering'],'catalogueDate':request['treeEffectDate'],'orderDate':f['orderDate'],'effectDate':f['effectDate']}
        line={k:v for k,v in choice.items() if k!='basis'}
        plan={'schemaVersion':'bmw-source-model-options-plan.v1','planId':name+'-'+code.lower()+'-options-20261107','qualificationDate':'2026-11-07','source':{'id':'bmw-uk-public','kind':'public-bmw-uk','version':'f59-model-options-qualification-20261107.v1'},'modelRegistration':registration,'lineRegistration':line,
          'limits':{'maxAttempts':1,'retryDelayMs':0,'concurrency':1,'imageRequests':0,'sourceAttempts':4,'sourceBytes':4194304,'responseBytes':1048576,'operationTimeoutMs':10000,'deadlineMs':90000,'checkpointBytes':4194304,'cacheEntries':8,'cacheRetentionMs':86400000,'requestBudgets':{'page':1,'settings':1,'discover':1,'options':1}}}
        target=out/(name+'-'+code.lower());target.mkdir(exist_ok=True);path=target/'qualification-plan.json';path.write_text(json.dumps(plan,indent=2)+'\n')
        contexts.append({'id':target.name,'inventoryContext':name,'modelCode':code,'derivative':f.get('derivative'),'qualificationPlanPath':str(path.relative_to(ROOT)),'qualificationPlanSha256':sha(path),'modelRegistration':registration,'lineRegistration':line,'actualBasis':{'diagnosticPath':str((directory/'diagnostic.json').relative_to(ROOT)),'diagnosticSha256':sha(directory/'diagnostic.json'),'strictProofSha256':sha(directory/'live-validation.json'),'modelPointers':model['pointers'],**choice['basis']},'allObservedExplicitLineChoices':choices,'sourceGrant':False,'admissions':0})
assert total_models==39
representatives=['g21-t3mk','u11-x1m0','u11-ix1i','u10-x2ms','u10-ix24','g26e-i4mf'];assert set(representatives)<={c['id'] for c in contexts}
pool={'schemaVersion':'scheme-breadth-actual-model-options-pool.v1','scope':'finite actual full-model/explicit-line qualification proposal; zero new source traffic','distinctObservedModels':total_models,'proposedContexts':len(contexts),'explicitLineGaps':gaps,'contexts':contexts,'suggestedFirstSix':representatives,'suggestedFirstSixGets':24,'entireProposedPoolGetCeiling':len(contexts)*4,'sourceGrant':False,'solver':0,'admissions':0,'capacityCredit':0,'acceptance':False,'remaining':['typed definitions and optionType unknown until actual options qualification','scheme eligibility/current-production joins remain open','I20 explicit dated empty-tree gap; no substitution','20 targets still lack exact retained page seed','all original distribution/acceptance obligations']}
(out/'pool.json').write_text(json.dumps(pool,indent=2)+'\n')
print(json.dumps({'observedDistinctModels':total_models,'proposedContexts':len(contexts),'explicitLineGaps':len(gaps),'firstSix':representatives,'firstSixGets':24,'entireProposedPoolGets':len(contexts)*4,'poolSha256':sha(out/'pool.json'),'sourceGrant':False}))
