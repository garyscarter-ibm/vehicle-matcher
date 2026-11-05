from pathlib import Path
import hashlib,json,subprocess,sys,time,os,signal
rdir=Path('/Users/usget/Claude/vehicle-matcher/.claude/test-runs')
plan=json.loads((Path(__file__).with_name('final-validation-plan.json')).read_text())
phase=sys.argv[1]
if phase not in ('status-before','full','status-after','status-final'):raise SystemExit('Unknown phase')
if phase=='full' and plan['state']!='admitted':raise SystemExit('Full remains held; dispatcher admission and merged55+22 base required')
args=['/opt/homebrew/bin/python3','-B',plan['supervisor'],'--full' if phase=='full' else '--status','--command',plan['command']]
for relative,expected in plan['pins'].items():
 if hashlib.sha256((Path(plan['cwd'])/relative).read_bytes()).hexdigest()!=expected:raise SystemExit('Pinned source/environment input changed: '+relative)
actual=hashlib.sha256(Path(plan['supervisor']).read_bytes()).hexdigest()
if actual!=plan['supervisorSha256']:raise SystemExit('Supervisor changed after plan')
receipt=rdir/'fucq112-20261105-cases-full-receipt.json'
data=json.loads(receipt.read_text()) if receipt.exists() else {'plan':plan,'phases':[]}
if phase=='full' and any(item['phase']=='full' for item in data['phases']):raise SystemExit('Full already attempted; dispatcher must release any repeat')
item={'phase':phase,'argv':args,'cwd':plan['cwd'],'environment':plan['environment'],'started':time.time(),'supervisorSha256':actual}
process=subprocess.Popen(args,cwd=plan['cwd'],env=plan['environment'],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
item.update(pid=process.pid,pgid=process.pid)
try:out,err=process.communicate(timeout=660)
except subprocess.TimeoutExpired:
 os.killpg(process.pid,signal.SIGTERM)
 try:out,err=process.communicate(timeout=12)
 except subprocess.TimeoutExpired:
  os.killpg(process.pid,signal.SIGKILL);out,err=process.communicate();item['forcedStop']=True
 item['launcherTimeout']=True
finally:
 sys.path.insert(0,str(Path(plan['cwd'])/'_tools'))
 from test_resources import group_has_live_members
 item.update(rc=process.returncode,ended=time.time(),joined=process.poll() is not None,group_absent=group_has_live_members(process.pid) is False)
item.update(stdout=out,stderr=err);data['phases'].append(item)
tmp=receipt.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2)+'\n');tmp.replace(receipt)
print(out);print(err);print(json.dumps({'phase':phase,'rc':process.returncode,'receipt':str(receipt)}))
raise SystemExit(process.returncode)
