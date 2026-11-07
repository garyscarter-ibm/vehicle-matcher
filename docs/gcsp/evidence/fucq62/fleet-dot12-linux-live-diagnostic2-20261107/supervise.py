"""One root-authorized Linux live diagnostic; no dependency installation or local application runtime."""
import sys
sys.dont_write_bytecode = True
import atexit, base64, hashlib, json, os, pathlib, re, resource, shutil, signal, subprocess, time
BASE = pathlib.Path(__file__).resolve().parent
MIB = 1024 * 1024
assert sys.platform == 'linux'
assert os.environ.get('GITHUB_EVENT_NAME') in ['push','workflow_dispatch']
assert os.environ.get('GITHUB_REF') == 'refs/heads/gcsp-poc'
assert os.environ.get('GITHUB_RUN_ATTEMPT') == '1', 'No automatic rerun of consumed/uncertain requests'
run_id = os.environ['GITHUB_RUN_ID']; assert re.fullmatch(r'[0-9]+', run_id)
reviewed = os.environ['REVIEWED_PLAN_SHA256']; assert re.fullmatch(r'[a-f0-9]{64}', reviewed)
assert not os.environ.get('REQUESTED_PLAN_SHA256') or os.environ['REQUESTED_PLAN_SHA256'] == reviewed
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert sha(BASE / 'plan.json') == reviewed
plan = json.loads((BASE / 'plan.json').read_text())
assert plan['diagnosticId'] == 'fleet-dot12-linux-live-20261107-2'
assert plan['status'] == 'prepared-unexecuted-root-review-and-narrow-integration-push-required'
assert plan['deployment']['state'] == 'success'
assert plan['deployment']['code'] == 'c87b6f075c4e79bee93b71e1965ad23310ab8473'
assert re.fullmatch(r'[a-f0-9]{64}', plan['deployment']['evidenceSha256'])
assert len(plan['runtimePins']) == 4
assert plan['resources'] == {'workers':1,'nodeHeapMiB':256,'groupRssMiB':320,'supervisorRssMiB':64,'hostMiB':384,'scratchMiB':16,'supervisorSeconds':160,'jobMinutes':4,'archives':False}
workspace = pathlib.Path(os.environ['GITHUB_WORKSPACE']).resolve()
for path, digest in plan['runtimePins'].items(): assert sha(workspace / path) == digest
assert sha(BASE / plan['deployment']['evidenceFile']) == plan['deployment']['evidenceSha256']
assert sha(BASE / plan['expectedObservationFile']) == plan['expectedObservationSha256']
runner_temp = pathlib.Path(os.environ['RUNNER_TEMP']).resolve(); assert runner_temp.is_dir()
scratch = runner_temp / ('gcsp-live-dot12-2-' + run_id + '-1'); assert not os.path.lexists(scratch)
manifest = workspace / '.claude/test-runs' / ('ci-live-dot12-2-' + run_id + '-1.json')
assert not manifest.exists(); manifest.parent.mkdir(parents=True, exist_ok=True)
manifest.write_text(json.dumps({'ownerPid':os.getpid(),'runId':run_id,'attempt':1,'diagnosticId':plan['diagnosticId'],'root':str(scratch),'planSha256':reviewed,'workers':1,'scratchBudgetMiB':16,'hostBudgetMiB':384,'probeSeconds':150,'supervisorSeconds':160,'maximumGETs':3,'sourceCalls':0,'archive':False,'state':'planned'}) + '\n')
process = None; group = None; allocated = False; finished = False; result = {}; peak_disk = peak_group = peak_self = 0
started = time.monotonic(); log_used = 0
# Every diagnostic line is JSON-escaped, bounded, and emitted before scratch removal.
def emit(value):
 global log_used
 text = json.dumps(value, separators=(',', ':')) + '\n'; count = len(text.encode())
 assert log_used + count <= 65536, 'bounded retained log'; print(text, end='', flush=True); log_used += count

def members():
 rows = []
 if group is None: return rows
 for directory in pathlib.Path('/proc').iterdir():
  if not directory.name.isdigit(): continue
  try:
   fields = (directory / 'stat').read_text().rsplit(') ', 1)[1].split()
   if int(fields[2]) == group:
    rss = int((directory / 'statm').read_text().split()[1]) * os.sysconf('SC_PAGE_SIZE'); rows.append((int(directory.name), rss))
  except (FileNotFoundError, ProcessLookupError): pass
 return rows

