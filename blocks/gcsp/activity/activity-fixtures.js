// Generated synthetic snapshots. Regenerate through server/test/helpers/activity-fixtures.js.
export const activityFixtures = {
  "source": "Real BriefService and createActivityService; synthetic demo run; no search-check producer",
  "snapshots": {
    "never-checked": {
      "status": "ok",
      "value": {
        "asOf": "2026-11-05T09:00:00.000Z",
        "briefVersion": 1,
        "permission": {
          "searchConsent": true,
          "holdConsent": false,
          "paused": false,
          "permissionVersion": 1,
          "canSearch": true,
          "canHold": false
        },
        "state": "never-searched",
        "lastSuccessfulCheck": null,
        "searchEvidence": {
          "status": "not-recorded",
          "reason": "search-check-producer-unavailable"
        },
        "sourceStatus": "evidence-unavailable",
        "offers": [],
        "stateChanges": [
          {
            "eventId": "brief:employee-paula:1",
            "eventType": "brief-changed",
            "operation": "confirmed",
            "briefVersion": 1,
            "previousBriefVersion": null,
            "occurredAt": "2026-11-05T09:00:00.000Z"
          }
        ],
        "stateChangesEvidence": {
          "status": "recorded",
          "rejectedReceipts": 0
        }
      }
    },
    "paused": {
      "status": "ok",
      "value": {
        "asOf": "2026-11-05T09:00:00.000Z",
        "briefVersion": 2,
        "permission": {
          "searchConsent": true,
          "holdConsent": false,
          "paused": true,
          "permissionVersion": 2,
          "canSearch": false,
          "canHold": false
        },
        "state": "paused",
        "lastSuccessfulCheck": null,
        "searchEvidence": {
          "status": "not-recorded",
          "reason": "search-check-producer-unavailable"
        },
        "sourceStatus": "evidence-unavailable",
        "offers": [],
        "stateChanges": [
          {
            "eventId": "brief:employee-paula:1",
            "eventType": "brief-changed",
            "operation": "confirmed",
            "briefVersion": 1,
            "previousBriefVersion": null,
            "occurredAt": "2026-11-05T09:00:00.000Z"
          },
          {
            "eventId": "brief:employee-paula:2",
            "eventType": "brief-changed",
            "operation": "paused",
            "briefVersion": 2,
            "previousBriefVersion": 1,
            "occurredAt": "2026-11-05T09:00:00.000Z"
          }
        ],
        "stateChangesEvidence": {
          "status": "recorded",
          "rejectedReceipts": 0
        }
      }
    },
    "unavailable": {
      "status": "unavailable",
      "code": "synthetic-fixture-outage",
      "reason": "Activity could not be loaded.",
      "retryable": true,
      "contractVersion": "1.0.0"
    }
  }
};
