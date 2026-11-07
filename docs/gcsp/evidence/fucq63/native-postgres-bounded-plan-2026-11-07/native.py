"""One private local native cluster, bounded bootstrap and read-only order proof; all children inherit owned group."""
import sys
sys.dont_write_bytecode=True
import hashlib,json,os,pathlib,socket,subprocess,time,signal
BASE=pathlib.Path(__file__).resolve().parent;ROOT=BASE.parents[4];plan=json.loads((BASE/'plan.json').read_text());grant=json.loads(pathlib.Path(os.environ['ROOT_RELEASE_PATH']).read_text());scratch=pathlib.Path(os.environ['TMPDIR']);output=pathlib.Path(os.environ['PHASE_OUTPUT']);started=time.monotonic();postgres=None
assert str(scratch).startswith('/private/tmp/test-stamp-shard-') or str(scratch).startswith('/tmp/test-stamp-shard-')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for block in iter(lambda:f.read(1048576),b''):h.update(block)
 return h.hexdigest()
def save(name,value):(output/name).write_text(json.dumps(value,indent=2)+'\n')
def bounded(command,env,seconds,name):
 log=output/(name+'-failure.log')
 with log.open('xb') as f:result=subprocess.run(command,cwd=ROOT,env=env,stdout=f,stderr=subprocess.STDOUT,timeout=seconds)
 assert log.stat().st_size<=1048576,'Bounded stage output exceeded'
 if result.returncode!=0:raise RuntimeError('Native stage failed; sanitized bounded log retained')
 log.unlink();return result
installedPath=pathlib.Path(grant['installReceiptPath']);assert sha(installedPath)==grant['installReceiptSha256'];installed=json.loads(installedPath.read_text());assert installed['status']=='exact-pinned-postgresql16-bottles-installed';assert installed['version']=='postgres (PostgreSQL) 16.15'
for pin in installed['binaries']:assert sha(pathlib.Path(pin['path']))==pin['sha256']
binRoot=pathlib.Path(plan['binaryRoot']);cluster=scratch/'cluster';sockets=scratch/'socket';sockets.mkdir(mode=0o700);env={'PATH':'/opt/homebrew/bin:/usr/bin:/bin','LANG':'en_GB.UTF-8','LC_ALL':'en_GB.UTF-8','TZ':'UTC','HOME':os.environ['HOME'],'TMPDIR':str(scratch),'TMP':str(scratch),'TEMP':str(scratch),'GCSP_OFFLINE':'1','PHASE_OUTPUT':str(output),'NATIVE_CLUSTER_ROOT':str(cluster)}
serverLog=None
try:
 helpText=subprocess.run([str(binRoot/'initdb'),'--help'],capture_output=True,text=True,check=True,timeout=5).stdout;assert '--wal-segsize' in helpText
 bounded([str(binRoot/'initdb'),'-D',str(cluster),'-U','codex_fixture','--encoding=UTF8','--no-locale','--auth-local=trust','--auth-host=trust','--wal-segsize=1'],env,30,'initdb')
 configuration="\nshared_buffers='16MB'\nmax_connections=8\nwork_mem='1MB'\nmaintenance_work_mem='8MB'\nmin_wal_size='2MB'\nmax_wal_size='8MB'\nwal_keep_size=0\ncheckpoint_timeout='30s'\nlogging_collector=off\nlog_min_messages=warning\nlisten_addresses='127.0.0.1'\nunix_socket_permissions=0700\nssl=off\njit=off\nautovacuum=off\n"
 (cluster/'postgresql.conf').write_text((cluster/'postgresql.conf').read_text()+configuration)
 with socket.socket() as reservation:reservation.bind(('127.0.0.1',0));port=reservation.getsockname()[1]
 serverLog=(scratch/'postgres.log').open('xb');postgres=subprocess.Popen([str(binRoot/'postgres'),'-D',str(cluster),'-p',str(port),'-k',str(sockets)],env=env,stdout=serverLog,stderr=subprocess.STDOUT) # inherits supervisor-owned group
 ready=False
 for attempt in range(20):
  assert postgres.poll() is None,'Owned postgres exited during startup'
  found=subprocess.run([str(binRoot/'pg_isready'),'-h','127.0.0.1','-p',str(port),'-U','codex_fixture','-d','postgres','-t','1'],env=env,capture_output=True,timeout=2)
  if found.returncode==0:ready=True;break
  time.sleep(.25)
 assert ready,'Native readiness bound reached';env['GCSP_DATABASE_URL']='postgresql://codex_fixture@127.0.0.1:'+str(port)+'/postgres?sslmode=disable' # private fixture, environment only; never persisted/logged
 bounded(['/opt/homebrew/bin/node','--max-old-space-size=384',str(BASE/'seed.mjs')],env,max(1,120-(time.monotonic()-started)),'bootstrap-seed')
 seed=json.loads((output/'seed-receipt.json').read_text());assert seed['status']=='native-current-run-and-real-allocation-published';assert seed['stockImported']==3
 proofPlan=output/'native-proof-plan.json';proofIdentity=sha(proofPlan);bootstrapSeconds=time.monotonic()-started;assert bootstrapSeconds<=120
 proofStart=time.monotonic();bounded(['/opt/homebrew/bin/node','--max-old-space-size=384',str(ROOT/'docs/gcsp/evidence/fucq63/order-reference-2026-11-07/prove-orders.mjs'),'--plan',str(proofPlan),'--receipt',str(output/'native-proof-receipt.json')],env,120,'native-proof');assert sha(proofPlan)==proofIdentity
 proof=json.loads((output/'native-proof-receipt.json').read_text());assert proof['status']=='passed' and proof['nativeProof'] is True and proof['repositoryProvider']=='postgresql' and proof['checked']==3 and proof['currentRunUnchanged'] is True and proof['sourceCalls']==0 and proof['externalConnectAttempts']==0
 save('receipt.json',{'status':'local-native-current-run-three-order-proof-passed','repositoryProvider':'postgresql','nativeProof':True,'checked':3,'manifestDigest':plan['manifestDigest'],'runId':plan['context']['runId'],'seedReceiptSha256':sha(output/'seed-receipt.json'),'proofPlanSha256':proofIdentity,'proofReceiptSha256':sha(output/'native-proof-receipt.json'),'installReceiptSha256':grant['installReceiptSha256'],'bootstrapSeconds':bootstrapSeconds,'proofSeconds':time.monotonic()-proofStart,'sourceCalls':0,'externalConnectAttempts':0,'loopbackOnly':True,'deployedDatabaseProof':False,'acceptance':False})
except Exception:
 if postgres and postgres.poll() is not None:save('native-startup-failure.json',{'status':'owned-native-server-exited','exitCode':postgres.returncode,'acceptance':False})
 raise RuntimeError('Owned native phase failed; compact checkpoints retained, no memory fallback') from None
finally:
 if postgres:
  if postgres.poll() is None:postgres.send_signal(signal.SIGTERM)
  try:postgres.wait(timeout=10)
  except subprocess.TimeoutExpired:postgres.kill();postgres.wait(timeout=5)
 if serverLog:serverLog.close()
 save('server-stop.json',{'postgresPid':postgres.pid if postgres else None,'joined':postgres is None or postgres.poll() is not None,'directChildrenInSupervisorOwnedGroup':True,'databaseConnectionNeverPersisted':True,'clusterTeardown':'supervisor-finalizer-required','acceptance':False})
