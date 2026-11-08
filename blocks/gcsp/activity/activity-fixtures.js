// Generated synthetic snapshots. Regenerate through server/test/helpers/activity-fixtures.js.
export const activityFixtures = {
  "source": "Real BriefService and createActivityService over stored rows of the real shapes; synthetic demo run",
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
          "reason": "no-search-check-yet"
        },
        "sourceStatus": "not-checked",
        "currentOffer": null,
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
          "reason": "no-search-check-yet"
        },
        "sourceStatus": "not-checked",
        "currentOffer": null,
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
    "searching": {
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
        "state": "searching",
        "lastSuccessfulCheck": {
          "checkedAt": "2026-11-04T23:30:00.000Z",
          "clockVersion": "3",
          "carsChecked": 12,
          "suitableCars": 0,
          "exclusions": [],
          "outcome": "no-match"
        },
        "searchEvidence": {
          "status": "recorded",
          "checks": 1
        },
        "sourceStatus": "ok",
        "currentOffer": null,
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
    "no-match-one": {
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
        "state": "searching",
        "lastSuccessfulCheck": {
          "checkedAt": "2026-11-04T23:30:00.000Z",
          "clockVersion": "3",
          "carsChecked": 12,
          "suitableCars": 0,
          "exclusions": [
            {
              "essential": "seats",
              "requirement": {
                "operator": "gte",
                "unit": "count",
                "value": 5
              },
              "cars": 12
            }
          ],
          "outcome": "no-match"
        },
        "searchEvidence": {
          "status": "recorded",
          "checks": 1
        },
        "sourceStatus": "ok",
        "currentOffer": null,
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
    "no-match-two": {
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
        "state": "searching",
        "lastSuccessfulCheck": {
          "checkedAt": "2026-11-04T23:30:00.000Z",
          "clockVersion": "3",
          "carsChecked": 12,
          "suitableCars": 0,
          "exclusions": [
            {
              "essential": "seats",
              "requirement": {
                "operator": "gte",
                "unit": "count",
                "value": 5
              },
              "cars": 9
            },
            {
              "essential": "boot",
              "requirement": {
                "operator": "gte",
                "unit": "L",
                "value": 430
              },
              "cars": 6
            }
          ],
          "outcome": "no-match"
        },
        "searchEvidence": {
          "status": "recorded",
          "checks": 1
        },
        "sourceStatus": "ok",
        "currentOffer": null,
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
    "offer": {
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
        "state": "offer",
        "lastSuccessfulCheck": {
          "checkedAt": "2026-11-04T23:30:00.000Z",
          "clockVersion": "3",
          "carsChecked": 12,
          "suitableCars": 3,
          "exclusions": [],
          "outcome": "offer-held"
        },
        "searchEvidence": {
          "status": "recorded",
          "checks": 1
        },
        "sourceStatus": "ok",
        "currentOffer": {
          "offerRef": {
            "offerId": "layout-offer"
          },
          "state": "active",
          "version": 1,
          "briefVersion": 1,
          "holdId": "layout-hold",
          "policyVersion": "gcsp-policy-v1",
          "quoteId": "layout-quote",
          "expiresAt": "2026-11-06T09:00:00.000Z",
          "href": "/gcsp/offer?offerId=layout-offer&runId=demo-e1337bd406777d5ff83066260d60fe4e"
        },
        "offers": [
          {
            "offerRef": {
              "offerId": "layout-offer"
            },
            "state": "active",
            "version": 1,
            "briefVersion": 1,
            "holdId": "layout-hold",
            "policyVersion": "gcsp-policy-v1",
            "quoteId": "layout-quote",
            "expiresAt": "2026-11-06T09:00:00.000Z"
          }
        ],
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
    "offer-declined": {
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
        "state": "offer-closed",
        "lastSuccessfulCheck": {
          "checkedAt": "2026-11-04T23:30:00.000Z",
          "clockVersion": "3",
          "carsChecked": 12,
          "suitableCars": 0,
          "exclusions": [],
          "outcome": "no-match"
        },
        "searchEvidence": {
          "status": "recorded",
          "checks": 1
        },
        "sourceStatus": "ok",
        "currentOffer": {
          "offerRef": {
            "offerId": "layout-offer"
          },
          "state": "rejected",
          "version": 1,
          "briefVersion": 1,
          "holdId": "layout-hold",
          "policyVersion": "gcsp-policy-v1",
          "quoteId": "layout-quote",
          "expiresAt": "2026-11-06T09:00:00.000Z",
          "href": "/gcsp/offer?offerId=layout-offer&runId=demo-e1337bd406777d5ff83066260d60fe4e"
        },
        "offers": [
          {
            "offerRef": {
              "offerId": "layout-offer"
            },
            "state": "rejected",
            "version": 1,
            "briefVersion": 1,
            "holdId": "layout-hold",
            "policyVersion": "gcsp-policy-v1",
            "quoteId": "layout-quote",
            "expiresAt": "2026-11-06T09:00:00.000Z"
          }
        ],
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
    "offer-expired": {
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
        "state": "offer-closed",
        "lastSuccessfulCheck": {
          "checkedAt": "2026-11-04T23:30:00.000Z",
          "clockVersion": "3",
          "carsChecked": 12,
          "suitableCars": 0,
          "exclusions": [],
          "outcome": "no-match"
        },
        "searchEvidence": {
          "status": "recorded",
          "checks": 1
        },
        "sourceStatus": "ok",
        "currentOffer": {
          "offerRef": {
            "offerId": "layout-offer"
          },
          "state": "expired",
          "version": 1,
          "briefVersion": 1,
          "holdId": "layout-hold",
          "policyVersion": "gcsp-policy-v1",
          "quoteId": "layout-quote",
          "expiresAt": "2026-11-04T22:00:00.000Z",
          "href": "/gcsp/offer?offerId=layout-offer&runId=demo-e1337bd406777d5ff83066260d60fe4e"
        },
        "offers": [
          {
            "offerRef": {
              "offerId": "layout-offer"
            },
            "state": "expired",
            "version": 1,
            "briefVersion": 1,
            "holdId": "layout-hold",
            "policyVersion": "gcsp-policy-v1",
            "quoteId": "layout-quote",
            "expiresAt": "2026-11-04T22:00:00.000Z"
          }
        ],
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
    "paused-offer": {
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
        "lastSuccessfulCheck": {
          "checkedAt": "2026-11-04T23:30:00.000Z",
          "clockVersion": "3",
          "carsChecked": 12,
          "suitableCars": 3,
          "exclusions": [],
          "outcome": "offer-held"
        },
        "searchEvidence": {
          "status": "recorded",
          "checks": 1
        },
        "sourceStatus": "ok",
        "currentOffer": {
          "offerRef": {
            "offerId": "layout-offer"
          },
          "state": "active",
          "version": 1,
          "briefVersion": 1,
          "holdId": "layout-hold",
          "policyVersion": "gcsp-policy-v1",
          "quoteId": "layout-quote",
          "expiresAt": "2026-11-06T09:00:00.000Z",
          "href": "/gcsp/offer?offerId=layout-offer&runId=demo-e1337bd406777d5ff83066260d60fe4e"
        },
        "offers": [
          {
            "offerRef": {
              "offerId": "layout-offer"
            },
            "state": "active",
            "version": 1,
            "briefVersion": 1,
            "holdId": "layout-hold",
            "policyVersion": "gcsp-policy-v1",
            "quoteId": "layout-quote",
            "expiresAt": "2026-11-06T09:00:00.000Z"
          }
        ],
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
    "source-delayed": {
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
        "state": "searching",
        "lastSuccessfulCheck": {
          "checkedAt": "2026-11-04T23:30:00.000Z",
          "clockVersion": "3",
          "carsChecked": 12,
          "suitableCars": 0,
          "exclusions": [],
          "outcome": "no-match"
        },
        "searchEvidence": {
          "status": "recorded",
          "checks": 1
        },
        "sourceStatus": "delayed",
        "currentOffer": null,
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
    "source-unavailable": {
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
        "state": "searching",
        "lastSuccessfulCheck": {
          "checkedAt": "2026-11-04T23:30:00.000Z",
          "clockVersion": "3",
          "carsChecked": 12,
          "suitableCars": 0,
          "exclusions": [],
          "outcome": "no-match"
        },
        "searchEvidence": {
          "status": "recorded",
          "checks": 1
        },
        "sourceStatus": "unavailable",
        "currentOffer": null,
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
    "unavailable": {
      "status": "unavailable",
      "reason": "Identity service is unavailable.",
      "retryable": true,
      "contractVersion": "1.0.0"
    }
  },
  "offerExample": {
    "offerRef": {
      "offerId": "layout-offer"
    },
    "title": "Your BMW offer",
    "images": [
      {
        "src": "/assets/brand-hero/bmw.jpg",
        "alt": "BMW brand photograph, representative of the brand rather than this offer",
        "kind": "representative"
      }
    ]
  }
};
