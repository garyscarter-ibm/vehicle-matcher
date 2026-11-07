#869-source runtime checkpoint —7November2026

The exact `.6` release is active in the ordinary store and deployed from `d028839596158fcbc42a2969793dda881b385ab2` (deployment7615917737). All870configuration and one retained synthetic VIN lookups matched the current local loader DTO and exactmanifest, with zero mismatches. The LinuxNode20 job42333763377 independently passed its exact public21asset restore and offline audit.

The first attempt completed56matching comparisons, then a request raised TimeoutError. Its original report and cleanup are preserved. A separately bounded resumed chunk excluded all56completed records and matched the remaining815. Across both chunks:874GETs; no completed comparison was repeated. This does not establish the timeout's cause or a reliabilitySLA.

Each chunk used one worker,512MiBhost/448MiBchildRAM,64MiBscratch,30secondsperrequest and120secondsperchunk. The original896GETceiling was preserved, with838remaining before the resumed chunk. Both code identities stayed unchanged; owned scratch, groups, dependency links and reservations are absent. Total measured scratch removed:1,638,592bytes. No compatibility exception or leftovers.

See `summary.json` for actual counts, latency and remaining acceptance; original10,000/configuration, full model/profile/year/plant/five-WMI, applicable enrichment and order-reference obligations remain open. Remote source egress was not instrumented; the separate local/public/Linuxoffline proofs supply that evidence. No source collection, browser interaction or application mutation occurred in these production GETs.
