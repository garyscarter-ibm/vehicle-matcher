# `.5` image approval in actual CLI callers

The restore command and operator verifier now compose the fixed `APPROVED_CORPUS_IMAGES` registration. No approval flag, manifest authority or transport scope was added. The child-CLI regression uses a small owned application copy with a code-owned fixture descriptor and exact original static WebP; production files are unchanged by the test.

Both real CLI paths failed before the fix and passed afterwards: 2 tests. The unchanged artifact, image and verifier boundaries passed 18 tests. There are no skipped tests. Earlier fixture/instrumentation failures are recorded separately in `receipt.json`; they are not counted as intentional red evidence. Missing/corrupt static bytes reject restore and preserve the prior active pointer; an altered image association fails the operator audit. All child invocations measured zero external calls.

One worker, 64 MiB scratch, 512 MiB host /448 MiB child, 90-second chunks. Each phase finalizer verified absent scratch, owned groups, reservation and dependency link. See the receipt for exact identities, elapsed times, sampled RSS/allocation and cleanup. No dependency installation, source traffic, ordinary-store publication or deployment occurred. Node26.7.0 was used; Node20 and Render remain unrun.
