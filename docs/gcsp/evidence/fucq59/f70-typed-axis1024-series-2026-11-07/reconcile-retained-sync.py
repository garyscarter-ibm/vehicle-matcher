"""Original primary/index reconciliation using only actual canonical/conflict event rows."""
import hashlib
import pathlib
import sys
sys.dont_write_bytecode = True
code = pathlib.Path(__file__).resolve().parent
original = code / 'reconcile-retained.py'
assert hashlib.sha256(original.read_bytes()).hexdigest() == 'eb83d91e568b6dc17035ea5d46536e6a2b780590b512a05c066729ffd761c350'
def actual_events(directory, allocation, receipt):
    import json, re
    rows = {}; raw = {}; sources = []
    for path in sorted(directory.iterdir()):
        if not re.fullmatch(r'source-events\.jsonl(?: [2-9][0-9]*\.jsonl)?', path.name): continue
        data = path.read_bytes(); lines = data.decode().splitlines()
        sources.append({'file':path.name,'sha256':hashlib.sha256(data).hexdigest(),'rows':len(lines)})
        for line in lines:
            event = json.loads(line); key = (event['attempt'],event['phase'])
            assert type(key[0]) is int and 1 <= key[0] <= allocation['attempts']
            assert key[1] in ['started','headers-received']
            if key in raw: assert raw[key] == line, 'conflicting actual event bytes'
            else: rows[key] = event; raw[key] = line
    assert any(row['file']=='source-events.jsonl' for row in sources)
    assert len(rows) == receipt['actualAttempts']*2 == allocation['attempts']*2
    for attempt in range(1,allocation['attempts']+1):
        start=rows[(attempt,'started')]; header=rows[(attempt,'headers-received')]
        assert start['method']=='GET' and header['status']==200
        assert all(start[key]==header[key] for key in ['attempt','method','url','startedAt'])
    actual_events.sources = sources
    return sorted(rows.values(),key=lambda row:(row['attempt'],row['phase']!='started'))
source=original.read_text()
old="events = [json.loads(line) for line in (BASE / 'source-events.jsonl').read_text().splitlines()]"
assert source.count(old)==1
source=source.replace(old,'events = actual_events(BASE, allocation, receipt)',1)
exec(compile(source,str(original)+':actual-event-union','exec'))
put('reconciliation-event-evidence.json',{'scope':'read-only actual event union; no synthesized rows or merged log written',
    'sources':actual_events.sources,'pairs':receipt['actualAttempts'],'originalCanonicalLogPreserved':True})
