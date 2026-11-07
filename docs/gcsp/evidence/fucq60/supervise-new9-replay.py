"""One bounded existing-path offline replay of nine exact retained source selections."""
import sys
sys.dont_write_bytecode=True
import atexit,hashlib,importlib.util,json,os,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[4]
BASE=ROOT/'docs/gcsp/evidence/fucq60'
OUT=pathlib.Path('/Users/usget/Claude/vehicle-matcher/.claude/f58-63-overnight-20261106/f60/new9-replay')
def read(p):return json.loads(p.read_text())
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(1048576),b''):h.update(block)
    return h.hexdigest()
def run():
    contract_path=BASE/'new9-replay-execution-contract.json';contract=read(contract_path);plan=read(BASE/'new9-replay-plan.json')
    for name,expected in contract['codePins'].items():assert sha(ROOT/name)==expected,name
    for name,expected in contract['inputPins'].items():assert sha(ROOT/name)==expected,name
    assert sha(pathlib.Path(contract['nodePath']))==contract['nodeSha256']
    phase=OUT/'actual';phase.mkdir(parents=True,exist_ok=False)
    spec=importlib.util.spec_from_file_location('resources',ROOT/'_tools/test_resources.py');R=importlib.util.module_from_spec(spec);spec.loader.exec_module(R)
    R.atomic_json(phase/'selection.json',{'contractSha256':sha(contract_path),'identity':contract['codePins'],'inputs':contract['inputPins'],'selectedChecks':contract['selectedChecks'],'excluded':contract['excluded'],'resources':plan['resources']})
    R.atomic_json(phase/'retained-output-ownership.json',{'createdFor':plan['runId'],'immutableSourceFiles':contract['inputPins'],'sourceFilesPreserved':True,'expectedRetainedOutputMiB':1,'largeOutput':False,'retainedReceipts':[str(phase/p) for p in ['receipt.json','result.json','cleanup.json','selection.json']],'partialProgress':str(phase/'receipt.json.progress.json')})
    policy=R.Policy({'chunk_scratch_mib':64,'chunk_ram_mib':512,'chunk_seconds':90,'log_mib':1});scratch=R.Scratch(phase,ROOT,policy,expected=64*R.MIB,checkpoint=phase/'receipt.json.progress.json')
    scratch.root=pathlib.Path('/tmp/vehicle-matcher-f58-63-20261106/f60-new9-replay');scratch.record['root']=str(scratch.root);R.atomic_json(scratch.manifest,scratch.record)
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
            host.acquire(scratch.token,64*R.MIB,512*R.MIB,ROOT,root=scratch.root);reserved=True
            scratch.__enter__();entered=True
            assert not os.path.lexists(link),'existing dependency path preserved';link.symlink_to(vendor,target_is_directory=True);st=link.lstat();link_identity=(st.st_dev,st.st_ino)
            R.atomic_json(phase/'dependency-ownership.json',{'path':str(link),'target':str(vendor),'device':st.st_dev,'inode':st.st_ino})
            env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC'}
            command=[contract['nodePath'],'--max-old-space-size=256','docs/gcsp/evidence/fucq60/new9-replay-proof.mjs','--receipt',str(phase/'receipt.json'),'--proof-plan',str(BASE/'new9-replay-plan.json')]
            result=R.run_process(command,ROOT,env,phase/'command.log',scratch,policy,64*R.MIB,448*R.MIB,90,host)
            R.atomic_json(phase/'result.json',result)
            for name,expected in contract['codePins'].items():assert sha(ROOT/name)==expected,name
            for name,expected in contract['inputPins'].items():assert sha(ROOT/name)==expected,name
            print(json.dumps(result))
    finally:
        try:finish()
        finally:atexit.unregister(finish)
    assert result['rc']==0 and result['issue'] is None,'selected check failed'
if __name__=='__main__':run()
