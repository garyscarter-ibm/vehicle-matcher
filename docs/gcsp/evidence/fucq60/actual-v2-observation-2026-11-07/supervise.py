"""Guarded four-GET F60 supervisor. No binary assets or runtime publication."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib
ROOT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-036')
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f60/observation-capability')
def read(p):return json.loads(p.read_text())
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1048576),b''):h.update(block)
    return h.hexdigest()
def run():
    assert sys.argv[1:] == ['live'], 'explicit live phase required'
    allocation=read(pathlib.Path(__file__).resolve().parent/'execution-plan.json')
    assert os.environ.get('F60_OBSERVATION_SOURCE_GRANT')==allocation['id'], 'explicit-root-traffic-grant-required'
    base=pathlib.Path(__file__).resolve().parent
    assert not (base/'execution-once.json').exists() and not (base/'observer-checkpoint.json').exists(), 'spent allocation preserved'
    assert all(sha(ROOT/p)==h for p,h in allocation['codePins'].items()), 'code pins changed'
    phase_name='live';phase=OUT/phase_name;phase.mkdir(parents=True,exist_ok=False)
    tests=[]
    command=['/opt/homebrew/Cellar/node/26.7.0/bin/node','--max-old-space-size=256',str(base/'run-live.mjs')]
    scratch_mib=64;seconds=120
    paths=['scripts/gcsp/bmw-public-registration.mjs','scripts/gcsp/public-bmw-source.mjs','scripts/gcsp/collection-session.mjs','scripts/gcsp/enrichment-observation.mjs','docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/run-live.mjs','docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/supervise-offline.py','docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/supervise.py','docs/gcsp/evidence/fucq60/actual-v2-observation-2026-11-07/observation-plan.json',*tests]
    contract={'codePins':{p:sha(ROOT/p) for p in paths if (ROOT/p).exists()},'inputPins':{str(p.relative_to(ROOT)):sha(p) for area in ['server/data/gcsp/vehicle-evidence/fleet-source.v1','server/data/gcsp/vehicle-evidence/registered-sources'] for p in (ROOT/area).rglob('*') if p.is_file()},'selectedChecks':[command],'excluded':['full suite: bounded operation registration only','Only the parent-released four public GETs; no additional source traffic','Render and ordinary corpus mutation','unchanged311/new9 replays','binary image or technical publication'],'dependencyDirectory':'/Users/usget/Claude/vehicle-matcher/.claude/worktrees/DEV-2026-11-04-069/server/node_modules'}
    plan={'runId':'f60-observation-'+phase_name,'resources':{'workers':1,'hostRamMiB':512,'childRamMiB':448,'scratchMiB':scratch_mib,'seconds':seconds}}
    spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
    R.atomic_json(phase/'selection.json',{'identity':contract['codePins'],'inputs':contract['inputPins'],'selectedChecks':contract['selectedChecks'],'excluded':contract['excluded'],'resources':plan['resources']})
    R.atomic_json(phase/'retained-output-ownership.json',{'createdFor':plan['runId'],'immutableSourceFiles':contract['inputPins'],'sourceFilesPreserved':True,'expectedRetainedOutputMiB':1,'largeOutput':False,'retainedReceipts':[str(phase/p) for p in ['receipt.json','result.json','cleanup.json','selection.json']],'partialProgress':str(base/'observer-checkpoint.json'),'retainedPrimary':str(base/'observer-checkpoint.json'),'retainedPrimaryOutsideScratch':True})
    policy=R.Policy({'chunk_scratch_mib':scratch_mib,'chunk_ram_mib':512,'chunk_seconds':seconds,'log_mib':1});scratch=R.Scratch(phase,ROOT,policy,expected=scratch_mib*R.MIB,checkpoint=base/'observer-checkpoint.json')
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
            'dependencyLinkAbsent':not os.path.lexists(link),'removedScratchBytes':scratch.record['peak'],'retainedOutputOwnership':str(phase/'retained-output-ownership.json'),'compatibilityException':None,'retainedPrimary':str(base/'observer-checkpoint.json'),'primaryExists':(base/'observer-checkpoint.json').exists(),'retainedWriterMetadata':[p.name for pattern in ['observer-checkpoint.json.writer-*.json','observer-checkpoint.json.writing-*'] for p in base.glob(pattern)]})
        finished=True
    atexit.register(finish)
    try:
        with R.handled_termination():
            host.acquire(scratch.token,scratch_mib*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True
            scratch.__enter__();entered=True
            assert not os.path.lexists(link),'existing dependency path preserved';link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino)
            R.atomic_json(phase/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
            env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','F60_OBSERVATION_SOURCE_GRANT':allocation['id']}
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
    assert result['rc']==0 and result['issue'] is None,'selected check failed'
if __name__=='__main__':run()
