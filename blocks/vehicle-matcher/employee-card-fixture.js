// Generated display snapshot; shared-kit-contracts.test.js checks canonical policy equality.
export const employeeCardFixture = {
  "schemaVersion": 1,
  "source": "FUCQ-29 createEmployeeRecommendationService / rankCars",
  "evaluatedAt": "2026-11-05T12:00:00.000Z",
  "versions": {
    "brief": 1,
    "facts": "employee-facts-v1",
    "policy": "gcsp-policy-v1",
    "stock": "stock-v1",
    "clock": "clock-v1"
  },
  "members": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "identity": {
        "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000001",
        "orderUuid": "00000000-0000-4000-8000-000000000001",
        "configurationId": "RzIxOlMx"
      },
      "display": {
        "name": "BMW 320i M Sport Touring with Individual extended leather and comfort specification",
        "line": "Synthetic scheme stock",
        "pickerLabel": "Eligible exact car"
      },
      "media": {
        "src": "/assets/brand-hero/bmw.jpg",
        "alt": "Representative BMW brand image",
        "caption": "Representative BMW brand image, not this exact car"
      },
      "facts": [
        {
          "label": "Seats",
          "value": 5,
          "unit": "count",
          "missingLabel": "Not supplied (count)",
          "provenance": {
            "sourceRef": "fixture:employee",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "version": "facts-v1",
            "assurance": "synthetic-scenario"
          }
        },
        {
          "label": "Boot, seats up",
          "value": 500,
          "unit": "L",
          "missingLabel": "Not supplied (L)",
          "provenance": {
            "sourceRef": "fixture:employee",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "version": "facts-v1",
            "assurance": "synthetic-scenario"
          }
        },
        {
          "label": "Fuel",
          "value": "petrol",
          "unit": null,
          "missingLabel": "Not supplied",
          "provenance": {
            "sourceRef": "fixture:employee",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "version": "facts-v1",
            "assurance": "synthetic-scenario"
          }
        }
      ],
      "terms": [
        {
          "kind": "points-monthly",
          "value": 1100,
          "allowance": 1300,
          "provenance": {
            "sourceRef": "docs/gcsp/shared-contracts.md",
            "version": "gcsp-policy-v1",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "assurance": "synthetic-scenario"
          }
        }
      ],
      "decision": {
        "gateStatus": "eligible",
        "score": 100,
        "reasons": [
          {
            "code": "driver-eligible",
            "fact": {
              "status": "known",
              "value": true,
              "unit": null,
              "provenance": {
                "sourceRef": "fixture:employee",
                "observedAt": "2026-11-05T12:00:00.000Z",
                "version": "facts-v1",
                "assurance": "synthetic-scenario"
              }
            },
            "text": "Driver eligibility confirmed for this synthetic example."
          },
          {
            "code": "policy-include",
            "ruleIds": [
              "choices-fs-uk-015-include"
            ],
            "text": "This exact model is included in the scheme policy."
          },
          {
            "code": "allowance-sufficient",
            "allowance": 1300,
            "monthlyPoints": 1100,
            "unit": "points/month",
            "text": "The monthly points cost is within your allowance."
          },
          {
            "code": "essential-met",
            "field": "seats",
            "requirement": {
              "value": 5,
              "operator": "gte",
              "unit": "count",
              "state": "confirmed",
              "source": "employee"
            },
            "fact": {
              "status": "known",
              "value": 5,
              "unit": "count",
              "provenance": {
                "sourceRef": "fixture:employee",
                "observedAt": "2026-11-05T12:00:00.000Z",
                "version": "facts-v1",
                "assurance": "synthetic-scenario"
              }
            },
            "text": "The exact car meets this confirmed essential."
          },
          {
            "code": "required-by-met",
            "requiredBy": "2026-12-01T00:00:00.000Z",
            "text": "Available by your required date."
          },
          {
            "code": "preference-fit",
            "field": "body",
            "score": 100,
            "importance": 100,
            "desired": "estate",
            "observed": 100,
            "facts": {
              "body": {
                "status": "known",
                "value": "estate",
                "unit": null,
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              }
            },
            "text": "preference fit"
          }
        ],
        "blockers": [],
        "unknowns": [],
        "tradeOffs": [],
        "versions": {
          "brief": 1,
          "facts": "employee-facts-v1",
          "policy": "gcsp-policy-v1",
          "stock": "stock-v1",
          "snapshot": "snapshot-v1",
          "terms": "gcsp-policy-v1:price.choices-fs-uk.015:allowance.choices-fs-uk.G7:2026-11-05T12:00:00.000Z",
          "clock": "clock-v1",
          "availability": "availability-v1"
        }
      },
      "actions": [
        {
          "id": "inspect",
          "kind": "select",
          "label": "Select for this preview",
          "variant": "ghost"
        },
        {
          "id": "feedback",
          "kind": "feedback",
          "label": "Not this one",
          "variant": "ghost",
          "scope": "This exact car in the local gallery only."
        },
        {
          "id": "reserve",
          "kind": "reserve",
          "label": "Reserve",
          "disabled": true,
          "disabledReason": "Reserving is not part of this preview"
        }
      ]
    },
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "identity": {
        "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000002",
        "orderUuid": "00000000-0000-4000-8000-000000000002",
        "configurationId": "RzIxOlMx"
      },
      "display": {
        "name": "BMW 320i Touring with four confirmed seats (synthetic)",
        "line": "Synthetic scheme stock",
        "pickerLabel": "Ineligible exact car"
      },
      "media": {},
      "facts": [
        {
          "label": "Seats",
          "value": 4,
          "unit": "count",
          "missingLabel": "Not supplied (count)",
          "provenance": {
            "sourceRef": "fixture:employee",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "version": "facts-v1",
            "assurance": "synthetic-scenario"
          }
        },
        {
          "label": "Boot, seats up",
          "value": 500,
          "unit": "L",
          "missingLabel": "Not supplied (L)",
          "provenance": {
            "sourceRef": "fixture:employee",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "version": "facts-v1",
            "assurance": "synthetic-scenario"
          }
        },
        {
          "label": "Fuel",
          "value": "petrol",
          "unit": null,
          "missingLabel": "Not supplied",
          "provenance": {
            "sourceRef": "fixture:employee",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "version": "facts-v1",
            "assurance": "synthetic-scenario"
          }
        }
      ],
      "terms": [
        {
          "kind": "points-monthly",
          "value": 1100,
          "allowance": 1300,
          "provenance": {
            "sourceRef": "docs/gcsp/shared-contracts.md",
            "version": "gcsp-policy-v1",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "assurance": "synthetic-scenario"
          }
        }
      ],
      "decision": {
        "gateStatus": "ineligible",
        "score": null,
        "reasons": [
          {
            "code": "driver-eligible",
            "fact": {
              "status": "known",
              "value": true,
              "unit": null,
              "provenance": {
                "sourceRef": "fixture:employee",
                "observedAt": "2026-11-05T12:00:00.000Z",
                "version": "facts-v1",
                "assurance": "synthetic-scenario"
              }
            },
            "text": "Driver eligibility confirmed for this synthetic example."
          },
          {
            "code": "policy-include",
            "ruleIds": [
              "choices-fs-uk-015-include"
            ],
            "text": "This exact model is included in the scheme policy."
          },
          {
            "code": "allowance-sufficient",
            "allowance": 1300,
            "monthlyPoints": 1100,
            "unit": "points/month",
            "text": "The monthly points cost is within your allowance."
          },
          {
            "code": "required-by-met",
            "requiredBy": "2026-12-01T00:00:00.000Z",
            "text": "Available by your required date."
          }
        ],
        "blockers": [
          {
            "code": "essential-unmet",
            "field": "seats",
            "requirement": {
              "value": 5,
              "operator": "gte",
              "unit": "count",
              "state": "confirmed",
              "source": "employee"
            },
            "fact": {
              "status": "known",
              "value": 4,
              "unit": "count",
              "provenance": {
                "sourceRef": "fixture:employee",
                "observedAt": "2026-11-05T12:00:00.000Z",
                "version": "facts-v1",
                "assurance": "synthetic-scenario"
              }
            },
            "text": "The exact car does not meet your confirmed seating requirement."
          }
        ],
        "unknowns": [],
        "tradeOffs": [],
        "versions": {
          "brief": 1,
          "facts": "employee-facts-v1",
          "policy": "gcsp-policy-v1",
          "stock": "stock-v1",
          "snapshot": "snapshot-v1",
          "terms": "gcsp-policy-v1:price.choices-fs-uk.015:allowance.choices-fs-uk.G7:2026-11-05T12:00:00.000Z",
          "clock": "clock-v1",
          "availability": "availability-v1"
        }
      },
      "actions": [
        {
          "id": "inspect",
          "kind": "select",
          "label": "Select for this preview",
          "variant": "ghost"
        },
        {
          "id": "feedback",
          "kind": "feedback",
          "label": "Not this one",
          "variant": "ghost",
          "scope": "This exact car in the local gallery only."
        },
        {
          "id": "reserve",
          "kind": "reserve",
          "label": "Reserve",
          "disabled": true,
          "disabledReason": "Reserving is not part of this preview"
        }
      ]
    },
    {
      "id": "00000000-0000-4000-8000-000000000003",
      "identity": {
        "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000003",
        "orderUuid": "00000000-0000-4000-8000-000000000003",
        "configurationId": "RzIxOlMx"
      },
      "display": {
        "name": "BMW 320i Touring with unconfirmed seating and luggage capacity",
        "line": "Synthetic scheme stock",
        "pickerLabel": "Needs confirmation"
      },
      "media": {},
      "facts": [
        {
          "label": "Seats",
          "value": null,
          "unit": "count",
          "missingLabel": "Not supplied (count)",
          "provenance": {
            "sourceRef": "fixture:employee",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "version": "facts-v1",
            "assurance": "unknown"
          }
        },
        {
          "label": "Boot, seats up",
          "value": null,
          "unit": "L",
          "missingLabel": "Not supplied (L)",
          "provenance": {
            "sourceRef": "fixture:employee",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "version": "facts-v1",
            "assurance": "unknown"
          }
        },
        {
          "label": "Fuel",
          "value": "petrol",
          "unit": null,
          "missingLabel": "Not supplied",
          "provenance": {
            "sourceRef": "fixture:employee",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "version": "facts-v1",
            "assurance": "synthetic-scenario"
          }
        }
      ],
      "terms": [
        {
          "kind": "points-monthly",
          "value": 1100,
          "allowance": 1300,
          "provenance": {
            "sourceRef": "docs/gcsp/shared-contracts.md",
            "version": "gcsp-policy-v1",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "assurance": "synthetic-scenario"
          }
        }
      ],
      "decision": {
        "gateStatus": "needs-confirmation",
        "score": null,
        "reasons": [
          {
            "code": "driver-eligible",
            "fact": {
              "status": "known",
              "value": true,
              "unit": null,
              "provenance": {
                "sourceRef": "fixture:employee",
                "observedAt": "2026-11-05T12:00:00.000Z",
                "version": "facts-v1",
                "assurance": "synthetic-scenario"
              }
            },
            "text": "Driver eligibility confirmed for this synthetic example."
          },
          {
            "code": "policy-include",
            "ruleIds": [
              "choices-fs-uk-015-include"
            ],
            "text": "This exact model is included in the scheme policy."
          },
          {
            "code": "allowance-sufficient",
            "allowance": 1300,
            "monthlyPoints": 1100,
            "unit": "points/month",
            "text": "The monthly points cost is within your allowance."
          },
          {
            "code": "required-by-met",
            "requiredBy": "2026-12-01T00:00:00.000Z",
            "text": "Available by your required date."
          }
        ],
        "blockers": [],
        "unknowns": [
          {
            "code": "essential-unconfirmed",
            "field": "seats",
            "requirement": {
              "value": 5,
              "operator": "gte",
              "unit": "count",
              "state": "confirmed",
              "source": "employee"
            },
            "fact": {
              "status": "unknown",
              "value": null,
              "unit": "count",
              "provenance": {
                "sourceRef": "fixture:employee",
                "observedAt": "2026-11-05T12:00:00.000Z",
                "version": "facts-v1",
                "assurance": "unknown"
              }
            },
            "text": "The exact number of seats needs confirmation."
          }
        ],
        "tradeOffs": [],
        "versions": {
          "brief": 1,
          "facts": "employee-facts-v1",
          "policy": "gcsp-policy-v1",
          "stock": "stock-v1",
          "snapshot": "snapshot-v1",
          "terms": "gcsp-policy-v1:price.choices-fs-uk.015:allowance.choices-fs-uk.G7:2026-11-05T12:00:00.000Z",
          "clock": "clock-v1",
          "availability": "availability-v1"
        }
      },
      "actions": [
        {
          "id": "inspect",
          "kind": "select",
          "label": "Select for this preview",
          "variant": "ghost"
        },
        {
          "id": "feedback",
          "kind": "feedback",
          "label": "Not this one",
          "variant": "ghost",
          "scope": "This exact car in the local gallery only."
        },
        {
          "id": "reserve",
          "kind": "reserve",
          "label": "Reserve",
          "disabled": true,
          "disabledReason": "Reserving is not part of this preview"
        }
      ]
    }
  ]
};
