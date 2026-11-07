"""Retain tri-state group-query evidence; only an explicit False proves absence."""
import time
def prove_groups_absent(resources, groups, destination, query=None, pause=None):
    query=query or resources.group_has_live_members;pause=pause or time.sleep
    report={'scope':'owned groups only; bounded unknown recheck; no live/unknown bypass','maximumQueriesPerGroup':3,'unknownDelaySeconds':0.1,'queries':[]}
    absent=True
    for pgid in groups:
        values=[]
        for number in range(1,4):
            value=query(pgid);assert value is None or type(value) is bool
            values.append(value);report['queries'].append({'pgid':pgid,'query':number,'liveMembers':value})
            resources.atomic_json(destination,report)
            if value is not None:break
            if number<3:pause(0.1)
        if values[-1] is not False:absent=False
    report['allGroupsAbsent']=absent;resources.atomic_json(destination,report)
    return absent
