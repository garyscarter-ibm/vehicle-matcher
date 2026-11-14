# FUCQ-417 acceptance input identities

Observed 2026-11-14T15:45:42+00:00. Evidence reuse audit; no new test execution.

```json
{
  "observed_at": "2026-11-14T15:45:42+00:00",
  "story": "FUCQ-417",
  "current_head": "25b310fd6166bddef114255bc9081b7719fcf8d0",
  "current_tree": "160951c52b8c71185e50ccbce634f05ab46f34dd",
  "branch": "dev/DEV-2026-11-13-GC-010",
  "base_branch": "gcsp-poc-dev",
  "inbox_merge": "auto",
  "native_reuse": {
    "published_story": "_dev/done/2026-11/DEV-2026-11-13-GC-013.md",
    "tested_commit": "92382476207700a2f7d664da41e1258e0e993a91",
    "tested_tree": "370622a01ccd919f7c7f1994641b52fbb8892c62",
    "identities": {
      "server": {
        "tested": "3445158fa3a097e1d929a81dc79b079182eb1873",
        "current": "3445158fa3a097e1d929a81dc79b079182eb1873"
      },
      "package.json": {
        "tested": "e030f9478a3f6603f190ae1ed400d7a498e9455d",
        "current": "e030f9478a3f6603f190ae1ed400d7a498e9455d"
      },
      "package-lock.json": {
        "tested": "004dfb96eac323316200e3f4c1b7f9d4afcc0ab2",
        "current": "004dfb96eac323316200e3f4c1b7f9d4afcc0ab2"
      },
      "fixtures": {
        "tested": "5c6e5628c4b770314c3b4fd370f2ea29e27603d1",
        "current": "5c6e5628c4b770314c3b4fd370f2ea29e27603d1"
      },
      "_config": {
        "tested": "07c2e85535f4f664f754d1f4f874b6f0c0654d0e",
        "current": "07c2e85535f4f664f754d1f4f874b6f0c0654d0e"
      }
    },
    "published_report": "Native PostgreSQL17.12:124/124; allocation-runtime8/8 including native case; allocation-compact6/6; allocation23/23; consumption5/5 including native restart/uncertain claim. Peer report reused, raw logs not independently audited.",
    "raw_receipts_locally_available": {
      ".claude/test-runs/fucq420-2026-11-14/test-summary.txt": false,
      ".claude/test-runs/impact/8714ee6e41f49ad1.json": false
    },
    "new_native_run": false
  },
  "current_sha256": {
    "server/gcsp/recommendation/index.js": "870e4b6faf26f7d87b73eb2f359ed626ead2594647effd4ff9a448cbbc065902",
    "server/gcsp/allocation/index.js": "3eca8eebbb0071f316ab0d4dc5b8b4f0ccd9f2f54888954ac9cf82b5677f905e",
    "server/test/gcsp-allocation-runtime.test.js": "98af37411bbc4a768b1a8000ce4811aad10497129ca397ce4671eeb3f9ec1c74",
    "server/test/gcsp-allocation-compact.test.js": "f48fc6ed206b21fbded34b93b5ae49799c73c5597b734e5eb954494020e8e84e"
  },
  "connected_reuse": {
    "source": "cb5064ed3090ca61adf90c5ea1fb5accfb3fc250",
    "result": ".claude/test-runs/fucq415/henery-hawk/browser/result.json",
    "result_sha256": "72623bb973535879c8f50a76df53ee2b879f9768da2d6b74f49451b946ad5b5a",
    "checks": 42,
    "passing": 42,
    "presentation_identities": {
      "blocks": {
        "connected": "d461603d064a78504cdee2605ef39ce1fcee716a",
        "current": "d461603d064a78504cdee2605ef39ce1fcee716a"
      },
      "assets": {
        "connected": "fb30b145433d7760e743f7de80d5cecd8e34848c",
        "current": "fb30b145433d7760e743f7de80d5cecd8e34848c"
      },
      "scripts": {
        "connected": "d9fef37309094d29e33ab219684995d0bf6c6761",
        "current": "d9fef37309094d29e33ab219684995d0bf6c6761"
      },
      "gcsp-presenter.html": {
        "connected": "d891ab8d93a9fdd544ca241fdc52c29f972043c0",
        "current": "d891ab8d93a9fdd544ca241fdc52c29f972043c0"
      },
      "gcsp-offer.html": {
        "connected": "6df354f1e4395ea676d84fb7c40d80e348a42bdb",
        "current": "6df354f1e4395ea676d84fb7c40d80e348a42bdb"
      },
      "gcsp-activity-live.html": {
        "connected": "184fa45d20d83cb6792dfffcf75679ed7c328c13",
        "current": "184fa45d20d83cb6792dfffcf75679ed7c328c13"
      },
      "gcsp-employee.css": {
        "connected": "8dc07d15012356850c8bcbac6bd3ae09fc8a132d",
        "current": "8dc07d15012356850c8bcbac6bd3ae09fc8a132d"
      }
    },
    "component_catalogue_delta": "COMPONENTS.md only adds unrelated Angular preference/rating presenters; legacy rendered assets above are byte-identical.",
    "captures": [
      {
        "name": "no-match-history",
        "width": 1440,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/no-match-history-1440.png",
        "sha256": "4e96bc18c208201a173cdb7b207f0feeed50a19ecb4cf0cbfc0f5f7cd1769391"
      },
      {
        "name": "no-match-history",
        "width": 375,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/no-match-history-375.png",
        "sha256": "f57384d16a98569a5eb01b85ae4b37812688e3b769e1e770c8588433fb7d4aa3"
      },
      {
        "name": "release",
        "width": 1440,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/release-1440.png",
        "sha256": "9a6224f378e3cafd6710ba72fa434a77fac1013e75508c11a7df3956c261e6a1"
      },
      {
        "name": "release",
        "width": 375,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/release-375.png",
        "sha256": "5d442293f84f5262b3cb7c30bbf97b6ce36cd130bec27bf1e805cc3492b1d67d"
      },
      {
        "name": "pending-offer",
        "width": 1440,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/pending-offer-1440.png",
        "sha256": "98149a0195017ec4e38fe3ae9924ca51414bda5f4c8f0695a14dea3c1b3fb245"
      },
      {
        "name": "pending-offer",
        "width": 375,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/pending-offer-375.png",
        "sha256": "6540ac9b94b5c180b2a9fa25c3774f985c8177d1ed398c42c293aa667b251c18"
      },
      {
        "name": "conflict-replay-offer",
        "width": 1440,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/conflict-replay-offer-1440.png",
        "sha256": "51df864f888243f3f0372ee99112f30c6c52e9930705427816ccd1dcb4d13f20"
      },
      {
        "name": "conflict-replay-offer",
        "width": 375,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/conflict-replay-offer-375.png",
        "sha256": "acb901d32d29febc04282892fc8a968e53d289e09821d25d44ce2de4366f450d"
      },
      {
        "name": "accepted-history",
        "width": 1440,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/accepted-history-1440.png",
        "sha256": "22b51ecc8d61fce5e9726eecb775a6e5e65f7df244280fcc52a4498fe5219415"
      },
      {
        "name": "accepted-history",
        "width": 375,
        "path": ".claude/test-runs/fucq415/henery-hawk/browser/captures/accepted-history-375.png",
        "sha256": "b337e79da150a72b89bcc59eb711fdc30961e68dc5029b6aa3324b8fc27bd979"
      }
    ],
    "review": "Existing F415 lead and independent Cool Cat review reused; no new rendered inspection. API conflict/replay checks and resulting accepted display, not separately rendered conflict feedback."
  },
  "resource_disposition": "Evidence-only local reads/writes. No test runtime, cluster, browser, dependency copy, scratch, descendants or borrowed process allocated; no OneDrive access. Historical resource receipts retain their original observation times.",
  "map_preservation": {
    "foreign_rows_unchanged": 301,
    "prefix_sha256": "a7957ae615e3cc3ad917daeeff3225af3c2da28abb639e267548b18974c64a92",
    "suffix_sha256": "d740e94a3da8b72566a3391a960ab77dfede15ca3f438fa82fd32590f5adb0a3",
    "jira_observed_at_preserved": "2026-11-14T07:59:15.577Z",
    "native_status_preserved": "In Progress",
    "integration": "complete",
    "lead_worker_claim": "expired at evidence checkpoint; HOLD"
  }
}
```
