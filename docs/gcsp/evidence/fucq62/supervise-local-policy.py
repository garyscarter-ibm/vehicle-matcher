"""Bounded default local-corpus policy regression; no ordinary data or external service writes."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib
ROOT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-036')
BASE=ROOT/'docs/gcsp/evidence/fucq62'
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f63/local-policy')
def read(p):return json.loads(p.read_text())
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1048576),b''):h.update(block)
    return h.hexdigest()
def run():
    phase_name=sys.argv[1];phase=OUT/phase_name;phase.mkdir(parents=True,exist_ok=False)
    assert phase_name in ['policy-red', 'policy-green', 'policy-boundary']
    tests=['server/test/gcsp-local-corpus-policy.test.js']
    if phase_name=='policy-boundary':tests+=['server/test/gcsp-synthetic-vin-api.test.js','server/test/gcsp-retained-image.test.js']
    command=['/opt/homebrew/Cellar/node/26.7.0/bin/node','--max-old-space-size=256','--test','--test-concurrency=1',*tests]
    scratch_mib=64;seconds=120
    paths=['docs/gcsp/evidence/fucq62/supervise-local-policy.py','server/test/gcsp-local-corpus-policy.test.js','server/test/gcsp-synthetic-vin-api.test.js','server/test/gcsp-retained-image.test.js','server/test/helpers/vin-corpus-fixture.js','server/index.js','server/gcsp/policy/index.js','server/gcsp/policy/file-provider.js','server/gcsp/vehicle-evidence/local-vehicle-lookup.js','server/gcsp/vehicle-evidence/corpus-publisher.js','server/gcsp/vehicle-evidence/synthetic-registry.js']
    contract={'codePins':{p:sha(ROOT/p) for p in paths if (ROOT/p).exists()},'inputPins':{str(p.relative_to(ROOT)):sha(p) for area in ['server/data/gcsp/vehicle-evidence/fleet-source.v1','server/data/gcsp/vehicle-evidence/registered-sources'] for p in (ROOT/area).rglob('*') if p.is_file()},'selectedChecks':[command],'excluded':['full suite: static default selection only','real PostgreSQL: external transport is blocked','BMW/source traffic','Render mutation','unchanged corpus replay/publication'],'dependencyDirectory':'/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules'}
    plan={'runId':'f63-local-policy-'+phase_name,'resources':{'workers':1,'hostRamMiB':512,'childRamMiB':448,'scratchMiB':scratch_mib,'seconds':seconds}}
    spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
    R.atomic_json(phase/'selection.json',{'identity':contract['codePins'],'inputs':contract['inputPins'],'selectedChecks':contract['selectedChecks'],'excluded':contract['excluded'],'resources':plan['resources']})
    R.atomic_json(phase/'retained-output-ownership.json',{'createdFor':plan['runId'],'immutableSourceFiles':contract['inputPins'],'sourceFilesPreserved':True,'expectedRetainedOutputMiB':1,'largeOutput':False,'retainedReceipts':[str(phase/p) for p in ['receipt.json','result.json','cleanup.json','selection.json']],'partialProgress':str(phase/'receipt.json.progress.json')})
    policy=R.Policy({'chunk_scratch_mib':scratch_mib,'chunk_ram_mib':512,'chunk_seconds':seconds,'log_mib':1});scratch=R.Scratch(phase,ROOT,policy,expected=scratch_mib*R.MIB,checkpoint=phase/'receipt.json.progress.json')
    host=R.HostBudget(policy);link=ROOT/'server/node_modules';vendor=pathlib.Path(contract['dependencyDirectory']);entered=reserved=finished=False;link_identity=None
    def finish():
        nonlocal entered,reserved,finished,link_identity
        if finished:return
        assert all(R.group_has_live_members(pid) is False for pid in scratch.record['groups']),'owned group remains'
        if link_identity is not None:
            st=link.lstat();assert link.is_symlink() and (st.st_dev,st.st_ino)==link_identity and link.resolve()==vendor
            link.unlink();link_identity=None
        if entered:scratch.__exit__(None,None,None);entered=False
        if reserved:host.release(scratch.token);reserved=False
        R.atomic_json(phase/'cleanup.json',{'scratch':str(scratch.root),'manifest':str(scratch.manifest),'scratchAbsent':not os.path.lexists(scratch.root),
            'groupsAbsent':all(R.group_has_live_members(pid) is False for pid in scratch.record['groups']),'reservationAbsent':scratch.token not in (R.read_json(host.path,{}) or {}),
            'dependencyLinkAbsent':not os.path.lexists(link),'removedScratchBytes':scratch.record['peak'],'retainedOutputOwnership':str(phase/'retained-output-ownership.json'),'compatibilityException':None})
        finished=True
    atexit.register(finish)
    try:
        with R.handled_termination():
            host.acquire(scratch.token,scratch_mib*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True
            scratch.__enter__();entered=True
            assert not os.path.lexists(link),'existing dependency path preserved';link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino)
            R.atomic_json(phase/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
            env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','HOME':os.environ['HOME']}
            commands=[command]
            results=[]
            for index,item in enumerate(commands):
                result=R.run_process(item,ROOT,env,phase/('command-'+str(index)+'.log'),scratch,policy,scratch_mib*R.MIB,448*R.MIB,seconds,host)
                results.append(result);R.atomic_json(phase/'chunk-results.json',results)
                if result['rc']!=0 or result['issue'] is not None:break
            R.atomic_json(phase/'result.json',result)
            for name,expected in contract['codePins'].items():assert sha(ROOT/name)==expected,name
            for name,expected in contract['inputPins'].items():assert sha(ROOT/name)==expected,name
            print(json.dumps(result))
    finally:
        try:finish()
        finally:atexit.unregister(finish)
    if not phase_name.endswith('red'):assert result['rc']==0 and result['issue'] is None,'selected check failed'
if __name__=='__main__':run()
