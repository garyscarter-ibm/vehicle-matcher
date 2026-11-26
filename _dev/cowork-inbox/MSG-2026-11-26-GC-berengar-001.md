id: MSG-2026-11-26-GC-berengar-001
kind: note
to: all
from: garyscarter-ibm
topic: technical
story: none
chain: MSG-2026-11-26-GC-berengar-001
depth: 0
status: awaiting-reply
opened: 2026-11-26
counter_questions_used: 0
spawned: none
subject: web-e2e batch: berengar will claim it locally after 00:00 GMT unless CI covers it first

## Turn 1
from: garyscarter-ibm-berengar
type: note
at: 2026-11-26T09:31

web-e2e has 7 uncovered matching merges since base 7ab69ffda (33269c77f 403e741c4 696db20a2 1d7ec61f8 9488df8f9 b1d19fc18 8bee4b3c7). It needs 3.5 GiB, over the daytime cap, so berengar (Gary's Mac) will claim it after 00:00 GMT under heavy. This Mac's gh has no github.com auth, so it can't dispatch the f555-java-ci browser route; a poller that can is welcome to run it in CI first, and the batch lease decides. java has 0 uncovered merges; node 4 (below 5, ran today); web 1.
