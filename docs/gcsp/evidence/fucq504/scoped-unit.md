# F504 scoped unit receipt

Tested base: `4ce64954369542bb2659a0e4d75b5aea555a5a40` plus the exact stock inputs below. All current stock input hashes were rechecked after GREEN. No product source changed afterwards.

RED: 5 expected selected-failure title assertions failed; 15 passed. GREEN: 144 passed, zero failures/skips, in four specs (component20/store51/projection50/presentation23). Existing NG8107 optional-chain warning is unchanged.

Environment: Node 24.19.0, Angular core 21.2.26, CLI/build 21.2.30, Vitest 4.0.18. Package/lock bytes exactly matched the preserved dependency installation before each chunk.

Final unit resource grant: 2 GiB scratch, 1 GiB sampled group RSS, 600 s, one worker. GREEN: 3.45 s, 914,309,120 B sampled group RSS, 10,443,075 B scratch. Root `/private/tmp/vm-f504-unit-green` and owned worktree `apps/gcsp-web/node_modules`/`.angular` links were removed; absence verified, no cleanup issues. Installed dependencies were preserved.

Command: existing Angular CLI `test --watch=false --ts-config=<workspace-relative owned scratch config>` and one `--include=src/app/stock/stock.<name>.spec.ts` for component/store/projection/presentation. The scratch tsconfig extends the unchanged project spec config, files exactly those selected specs, include empty; real transitive production imports remain. Node V8 heap384MiB, NG_BUILD_MAX_WORKERS1, TMPDIR/TMP/TEMP owned root. The root/config are disposable and absent; exact generating supervisor remains in the local evidence below.

The earlier refused 1.5 GiB admission allocated nothing; the 1 GiB all-app typecheck was sentinel-stopped at 1,114,750,976 B sampled RSS; the first selective-config invocation refused the absolute path before tests. Those attempts remain failures/refusals. A corrected workspace-relative tsconfig produced the RED and GREEN results.

Local retained evidence (outside disposable roots):

| File | SHA256 |
| --- | --- |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f504-unit-supervise.py` | `58f2005a1895f0312755a2c3c0ac1935973dd272bb43b12d4d2820afde35b446` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f504-unit-red-ownership.json` | `720b4307bc52ff4ea919b0b9cb202bfd04d9d264e2255651d4956f62bcc254fa` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f504-unit-red.log` | `f60f00e742de80bbf8a3d8d005cacfb81bab8c5875f6039b8e517e55f1073534` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f504-unit-green-ownership.json` | `e1ab067f91e882c13cd8f704a0312cc63b4eb0777b77170d64ced33a525cca07` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f504-unit-green.log` | `15c8a8445649c7b7cf1794e562e20a87aae65a3f7cfdc6a0131135cd587fa6d6` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f504-unit-red-admission1.json` | `4280994edffe69f68acafcbba9d68f6b57742b264248b1c203cf99d815d41577` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f504-unit-red-memory1.json` | `85b9f5ff24cd9c3b2f269d10f540459a1034de4bf105e6acffdc0486a09856de` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f504-unit-red-config1.json` | `ba7ef19dcc8b2cfe135b0b21f69711d87a5916513d813df7be473b8a245bd333` |
| `/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/f504-unit-red-config1.log` | `5153f78411ef42a70c628e89ab803444db19f582e727f669274685acc31eed7f` |

Exact tested stock inputs:

| Path | SHA256 |
| --- | --- |
| `apps/gcsp-web/src/app/stock/stock-route.component.spec.ts` | `f8028324d5b7945ccbe5c5f2ed1ca7117fd9cdc0aaccf8efb7f08ca660838c38` |
| `apps/gcsp-web/src/app/stock/stock-route.component.ts` | `d058ab9cc6b54c2b9f90a9498605305b12ac4a954e091c0924d8b2a4e742dee2` |
| `apps/gcsp-web/src/app/stock/stock.component.css` | `d10f3dd64582990b10dfebaccb67d4877519b0b291256065b1b32d4d2ebe4e6c` |
| `apps/gcsp-web/src/app/stock/stock.component.html` | `3feec8eb4ea5eb2dbf7d134aed2b232ffa56754b85f38127e346a4c658077c7c` |
| `apps/gcsp-web/src/app/stock/stock.component.spec.ts` | `2b4a24cfb88f8a66a0dd258307614704c1838a9ddccc0636e69b8737458b48ad` |
| `apps/gcsp-web/src/app/stock/stock.component.ts` | `e30e6e29bc142230093765a6145995834bc9749c8f3a54dac15e2c28c4104cab` |
| `apps/gcsp-web/src/app/stock/stock.presentation.spec.ts` | `a3d3532ea7a138f5e327419cde7aca5367cf7e34863de68e4185b98902603dbc` |
| `apps/gcsp-web/src/app/stock/stock.presentation.ts` | `daa860e48945a3f923e816e73371d8e342da0826d7e14a0192feb3d9c03c5e51` |
| `apps/gcsp-web/src/app/stock/stock.projection.spec.ts` | `734c43f12458b25c299d3614548a8af7e817b0564ab3a7ce8d7a33aad95dacf8` |
| `apps/gcsp-web/src/app/stock/stock.projection.ts` | `0e74230e7e9083c65d76a26d7fd6684d23e58af020cd4222441e1338b58d81ae` |
| `apps/gcsp-web/src/app/stock/stock.store.spec.ts` | `80f7ce4380ce1d88c9766808dfe1043e9ada13c0710f2990397f06cf5708af11` |
| `apps/gcsp-web/src/app/stock/stock.store.ts` | `d38669bedcc491680f8a3f66fe25320707879a6d7e9aea31303244b8d561e5dd` |
| `apps/gcsp-web/src/app/stock/stock.types.ts` | `84f55cfe449616324a600d01520b2289c380ec2d67b68b1c2d5e64c06bc6f271` |

The ignored raw `scoped-unit.json` remains local, SHA256 `8f33e94283a3a2b6f0c32573fd6d6f64a72db0416f57c848b2dbfdb1199b411f`. The shared impact-map entry is keyed by the aggregate tested stock-input identity. The targeted selector dry-run accepted the explicit supervisor command; no full-suite stamp is claimed.

Follow-up: `rendered.md` records passing actual Angular deterministic-envelope desktop/390px state/recovery proof. Independent substantive visual and technical/browser reviews subsequently passed; their stable receipts and exact scope/limits are in `rendered.md`. No Java/OIDC/hosted/native acceptance, OneDrive/CloudStorage or foreground proof is claimed.