def finish():
 global finished, allocated
 if finished: return
 if process is not None:
  if members():
   try: os.killpg(group, signal.SIGTERM)
   except ProcessLookupError: pass
  try: process.wait(timeout=5)
  except subprocess.TimeoutExpired:
   try: os.killpg(group, signal.SIGKILL)
   except ProcessLookupError: pass
   process.wait(timeout=5)
 assert not members(), 'Owned process group absence not proved'
 evidence = {}
 if allocated:
  for name in ['receipt.json','progress.json']:
   path = scratch / name
   if path.exists():
    assert path.stat().st_size <= 16384; evidence[name] = json.loads(path.read_text())
  excerpts = {}
  for path in sorted(scratch.iterdir()):
   if path.name.endswith('-body.bin') or path.name.endswith('-partial-body.bin') or path.name.endswith('-headers.json'):
    cap = 1024 if path.name.endswith('-headers.json') else 2048
    with path.open('rb') as stream: prefix = stream.read(cap)
    excerpts[path.name] = {'bytes':path.stat().st_size,'sha256':sha(path),'prefixBase64':base64.b64encode(prefix).decode('ascii'),'prefixBytes':len(prefix)}
  command_log = scratch / 'command.log'
  if command_log.exists():
   with command_log.open('rb') as stream: evidence['commandLogPrefixBase64'] = base64.b64encode(stream.read(2048)).decode('ascii')
  evidence['responseExcerpts'] = excerpts
  try: emit({'phaseEvidence':evidence})
  finally:
   assert scratch.is_dir() and not scratch.is_symlink() and scratch.parent == runner_temp
   shutil.rmtree(scratch); allocated = False
 assert not os.path.lexists(scratch)
 result.update(scratchAbsent=True, groupsAbsent=True, removedScratchPeakBytes=peak_disk, peakGroupRssBytes=peak_group, peakSupervisorRssBytes=peak_self, aggregateRssUpperBoundBytes=peak_group+peak_self, retainedArchive=False, retainedLogBytesBeforeCleanupLine=log_used, leftovers=[])
 emit({'cleanup':result}); finished = True

atexit.register(finish)
def terminate(signum, frame): raise SystemExit(128 + signum)
for sig in [signal.SIGTERM, signal.SIGINT]: signal.signal(sig, terminate)
try:
 assert shutil.disk_usage(runner_temp).free >= 5*1024*MIB + 16*MIB, 'Preserve5GiB emergency reserve'
 scratch.mkdir(mode=0o700); allocated = True
 command = ['node','--max-old-space-size=256',str(BASE / 'probe.mjs')]
 env = {key:os.environ[key] for key in ['PATH','GITHUB_EVENT_NAME','GITHUB_REF','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_WORKSPACE']}
 env.update(REQUESTED_PLAN_SHA256=os.environ.get('REQUESTED_PLAN_SHA256',''),LANG='C.UTF-8',LC_ALL='C.UTF-8',TZ='UTC',TMPDIR=str(scratch),TMP=str(scratch),TEMP=str(scratch),PHASE_OUTPUT=str(scratch),REVIEWED_PLAN_SHA256=reviewed)
 with (scratch / 'command.log').open('xb') as log:
  process = subprocess.Popen(command, cwd=workspace, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True); group = process.pid
  while True:
   rss = sum(amount for pid, amount in members()); own = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024
   disk = sum(p.stat().st_size for p in scratch.rglob('*') if p.is_file()); peak_group=max(peak_group,rss); peak_self=max(peak_self,own); peak_disk=max(peak_disk,disk)
   assert rss <= 320*MIB and own <= 64*MIB and rss+own <= 384*MIB, 'RSS budget'
   assert disk <= 16*MIB, 'Scratch budget'
   assert (scratch / 'command.log').stat().st_size <= 65536, 'Command log bound'
   assert time.monotonic()-started <= 160, 'Supervisor deadline'
   if process.poll() is not None: break
   time.sleep(0.1)
  result.update(rc=process.returncode, elapsedSeconds=time.monotonic()-started)
finally:
 try: finish()
 finally: atexit.unregister(finish)
sys.exit(0 if result.get('rc') == 0 else 1)
