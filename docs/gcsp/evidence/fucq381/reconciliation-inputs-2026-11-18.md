# FUCQ-381 current input identity — 18 November 2026

Documentation-only partial reconciliation, checked after normal refresh at 05:20:15 UTC. All 48 compact F381 source/test/fixture pins still match. Of the historical 2,551-input batch manifest, 2,543 match the refreshed tree; the eight later Angular stock/static-build/manual-proof changes are listed below and are outside the selected F381 Node boundary. The original 2,551 match remains a historical pre-refresh observation. Reused selected Node evidence is 302 passed, three failed and zero unobserved among 305 completed cases. Canonical Node and Java phases both finished RED at their original pin; the completed 43-case Java diagnostic composite does not change that result. All four original AC remain unchecked.

```json
{
  "workItem": "FUCQ-381",
  "state": "documentation-only partial result; selected Node boundary remains red; no green covering batch or acceptance",
  "checkedAt": "2026-11-18T03:18:46+00:00",
  "claimedHead": "b769513fd1ea07a251381175c7df8ca5699b58d5",
  "originalRepair": "94a9eaf0cf715d096544a3b41d2d9870ec4200c3",
  "dataStrategy": {
    "mode": "default",
    "contract": "docs/gcsp/employee-recommendation.md; canonical employee.recommendation.v1; existing gate/score/rank boundary",
    "delta": "No new data access, persistence, query or policy change."
  },
  "codeKey": "bf4674640102cfc8fcf80ad22e0a705795a1eca935ce668785a67c27c0680210",
  "inputSha256": {
    "blocks/gcsp/brief/brief-controller.js": "ec5101486858f0726b8995617ee94dd5630f33f275c0e5b690f8e8a530b848b3",
    "blocks/gcsp/brief/brief-transport.js": "1447c5cb5a1c4eb734ed807a8d96592edebeb6b1119d18d7179570b7ddeeb2cf",
    "blocks/gcsp/brief/brief-view-model.js": "540013ceddeb2da656c13c62b7d22da8b0a034d783a07c3d5b701603143057a2",
    "blocks/gcsp/brief/brief-view.js": "3ea695388c0e49e5581dfa36bf57b2b6241c2fe5dde9aa0ff90c1a483f006eaf",
    "blocks/gcsp/kit/plain-copy.js": "163ca4074a574833a00370b26eef7907963d24bf47f87a78381454e1d0ef8fe9",
    "blocks/vehicle-matcher/feedback-actions.js": "1d688f39b0e08ab3b2ebf77673dd5656a5048deea4cced1057b03d2f9431446d",
    "blocks/vehicle-matcher/modes/result-card.js": "73d45a2604882064812a4aa02be0113fea7724ff8bc37fbd269d5c918a130ea0",
    "docs/gcsp/evidence/fucq94/representative-snapshot.json": "7425c1147b58756c96261748297cd9d5bab088025179a5eff7725bbbd52f1685",
    "docs/gcsp/shared-contracts.md": "edf633de2325f0d7450a1e44acd229fb1cea67e39b59dbb4227b35bdf4983f37",
    "docs/gcsp/sources/choices-eligibility-matrices-2024-10.md": "26f73b087591914ac8720cd0a81c71054753356794dc4837ae5fdaa0ececbb93",
    "package-lock.json": "67cb7cd3fc2baeec4f4aa6fc7acc6ccc6b2944ae8ff6451274a874d22bffa071",
    "package.json": "3dfdb7d1b133ea3eeab0c7431f599f67021727ace403e4bb1e615b9ac4190490",
    "server/brands.js": "ea63741b2fcb01dbe35dcdffdd66f7021a3c0219517a8de1487fae65f65299e2",
    "server/engine.js": "a3a9460b71173984866c997ad2bc80f8ba4e5bf3105ebcdc0f5016bad20b8613",
    "server/gcsp/policy/file-provider.js": "d309528f446c4f82726a45595942a5095aa716cf12146e2047b51affa5e86c10",
    "server/gcsp/policy/index.js": "bcb722c43b687d00f571a1508ff34238189072605cd05b4e28fadcabf54f4042",
    "server/gcsp/policy/seed-v1.json": "23ce0fef1d65e9e54c3b6ddc65361f2abd92e0bb8071c05b4f9797daafad4591",
    "server/gcsp/recommendation/current-car.js": "c734fba90e9a65511231eb8fdf0a3447d94c4dafc311aca538c18dc8f67d7cbd",
    "server/gcsp/recommendation/index.js": "254472221a4aa988d9c5ae6cdd8f51c7059c3d24d727213d136a96862c161e11",
    "server/index.js": "fe1d6e16fdb4594fa5fef2ad1e30c30064f132e8ce58202d282736e4873687a8",
    "server/package-lock.json": "6adf33f5d00f92bb4ae33c6d10b1ebafdeeb00b359c969010865e27fc490d12e",
    "server/package.json": "2f4a5fb161b15aa241fbd1d23e82fd319f916fffd30bb7167fae0b71f68044e8",
    "server/scenarios/employee/feedback.js": "ae7dfaa21a56b2bcb76e0f1e93cd430711cf6668a23e4a744906981ea49f8464",
    "server/scenarios/employee/index.js": "ba6f32e11244d9ca377b190d70937501cb8bca1f5eb4767973539fa9347cfb20",
    "server/scenarios/employee/option-evidence.js": "0ad2d6f615f122d9eae6d75e39585fbaa8495bddf94f2f3e336f589fcc290911",
    "server/test/dom-harness.js": "06112a704fe7f75f1d1a9ebc8ebb7bc0898b8211f36abe04e64345bf7c9c24ad",
    "server/test/employee-recommendation-api.test.js": "ec860f11ae6d5af5e5086f1925bc46b0103c6d6d5315e34e74117b8795764a53",
    "server/test/employee-recommendation-order.test.js": "0c49f9e0803efaaa2136460582bedb61fdd3250dbd30b800a5c49dd90edfc171",
    "server/test/employee-recommendation.test.js": "d3c45cebac415976e851110359d4f75e2996a3a38c2d4473ae06f178c83e6a82",
    "server/test/feedback-actions.test.js": "5a803adba2ee0cbbee01559d36402e174f8d0053e04a0d50c0aee08a82af8c0d",
    "server/test/fixtures/gcsp-policy-projection.json": "a6dc31c246dab75ea7d1fae3bad020d2b203c59376b9b4073d517e993461a9e7",
    "server/test/fixtures/retail-compat-v1/expected.json": "140db30fe605e364d4b88f2143e770a8ad9195f014f2f08d6bf64a732c9447ea",
    "server/test/fixtures/retail-compat-v1/inputs.json": "05ec09609fc1c5707c92a0e7e8ad80335dc4ffac6859985f3fb18953c824c0d5",
    "server/test/fixtures/retail-compat-v1/manifest.json": "8b84acdda1bec310cf4add2dac14527030b094face2247df74e127e5f3a1cf3f",
    "server/test/gcsp-brief-render.test.js": "5aedbdfe9e113c1b793c873d28cc30fd4f5d017318428fa9672232494c95fb74",
    "server/test/gcsp-brief-transport.test.js": "ab076fea223b808ed41cefb07a0162fe37577ab50b5847a561435f7a08e4c1ba",
    "server/test/gcsp-plain-copy.test.js": "ed037af99e4a3461e14186488caf1370975a4435859b23366ee3f7a8ee1922b5",
    "server/test/gcsp-policy-service.test.js": "8fab460802cde4b98e1151e55140a7e7d7e765d2b1c40c596d3b60ada590c24f",
    "server/test/gcsp-recommendation-stored-subject.test.js": "1d1b33592dbc0eadf74cb9150e11b6fc51b64e4174e67123e315b75cd8d9512b",
    "server/test/helpers/employee-recommendation-http.js": "2ec9678f593c827c0b8b594258453daab3040d83df77724bd2f3a93c7530425a",
    "server/test/helpers/employee-recommendation.js": "23e5e9529981671b4e77f08f0dcdfcc7d76a971426c10750e5a8b4fb6e7133df",
    "server/test/helpers/retail-parity-child.js": "ce1e491c2524b22aa1fb850e92c7abbda44ada4d2f4a3be870ce109bc86cbae5",
    "server/test/helpers/retail-parity.js": "8d7f130eda34495e09bc9e9555d4bc885356a0d1a006f8cf4b22c37cb1311004",
    "server/test/helpers/retail-reference-r1/engine.js": "17b1434d0453379c9cdb13d30ffad9d1e60b163be3350736044aebfc87f6728e",
    "server/test/recommendation-compat.test.js": "1de9ebc159f38fa381ffcbe9cee47cdd38fa2aecfd9d7ea309f1f498e54295a9",
    "server/test/retail-compat-client-harness.js": "3508a2dd10a0e3a5f3192d0ca5a5f95809836b69aff5bd4f7aab783607915e9e",
    "server/test/retail-compat-harness.js": "78940c81181abc41a7d6f259243f1c3e6701f9e0dbd903dd66caebb10d22560e",
    "server/vehicles/index.js": "873faa815290de68d9e0af765156a49c5f05e6caf0352769fe17ae018a8c6fbe"
  },
  "selectedTestFiles": [
    "server/test/employee-recommendation-order.test.js",
    "server/test/employee-recommendation.test.js",
    "server/test/feedback-actions.test.js",
    "server/test/gcsp-brief-render.test.js",
    "server/test/gcsp-plain-copy.test.js",
    "server/test/employee-recommendation-api.test.js",
    "server/test/gcsp-recommendation-stored-subject.test.js",
    "server/test/gcsp-policy-service.test.js",
    "server/test/gcsp-brief-transport.test.js",
    "server/test/recommendation-compat.test.js"
  ],
  "batch": {
    "run": "batch-next-20261118T023236Z",
    "pin": "26d73b760ba26cd99610ff738c95c0c1355cc7f3",
    "tree": "99e62499107d8f0f23591455b7b2961b0b638245",
    "inputManifestSha256": "10df3d1d7594d8d62416b36d7c5451fcc573fc828cee7c0c9bf2149e1a0b32e7",
    "sourceAggregateSha256": "0f918b49698e9f2d5927fe0371c0446a95edec96cbebf61cb8d358a7f2872422",
    "comparedInputCount": 2551,
    "matchedInputCount": 2551,
    "mismatchedInputs": [],
    "versions": {
      "initdb": "initdb (PostgreSQL) 17.12 (Homebrew)",
      "java": "openjdk version \"21.0.13.0.3\" 2026-10-24\nOpenJDK Runtime Environment Homebrew (build 21.0.13.0.3)\nOpenJDK 64-Bit Server VM Homebrew (build 21.0.13.0.3, mixed mode, sharing)",
      "javac": "javac 21.0.13.0.3",
      "node": "v26.7.0",
      "npm": "11.19.0",
      "postgres": "postgres (PostgreSQL) 17.12 (Homebrew)"
    },
    "nodeCommand": [
      "npm",
      "test"
    ],
    "javaCommand": [
      "./mvnw",
      "-B",
      "clean",
      "verify"
    ],
    "nodeEnvironment": {
      "NODE_OPTIONS": "--experimental-vm-modules --max-old-space-size=1536",
      "PATH": "/opt/homebrew/bin:/opt/homebrew/opt/openjdk@21/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    },
    "dependencies": {
      "installedJsdom": {
        "path": "/Users/usget/Claude/vehicle-matcher/node_modules/jsdom/package.json",
        "sha256": "e87940b12f720a5b735a5df82108b634a238b8c6ebced71050a346a1675575b9"
      },
      "installedPg": {
        "path": "/Users/usget/Claude/vehicle-matcher/server/node_modules/pg/package.json",
        "sha256": "b1e53333a3d0c2c47c49a5cb919d221135dc03145df740925b899bc2baacc435"
      },
      "installedRootLock": {
        "path": "/Users/usget/Claude/vehicle-matcher/node_modules/.package-lock.json",
        "sha256": "92164c25104959a02c3ea16fa1643630b54cf5e8f5bce58608f076e4fcce9118"
      },
      "installedServerLock": {
        "path": "/Users/usget/Claude/vehicle-matcher/server/node_modules/.package-lock.json",
        "sha256": "04a4016750d016025a0e662b3cc556212627eed4681ed7969296f20437a79517"
      },
      "rootLock": {
        "path": "/Users/usget/Claude/vehicle-matcher/.claude/worktrees/batch-20261118-0232/package-lock.json",
        "sha256": "67cb7cd3fc2baeec4f4aa6fc7acc6ccc6b2944ae8ff6451274a874d22bffa071"
      },
      "serverLock": {
        "path": "/Users/usget/Claude/vehicle-matcher/.claude/worktrees/batch-20261118-0232/server/package-lock.json",
        "sha256": "6adf33f5d00f92bb4ae33c6d10b1ebafdeeb00b359c969010865e27fc490d12e"
      },
      "serverWorktreeLink": {
        "created": false,
        "path": "/Users/usget/Claude/vehicle-matcher/.claude/worktrees/batch-20261118-0232/server/node_modules",
        "target": "/Users/usget/Claude/vehicle-matcher/server/node_modules"
      }
    },
    "status": "Final canonical result at pin26d73b760 remains RED: Node5430/5148passed/120failed/162skipped; Java2073/2053passed/12failures/5errors/3skipped; both normal exit1. Historical2551-input match predates refresh; current2543/2551 recorded in publicationReconciliation.",
    "nodePhase": {
      "command": [
        "/opt/homebrew/bin/npm",
        "test"
      ],
      "completed": true,
      "exitCode": 1,
      "status": "failed",
      "startedAt": 1794969186.369045,
      "endedAt": 1794971710.024727,
      "observedTotals": {
        "cancelled": 0,
        "duration_ms": 2523076.609583,
        "fail": 120,
        "pass": 5148,
        "skipped": 162,
        "tests": 5430
      },
      "logTruncated": false,
      "ownedLiveProcessCount": 0
    },
    "artifacts": {
      "inputs.json": {
        "path": "/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/batch-next-20261118T023236Z-inputs.json",
        "bytes": 348026,
        "sha256": "10df3d1d7594d8d62416b36d7c5451fcc573fc828cee7c0c9bf2149e1a0b32e7"
      },
      "node.log": {
        "path": "/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/batch-next-20261118T023236Z-node.log",
        "bytes": 844523,
        "sha256": "080147f60490b3fd82dac8e805be4db36689b12f8e5fd0558a4cdae3e57ff358"
      },
      "node-cases.jsonl": {
        "path": "/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/batch-next-20261118T023236Z-node-cases.jsonl",
        "bytes": 1550205,
        "sha256": "034a0fc30b18ffe797122879eed10590f1573971ff3f4141197d0563411bdbe3"
      },
      "failures.json": {
        "path": "/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/resources/batch-next-20261118T023236Z-failures.json",
        "bytes": 51923,
        "sha256": "24e9d9f578d3f8dec087317c5bd0244e0524eb868532d3b1e4dc9d267c66dd08"
      }
    },
    "failureJsonRecords": 128,
    "failureRecordsAreTestCount": false
  },
  "historicalProof": {
    "run": "fucq381-points-20261111",
    "passed": 297,
    "identity": "bc7e9fec221dbfa12153a50fed767a1f42799121a51a429b8f4dcb3c40e6fdcd",
    "currentWholeFileMatches": 2,
    "recordedWholeFileCount": 10,
    "scope": "Historical diagnosis/repair evidence only; not current pass."
  },
  "coverageLimitation": "No measured per-test V8 contexts; static ownership/import/fixture mapping is not measured coverage. Unobserved paths remain unknown.",
  "newScratchBytes": 0,
  "noOneDriveAccess": true,
  "newRuntime": false,
  "reconciliationHead": "b2716ddb7b331db9f051d5c08b0c4e5101920838",
  "executionCheckpoint": {
    "observedAt": "2026-11-18T03:18:46+00:00",
    "ledgerSequenceLimit": 5431,
    "selectionMethod": "Each complete ordered source signature matches uniquely among completed case events. Expand stored-subject provider-field loop (3), retail perturbation loop (5), and retail frozen server/client nested checks (2x(67+11)=156). Exclude the retail opening suite marker; include its completed parent result. Do not attribute by sampled candidateWorkerFiles.",
    "sourceExpandedCases": 305,
    "observedPasses": 302,
    "observedFailures": 3,
    "unobservedCases": 0,
    "literalTopLevelCases": 141,
    "generatedTopLevelCases": 8,
    "nestedCases": 156,
    "modules": [
      {
        "file": "server/test/employee-recommendation-order.test.js",
        "literalTopLevelCases": 5,
        "generatedTopLevelCases": 0,
        "nestedCases": 0,
        "sourceExpandedCases": 5,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "13947e4a729bddb3060c3e64c8f000a5c632738c77e1c5b00c66b414d9953da6",
        "observedPasses": 5,
        "observedFailures": 0,
        "unobservedCases": 0,
        "sequenceFirst": 388,
        "sequenceLast": 392,
        "sequences": [
          388,
          389,
          390,
          391,
          392
        ],
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      },
      {
        "file": "server/test/employee-recommendation.test.js",
        "literalTopLevelCases": 29,
        "generatedTopLevelCases": 0,
        "nestedCases": 0,
        "sourceExpandedCases": 29,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "7f86c0664c8462a0266a0d5a55bf231b6560f768837b81ada138fe0817a15440",
        "observedPasses": 29,
        "observedFailures": 0,
        "unobservedCases": 0,
        "sequenceFirst": 393,
        "sequenceLast": 421,
        "sequences": [
          393,
          394,
          395,
          396,
          397,
          398,
          399,
          400,
          401,
          402,
          403,
          404,
          405,
          406,
          407,
          408,
          409,
          410,
          411,
          412,
          413,
          414,
          415,
          416,
          417,
          418,
          419,
          420,
          421
        ],
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      },
      {
        "file": "server/test/feedback-actions.test.js",
        "literalTopLevelCases": 18,
        "generatedTopLevelCases": 0,
        "nestedCases": 0,
        "sourceExpandedCases": 18,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "e205754585522bf8e8c305f7de7551ffc082f7f9b9f121a1caec603b58b65b8e",
        "observedPasses": 18,
        "observedFailures": 0,
        "unobservedCases": 0,
        "sequenceFirst": 475,
        "sequenceLast": 492,
        "sequences": [
          475,
          476,
          477,
          478,
          479,
          480,
          481,
          482,
          483,
          484,
          485,
          486,
          487,
          488,
          489,
          490,
          491,
          492
        ],
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      },
      {
        "file": "server/test/gcsp-brief-render.test.js",
        "literalTopLevelCases": 25,
        "generatedTopLevelCases": 0,
        "nestedCases": 0,
        "sourceExpandedCases": 25,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "cde5044e71a0c98c18d9909810ffdabc774fe335b5353af98e60ae2fa5cd8400",
        "observedPasses": 24,
        "observedFailures": 1,
        "unobservedCases": 0,
        "sequenceFirst": 1094,
        "sequenceLast": 1118,
        "sequences": [
          1094,
          1095,
          1096,
          1097,
          1098,
          1099,
          1100,
          1101,
          1102,
          1103,
          1104,
          1105,
          1106,
          1107,
          1108,
          1109,
          1110,
          1111,
          1112,
          1113,
          1114,
          1115,
          1116,
          1117,
          1118
        ],
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      },
      {
        "file": "server/test/gcsp-plain-copy.test.js",
        "literalTopLevelCases": 8,
        "generatedTopLevelCases": 0,
        "nestedCases": 0,
        "sourceExpandedCases": 8,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "ce796ab26431b069d55bae219078b893693bcf238c186bbc30ad0879efd63d7c",
        "observedPasses": 8,
        "observedFailures": 0,
        "unobservedCases": 0,
        "sequenceFirst": 3726,
        "sequenceLast": 3733,
        "sequences": [
          3726,
          3727,
          3728,
          3729,
          3730,
          3731,
          3732,
          3733
        ],
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      },
      {
        "file": "server/test/employee-recommendation-api.test.js",
        "literalTopLevelCases": 10,
        "generatedTopLevelCases": 0,
        "nestedCases": 0,
        "sourceExpandedCases": 10,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "a8b71ed7b7579ac7e3484b77e142e29312787b5625a782a1a30df0fcd77eff9e",
        "observedPasses": 8,
        "observedFailures": 2,
        "unobservedCases": 0,
        "sequenceFirst": 362,
        "sequenceLast": 371,
        "sequences": [
          362,
          363,
          364,
          365,
          366,
          367,
          368,
          369,
          370,
          371
        ],
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      },
      {
        "file": "server/test/gcsp-recommendation-stored-subject.test.js",
        "literalTopLevelCases": 11,
        "generatedTopLevelCases": 3,
        "nestedCases": 0,
        "sourceExpandedCases": 14,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "915c96f4d870f6e784b4e5b1a3c6be25d471d63a1dba42bebd0922219255ce76",
        "observedPasses": 14,
        "observedFailures": 0,
        "unobservedCases": 0,
        "sequenceFirst": 4057,
        "sequenceLast": 4070,
        "sequences": [
          4057,
          4058,
          4059,
          4060,
          4061,
          4062,
          4063,
          4064,
          4065,
          4066,
          4067,
          4068,
          4069,
          4070
        ],
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      },
      {
        "file": "server/test/gcsp-policy-service.test.js",
        "literalTopLevelCases": 21,
        "generatedTopLevelCases": 0,
        "nestedCases": 0,
        "sourceExpandedCases": 21,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "e01329e545975bedf8e3c51e3e891b5ea4ba80d10782941f3dfd57fa7fed0187",
        "observedPasses": 21,
        "observedFailures": 0,
        "unobservedCases": 0,
        "sequenceFirst": 3772,
        "sequenceLast": 3792,
        "sequences": [
          3772,
          3773,
          3774,
          3775,
          3776,
          3777,
          3778,
          3779,
          3780,
          3781,
          3782,
          3783,
          3784,
          3785,
          3786,
          3787,
          3788,
          3789,
          3790,
          3791,
          3792
        ],
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      },
      {
        "file": "server/test/gcsp-brief-transport.test.js",
        "literalTopLevelCases": 6,
        "generatedTopLevelCases": 0,
        "nestedCases": 0,
        "sourceExpandedCases": 6,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "8922d17c0e22d9264c5ee5df8730038dbd4cb7714eda6303666ac38c7a9c4ec1",
        "observedPasses": 6,
        "observedFailures": 0,
        "unobservedCases": 0,
        "sequenceFirst": 1124,
        "sequenceLast": 1129,
        "sequences": [
          1124,
          1125,
          1126,
          1127,
          1128,
          1129
        ],
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      },
      {
        "file": "server/test/recommendation-compat.test.js",
        "literalTopLevelCases": 8,
        "generatedTopLevelCases": 5,
        "nestedCases": 156,
        "sourceExpandedCases": 169,
        "uniqueExpandedSourceMatches": 1,
        "sourceSignatureSha256": "b5c2b7b7a67cdfa357b55d5af7ec1a9305c7dee01f046a2c6c44cc33b55ed395",
        "observedPasses": 169,
        "observedFailures": 0,
        "unobservedCases": 0,
        "sequenceFirst": 4852,
        "sequenceLast": 5020,
        "sequences": null,
        "attribution": "Unique complete ordered expanded source signature among completed case events; sampled worker labels are not attribution."
      }
    ],
    "nodeCommandCompleted": true,
    "nodeExitCode": 1,
    "javaResultObserved": false,
    "javaStateAtObservation": "running; parent reports real Java21 clean verify; no final result reused/inferred",
    "acceptance": "All four original items remain unchecked; selected failures are retained and green covering-batch coverage is absent.",
    "duplicateTitleAttribution": {
      "title": "a 401 with no status (lapsed access key) reads access-required; a status keeps its own result",
      "includedSequence": 1127,
      "includedBlock": [
        1124,
        1129
      ],
      "excludedSequence": 770,
      "excludedBlock": [
        768,
        772
      ],
      "excludedSource": "server/test/gcsp-activity-transport.test.js",
      "excludedSourceSha256": "46c048af0f1f10039ed94831317b2c11f4ddcd638028fcbc2246a9eccb47194d",
      "basis": "Sequence770 is the third item in the unique ordered activity-transport source block768–772. Sequence1127 is the fourth item in the unique ordered six-title brief-transport block1124–1129. All these source files are included in the matched2551-input batch manifest.",
      "candidateWorkerFiles": "Sampled field is stale across these blocks and is not used for attribution."
    },
    "retail": {
      "nestedFixtureServerKeys": 67,
      "nestedFixtureClientKeys": 11,
      "passes": 2,
      "nestedCompleted": 156,
      "topLevelCompleted": 13,
      "allCompleted": 169,
      "allPassed": 169,
      "completedParentSequence": 5008,
      "tasteShareChildSequence": 5019,
      "openingMarkerIsPass": false
    }
  },
  "historicalIdentityCheckedAt": "2026-11-18T02:39:03+00:00",
  "historicalReconciliationHead": "c8de4dcfb6835ec9d1a2735530b11929430bfe81",
  "reconciliationHeadMeaning": "Historical published documentation base before final Node reconciliation; claimedHead and historical observations remain unchanged. publicationReconciliation records the refreshed publication base.",
  "executionHistory": [
    {
      "observedAt": "2026-11-18T02:44Z",
      "ledgerSequenceLimit": 1212,
      "selectionMethod": "Match the complete ordered literal source-title list as a unique contiguous block in the serial --test-concurrency=1 reporter ledger. File attribution is inferred from that unique source signature, not candidateWorkerFiles. Counts are case observations, not module exit counts, measured coverage or full suite totals.",
      "observedPasses": 90,
      "observedFailures": 3,
      "unobservedTitles": 48,
      "modules": [
        {
          "file": "server/test/employee-recommendation-order.test.js",
          "literalTitles": 5,
          "observedPasses": 5,
          "observedFailures": 0,
          "unobservedTitles": 0,
          "sequences": [
            388,
            389,
            390,
            391,
            392
          ],
          "attribution": "One unique contiguous block matching the complete ordered literal source-title list."
        },
        {
          "file": "server/test/employee-recommendation.test.js",
          "literalTitles": 29,
          "observedPasses": 29,
          "observedFailures": 0,
          "unobservedTitles": 0,
          "sequences": [
            393,
            394,
            395,
            396,
            397,
            398,
            399,
            400,
            401,
            402,
            403,
            404,
            405,
            406,
            407,
            408,
            409,
            410,
            411,
            412,
            413,
            414,
            415,
            416,
            417,
            418,
            419,
            420,
            421
          ],
          "attribution": "One unique contiguous block matching the complete ordered literal source-title list."
        },
        {
          "file": "server/test/feedback-actions.test.js",
          "literalTitles": 18,
          "observedPasses": 18,
          "observedFailures": 0,
          "unobservedTitles": 0,
          "sequences": [
            475,
            476,
            477,
            478,
            479,
            480,
            481,
            482,
            483,
            484,
            485,
            486,
            487,
            488,
            489,
            490,
            491,
            492
          ],
          "attribution": "One unique contiguous block matching the complete ordered literal source-title list."
        },
        {
          "file": "server/test/gcsp-brief-render.test.js",
          "literalTitles": 25,
          "observedPasses": 24,
          "observedFailures": 1,
          "unobservedTitles": 0,
          "sequences": [
            1094,
            1095,
            1096,
            1097,
            1098,
            1099,
            1100,
            1101,
            1102,
            1103,
            1104,
            1105,
            1106,
            1107,
            1108,
            1109,
            1110,
            1111,
            1112,
            1113,
            1114,
            1115,
            1116,
            1117,
            1118
          ],
          "attribution": "One unique contiguous block matching the complete ordered literal source-title list."
        },
        {
          "file": "server/test/gcsp-plain-copy.test.js",
          "literalTitles": 8,
          "observedPasses": 0,
          "observedFailures": 0,
          "unobservedTitles": 8,
          "sequences": [],
          "attribution": "No complete ordered source-title block observed by the checkpoint."
        },
        {
          "file": "server/test/employee-recommendation-api.test.js",
          "literalTitles": 10,
          "observedPasses": 8,
          "observedFailures": 2,
          "unobservedTitles": 0,
          "sequences": [
            362,
            363,
            364,
            365,
            366,
            367,
            368,
            369,
            370,
            371
          ],
          "attribution": "One unique contiguous block matching the complete ordered literal source-title list."
        },
        {
          "file": "server/test/gcsp-recommendation-stored-subject.test.js",
          "literalTitles": 11,
          "observedPasses": 0,
          "observedFailures": 0,
          "unobservedTitles": 11,
          "sequences": [],
          "attribution": "No complete ordered source-title block observed by the checkpoint."
        },
        {
          "file": "server/test/gcsp-policy-service.test.js",
          "literalTitles": 21,
          "observedPasses": 0,
          "observedFailures": 0,
          "unobservedTitles": 21,
          "sequences": [],
          "attribution": "No complete ordered source-title block observed by the checkpoint."
        },
        {
          "file": "server/test/gcsp-brief-transport.test.js",
          "literalTitles": 6,
          "observedPasses": 6,
          "observedFailures": 0,
          "unobservedTitles": 0,
          "sequences": [
            1124,
            1125,
            1126,
            1127,
            1128,
            1129
          ],
          "attribution": "One unique contiguous block matching the complete ordered literal source-title list."
        },
        {
          "file": "server/test/recommendation-compat.test.js",
          "literalTitles": 8,
          "observedPasses": 0,
          "observedFailures": 0,
          "unobservedTitles": 8,
          "sequences": [],
          "attribution": "No complete ordered source-title block observed by the checkpoint."
        }
      ],
      "nodeCommandCompleted": false,
      "javaResultObserved": false,
      "acceptance": "All four items remain open; green covering batch required.",
      "duplicateTitleAttribution": {
        "title": "a 401 with no status (lapsed access key) reads access-required; a status keeps its own result",
        "includedSequence": 1127,
        "includedBlock": [
          1124,
          1129
        ],
        "excludedSequence": 770,
        "excludedBlock": [
          768,
          772
        ],
        "excludedSource": "server/test/gcsp-activity-transport.test.js",
        "excludedSourceSha256": "46c048af0f1f10039ed94831317b2c11f4ddcd638028fcbc2246a9eccb47194d",
        "basis": "Sequence770 is the third item in the unique ordered activity-transport source block768–772. Sequence1127 is the fourth item in the unique ordered six-title brief-transport block1124–1129. All these source files are included in the matched2551-input batch manifest.",
        "candidateWorkerFiles": "Sampled field is stale across these blocks and is not used for attribution."
      }
    },
    {
      "observedAt": "2026-11-18T03:06:36+00:00",
      "ledgerSequenceLimit": 4024,
      "passes": 119,
      "failures": 3,
      "unobservedLiteralTitles": 19
    },
    {
      "observedAt": "2026-11-18T03:09:23+00:00",
      "ledgerSequenceLimit": 4265,
      "passes": 133,
      "failures": 3,
      "unobservedLiteralTitles": 8,
      "pendingRetailSourceExpectedCases": 169
    }
  ],
  "selectedFailures": [
    {
      "sequence": 362,
      "file": "server/test/employee-recommendation-api.test.js",
      "testLine": 23,
      "assertionLine": 33,
      "code": "ERR_ASSERTION",
      "actual": 200,
      "expected": 403,
      "finding": "Greg request expected403 but returned200; current canonical seed explicitly grants Greg both greg and employee. This test stops here before its later presenter/origin assertions."
    },
    {
      "sequence": 370,
      "file": "server/test/employee-recommendation-api.test.js",
      "testLine": 271,
      "assertionLine": 281,
      "code": "ERR_ASSERTION",
      "actual": 200,
      "expected": 403,
      "finding": "Same Greg role-expectation mismatch; preceding employee200 and customCalls0 checks passed, later customCalls assertion not reached."
    },
    {
      "sequence": 1112,
      "file": "server/test/gcsp-brief-render.test.js",
      "testLine": 231,
      "assertionLine": 233,
      "code": "TypeError",
      "message": "Cannot read properties of undefined (reading 'label')",
      "finding": "PORTAL_NAVIGATION.find(item.key === 'brief') returns no item before the editor/body terminology assertions; truthful badge case1105 separately passed."
    }
  ],
  "selectedCaseIdentitySha256": "3242f5ba60deba7e1afadceb8d857ab615e64e75b4e6b175d27747fd7977f8f3",
  "finalNodeReceipt": {
    "path": "/Users/usget/Claude/vehicle-matcher/.claude/poller/run-20261117-2335/f381-final-node-reconciliation.json",
    "bytes": 15619,
    "sha256": "94f20f4c147b1dfd8f5ada7d7edb9782b000ec6744e0dd1a9d26a912e569aec4"
  },
  "resourceOwnership": "Parent owns canonical batch and its retained cleanup receipts. This reconciliation creates no runtime, scratch or child; reported parent cleanup is attributed to its independently hashed final receipt.",
  "publicationReconciliation": {
    "observedAt": "2026-11-18T05:20:15.069840+00:00",
    "refreshedHead": "00a0de8bada56b8ae3c77c3fd54d2bf1d39ae949",
    "refreshedTree": "86f73eb973f001f6516b56706050a5d96b066ea6",
    "integratedBase": "e45e4cac7503f5bfc7f8bd87f764e450e6546a27",
    "compactCompared": 48,
    "compactMatched": 48,
    "batchCompared": 2551,
    "batchMatched": 2543,
    "batchMismatches": [
      {
        "path": "apps/gcsp-web/src/app/stock/stock.component.html",
        "batchSha256": "55884a73fc2f7787025bcdfdac41a28da64d091f216570c6327ef8be1c98781d",
        "currentSha256": "3feec8eb4ea5eb2dbf7d134aed2b232ffa56754b85f38127e346a4c658077c7c"
      },
      {
        "path": "apps/gcsp-web/src/app/stock/stock.component.spec.ts",
        "batchSha256": "c29629cb30ff16a08817fb6ec3dab11a751cf581a78bedc2fb07b59bc21e8cdc",
        "currentSha256": "e30c3b1b16826bd4d7d78cd2080bd7810e403dd2d8d3e9dbb7717dabfe167ce3"
      },
      {
        "path": "apps/gcsp-web/src/app/stock/stock.component.ts",
        "batchSha256": "e30e6e29bc142230093765a6145995834bc9749c8f3a54dac15e2c28c4104cab",
        "currentSha256": "7ac6c8312a352f1949dd3c71a009c7c8db7e302c8a76222e36a2ee138b82d57d"
      },
      {
        "path": "apps/gcsp-web/src/app/stock/stock.store.spec.ts",
        "batchSha256": "079fa6051f9f7680f4998d2d8de10d641c3e43cb8e336c7fdea35456ac343a42",
        "currentSha256": "80f7ce4380ce1d88c9766808dfe1043e9ada13c0710f2990397f06cf5708af11"
      },
      {
        "path": "apps/gcsp-web/src/app/stock/stock.store.ts",
        "batchSha256": "86772d95d15a6a7f4813daa8df84541d8e38640adfdb411814680edd221fcb0c",
        "currentSha256": "d38669bedcc491680f8a3f66fe25320707879a6d7e9aea31303244b8d561e5dd"
      },
      {
        "path": "scripts/build-gcsp-static.mjs",
        "batchSha256": "fa281bd8b58e83034930e3e8c68705926837497b80fe3f4766cea2278e76fe4b",
        "currentSha256": "5dd1ee996bb77f65bd421cf5b3e2c1c20e70fac0f51936207841fa65f88c53c5"
      },
      {
        "path": "scripts/gcsp/fucq443-connected-manual-proof.mjs",
        "batchSha256": "f92fb037a004560113b5cf1a548a6df22197ced7abfb6c6db06c4fc808f7560e",
        "currentSha256": "9012c7e0fc6e077c973179794c07f3dbba703129ff6a0fc9398c000fbaf8b5bc"
      },
      {
        "path": "server/test/gcsp-static-angular.test.js",
        "batchSha256": "ae23f9b5519be0344e8a45883ff1e43667da6292dd33fa123f482526b0532531",
        "currentSha256": "2fa1655b91be6fe6802fefd248e4c2aa1b25d28745c530f6fd63d6d40def6231"
      }
    ],
    "boundaryReview": "Eight later base changes affect Angular stock (five files), the Angular static builder/test and a connected-manual proof script. The ten selected F381 Node tests and all48 documented ranking/service/feedback/policy/brief/retail input pins remain exact. Selected direct imports and fixture/subprocess boundaries were reviewed; this is scoped evidence reuse, not full current-tree equivalence or a new execution.",
    "validationSelection": "Read-only source/retained-receipt identity reconciliation, named three-path diff review and git diff --check. No source change, test rerun, full suite, browser or native database check selected for this documentation-only increment.",
    "canonical": {
      "pin": "26d73b760ba26cd99610ff738c95c0c1355cc7f3",
      "status": "RED",
      "node": {
        "tests": 5430,
        "passed": 5148,
        "failures": 120,
        "skipped": 162,
        "cancelled": 0,
        "exitCode": 1
      },
      "java": {
        "classes": 338,
        "tests": 2073,
        "passed": 2053,
        "failures": 12,
        "errors": 5,
        "skipped": 3,
        "exitCode": 1
      }
    },
    "javaDiagnostics": {
      "units": 6,
      "classes": 8,
      "tests": 43,
      "passed": 32,
      "failures": 10,
      "errors": 0,
      "skipped": 1,
      "variantLimit": "Original manual5 reused, isolated singles22 and corrected same-JVM phase pairs16; original zero-test orderer refusal excluded. Not a canonical green or F381 deployed-composition proof.",
      "path": ".claude/poller/run-20261117-2335/resources/batch-java-final-disposition.json",
      "bytes": 62581,
      "sha256": "74b5f6e6088639c7a2adefff6f207fd30c95ea13f35d9515ebe421b621b1243f"
    },
    "parentCleanup": {
      "observedAt": "2026-11-18T05:14:51.743866+00:00",
      "path": ".claude/poller/run-20261117-2335/resources/batch-canonical-worktree-cleanup-final.json",
      "bytes": 456,
      "sha256": "d2935c9b7415d5ddc23b64e3a3a84e7b8b9dc0cafff9a8ff1fb2347d8d1f6825",
      "worktreeAbsent": true,
      "registrationAbsent": true,
      "localBranchAbsent": true,
      "removedFileAllocatedBytes": 608141312,
      "method": "Parent normal drop-branch; no force, foreign-resource or OneDrive cleanup. Not performed by this reconciliation."
    },
    "acceptance": "partial; all four original criteria remain unchecked. F381 owns its original proof and persisted-policy rollout gaps; parent owns separate failing-boundary Bug disposition and covering batch. No native acceptance, source fix or new intake.",
    "runtimeCreated": false,
    "scratchCreatedBytes": 0,
    "scratchRemovedBytes": 0,
    "oneDriveAccess": false,
    "publicationHygiene": "A helper import regenerated one pre-existing tracked 190,246-byte Python cache; the publication guard stopped before push, the cache was restored to HEAD, and subsequent imports disable bytecode. No generated file remains in the diff."
  }
}
```
