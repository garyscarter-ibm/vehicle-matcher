// Captured from gcsp-buddy-handoff.test.js offered/acceptInput with real in-memory decision/ordering producers.
// Shared subtrees preserve the captured payloads exactly; pending records an unknown provider outcome.
const acknowledged = {
  "state": "acknowledged",
  "input": {
    "commandId": "accept-1",
    "runId": "demo-b6c7f3a31036d9e989f8a979c20a9451",
    "offerId": "buddy-offer:4ba032f79a564686bcf00b6fb1a943ccc518de038335710858ecb55fed731697",
    "decision": "accept",
    "expectedOfferVersion": 1,
    "expectedHoldVersion": 1,
    "expectedQuoteVersion": 1,
    "termsDigest": "043929a16220825140ac89033524232a49b85bdc79b7cf2e5711fdb43e1c3675",
    "declarations": {
      "terms": true,
      "driver": true,
      "return": true
    },
    "expectedReturnMileage": 6100
  },
  "receipt": {
    "schemaVersion": 1,
    "runId": "demo-b6c7f3a31036d9e989f8a979c20a9451",
    "offerId": "buddy-offer:4ba032f79a564686bcf00b6fb1a943ccc518de038335710858ecb55fed731697",
    "commandId": "accept-1",
    "requestedDecision": "accept",
    "state": "accepted",
    "reason": "accepted",
    "offerState": "accepted",
    "holdState": "allocated",
    "offerVersion": 2,
    "holdVersion": 2,
    "quoteVersion": 1,
    "quoteId": "buddy-quote:4ba032f79a564686bcf00b6fb1a943ccc518de038335710858ecb55fed731697",
    "policyVersion": "gcsp-policy-v1",
    "expiresAt": "2026-11-05T14:00:00.000Z",
    "serverNow": "2026-11-05T12:00:00.000Z",
    "clockVersion": "2",
    "availableActions": [],
    "operationId": null,
    "reconciliationRequired": false,
    "decisionId": "offer-decision:4e8118c83a8e90519ca5034443d12906e593a4527e15ee4d1cf274bfdf6be7cd",
    "selection": {
      "schemaVersion": 1,
      "operationId": "selection:d4c06073fd0ba1ae707f284ef301a8a201b85145b4c7f8724f7826c688a5174c",
      "operationState": "acknowledged",
      "selectionReceived": true,
      "orderReference": "GCSP-000001",
      "selection": {
        "schemaVersion": 1,
        "orderReference": "GCSP-000001",
        "receivedAt": "2026-11-05T12:00:00.000Z",
        "renewalId": "renewal:employee-paula",
        "source": {
          "type": "buddy-offer",
          "holdId": "buddy-hold:4ba032f79a564686bcf00b6fb1a943ccc518de038335710858ecb55fed731697",
          "expectedHoldVersion": 1,
          "expectedDraftVersion": 1
        },
        "quote": {
          "runId": "demo-b6c7f3a31036d9e989f8a979c20a9451",
          "quoteId": "buddy-quote:4ba032f79a564686bcf00b6fb1a943ccc518de038335710858ecb55fed731697",
          "orderUuid": "00000000-0000-4000-8000-000000000011",
          "employeeId": "employee-paula",
          "entitlementSlotId": "slot-paula",
          "configurationId": "RjcwOlMx",
          "facts": {
            "contractVersion": "vehicle-snapshot-v1",
            "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000011",
            "sourceNamespace": "fixture:employee",
            "identityKind": "exact-stock",
            "sourceKeys": {
              "stockId": "00000000-0000-4000-8000-000000000011"
            },
            "snapshotVersion": "snapshot-v1",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "display": {
              "name": "Synthetic exact car 11"
            },
            "facts": {
              "eligibilityModelKey": {
                "status": "known",
                "value": "F70 Sports Hatch|120",
                "unit": null,
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "body": {
                "status": "known",
                "value": "hatch",
                "unit": null,
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "fuel": {
                "status": "known",
                "value": "petrol",
                "unit": null,
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "seats": {
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
              "boot": {
                "status": "known",
                "value": 380,
                "unit": "L",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "zeroTo62": {
                "status": "known",
                "value": 7,
                "unit": "s",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "mpg": {
                "status": "known",
                "value": 45,
                "unit": "mpg-imperial",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "sizeClass": {
                "status": "known",
                "value": 2,
                "unit": "ordinal-1-5",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "tags": {
                "status": "known",
                "value": [
                  "cruiser"
                ],
                "unit": null,
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "insuranceGroup": {
                "status": "known",
                "value": 25,
                "unit": "insurance-group",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              }
            }
          },
          "eligibility": {
            "eligible": true,
            "state": "eligible",
            "ruleIds": [
              "choices-fs-uk-001-include"
            ],
            "reasons": [
              "explicit-include"
            ],
            "provenance": {
              "rules": [
                {
                  "key": "choices-fs-uk-001-include",
                  "value": "F70 Sports Hatch|120",
                  "unit": "model/engine key",
                  "status": "verified",
                  "basis": "Transcribed FS&UK Choices Vehicle Eligibility Matrix: F70 Sports Hatch, 120; source grade-band decisions only. Key mapping is a demo assumption.",
                  "source": "docs/gcsp/sources/choices-eligibility-matrices-2024-10.md",
                  "sourceDate": "2024-07-29",
                  "policyVersion": "gcsp-policy-v1",
                  "effectiveFrom": "2024-10-01T00:00:00.000Z",
                  "ruleId": "choices-fs-uk-001-include",
                  "effect": "include",
                  "matchField": "eligibilityModelKey",
                  "operator": "equals",
                  "gradeIds": [
                    "G1-6",
                    "G7",
                    "G8-10",
                    "G11-14"
                  ],
                  "model": "F70 Sports Hatch",
                  "engine": "120"
                }
              ],
              "schemeRuleLinks": [
                {
                  "key": "link-choices-fs-uk-001-include",
                  "value": "choices-fs-uk-001-include",
                  "unit": "rule reference",
                  "status": "verified",
                  "basis": "Dated link to the supplied FS&UK Choices Vehicle Eligibility Matrix; effective 1 October 2024.",
                  "source": "docs/gcsp/sources/choices-eligibility-matrices-2024-10.md",
                  "sourceDate": "2024-07-29",
                  "policyVersion": "gcsp-policy-v1",
                  "effectiveFrom": "2024-10-01T00:00:00.000Z",
                  "linkId": "link-choices-fs-uk-001-include",
                  "schemeId": "choices-fs-uk",
                  "ruleId": "choices-fs-uk-001-include"
                }
              ],
              "assumptions": [
                {
                  "key": "eligibility.rule.matchField",
                  "value": "eligibilityModelKey",
                  "unit": "field name",
                  "status": "assumed",
                  "basis": "Assumed bridge of retained series/model/engine labels to matrix rows, since target matching code is undefined (round-3). Exact mapping is versioned/provenanced in the seed; unknown mapping fails.",
                  "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                  "sourceDate": "2026-11-04",
                  "policyVersion": "gcsp-policy-v1",
                  "effectiveFrom": "2026-11-04T00:00:00.000Z"
                },
                {
                  "key": "eligibility.rule.precedence",
                  "value": "excludeThenInclude",
                  "unit": "enum",
                  "status": "assumed",
                  "basis": "Assumed deterministic include/exclude evaluation; unknowns cannot widen eligibility.",
                  "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                  "sourceDate": "2026-11-04",
                  "policyVersion": "gcsp-policy-v1",
                  "effectiveFrom": "2026-11-04T00:00:00.000Z"
                },
                {
                  "key": "eligibility.context.mapping",
                  "value": [
                    {
                      "schemeId": "choices-fs-uk",
                      "companyId": "demo-bmw-fs-uk",
                      "sourceMatrix": "FS&UK Choices Vehicle Eligibility Matrix",
                      "gradeIds": [
                        "G1-6",
                        "G7",
                        "G8-10",
                        "G11-14"
                      ]
                    },
                    {
                      "schemeId": "choices-rr-production",
                      "companyId": "demo-bmw-rr-production",
                      "sourceMatrix": "RR&Production Choices Vehicle Eligibility Matrix",
                      "gradeIds": [
                        "PG1",
                        "G8-10",
                        "G11-12"
                      ]
                    }
                  ],
                  "unit": "identifier mapping",
                  "status": "assumed",
                  "basis": "Demo scheme/company IDs and source grade bands preserve actual FS&UK and RR&Production matrices. RR&Production is not equated with UKNSC. eligibilityModelKey is exact source model + | + one source engine token; comma/slash alternatives expand without inventing engine prefixes.",
                  "source": "docs/gcsp/sources/choices-eligibility-matrices-2024-10.md",
                  "sourceDate": "2026-11-04",
                  "policyVersion": "gcsp-policy-v1",
                  "effectiveFrom": "2026-11-04T00:00:00.000Z"
                }
              ]
            },
            "decision": {
              "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000011",
              "orderUuid": "00000000-0000-4000-8000-000000000011",
              "configurationId": "RjcwOlMx",
              "gateStatus": "eligible",
              "suitable": true,
              "evaluatedAt": "2026-11-05T12:00:00.000Z",
              "score": 0,
              "components": [
                {
                  "code": "preference-fit",
                  "field": "body",
                  "score": 0,
                  "importance": 100,
                  "desired": "estate",
                  "observed": 0,
                  "facts": {
                    "body": {
                      "status": "known",
                      "value": "hatch",
                      "unit": null,
                      "provenance": {
                        "sourceRef": "fixture:employee",
                        "observedAt": "2026-11-05T12:00:00.000Z",
                        "version": "facts-v1",
                        "assurance": "synthetic-scenario"
                      }
                    }
                  }
                }
              ],
              "reasons": [
                {
                  "code": "driver-eligible",
                  "fact": {
                    "status": "known",
                    "value": true,
                    "unit": null,
                    "provenance": {
                      "sourceRef": "fixture:manual-records-v1",
                      "version": "manual-records-v1",
                      "observedAt": "2026-11-05T09:00:00.000Z",
                      "assurance": "synthetic-scenario"
                    }
                  }
                },
                {
                  "code": "policy-include",
                  "ruleIds": [
                    "choices-fs-uk-001-include"
                  ]
                },
                {
                  "code": "allowance-sufficient",
                  "allowance": 1300,
                  "monthlyPoints": 800,
                  "unit": "points/month"
                },
                {
                  "code": "essential-met",
                  "field": "seats",
                  "requirement": {
                    "value": 5,
                    "operator": "gte",
                    "unit": "count",
                    "state": "confirmed",
                    "source": "employee",
                    "confirmedAt": "2026-11-05T12:00:00.000Z"
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
                  }
                },
                {
                  "code": "required-by-met",
                  "requiredBy": "2026-12-01T23:59:59.999Z"
                }
              ],
              "tradeOffs": [
                {
                  "code": "preference-fit",
                  "field": "body",
                  "score": 0,
                  "importance": 100,
                  "desired": "estate",
                  "observed": 0,
                  "facts": {
                    "body": {
                      "status": "known",
                      "value": "hatch",
                      "unit": null,
                      "provenance": {
                        "sourceRef": "fixture:employee",
                        "observedAt": "2026-11-05T12:00:00.000Z",
                        "version": "facts-v1",
                        "assurance": "synthetic-scenario"
                      }
                    }
                  }
                }
              ],
              "blockers": [],
              "unknowns": [],
              "snapshot": {
                "contractVersion": "vehicle-snapshot-v1",
                "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000011",
                "sourceNamespace": "fixture:employee",
                "identityKind": "exact-stock",
                "sourceKeys": {
                  "stockId": "00000000-0000-4000-8000-000000000011"
                },
                "snapshotVersion": "snapshot-v1",
                "observedAt": "2026-11-05T12:00:00.000Z",
                "display": {
                  "name": "Synthetic exact car 11"
                },
                "facts": {
                  "eligibilityModelKey": {
                    "status": "known",
                    "value": "F70 Sports Hatch|120",
                    "unit": null,
                    "provenance": {
                      "sourceRef": "fixture:employee",
                      "observedAt": "2026-11-05T12:00:00.000Z",
                      "version": "facts-v1",
                      "assurance": "synthetic-scenario"
                    }
                  },
                  "body": {
                    "status": "known",
                    "value": "hatch",
                    "unit": null,
                    "provenance": {
                      "sourceRef": "fixture:employee",
                      "observedAt": "2026-11-05T12:00:00.000Z",
                      "version": "facts-v1",
                      "assurance": "synthetic-scenario"
                    }
                  },
                  "fuel": {
                    "status": "known",
                    "value": "petrol",
                    "unit": null,
                    "provenance": {
                      "sourceRef": "fixture:employee",
                      "observedAt": "2026-11-05T12:00:00.000Z",
                      "version": "facts-v1",
                      "assurance": "synthetic-scenario"
                    }
                  },
                  "seats": {
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
                  "boot": {
                    "status": "known",
                    "value": 380,
                    "unit": "L",
                    "provenance": {
                      "sourceRef": "fixture:employee",
                      "observedAt": "2026-11-05T12:00:00.000Z",
                      "version": "facts-v1",
                      "assurance": "synthetic-scenario"
                    }
                  },
                  "zeroTo62": {
                    "status": "known",
                    "value": 7,
                    "unit": "s",
                    "provenance": {
                      "sourceRef": "fixture:employee",
                      "observedAt": "2026-11-05T12:00:00.000Z",
                      "version": "facts-v1",
                      "assurance": "synthetic-scenario"
                    }
                  },
                  "mpg": {
                    "status": "known",
                    "value": 45,
                    "unit": "mpg-imperial",
                    "provenance": {
                      "sourceRef": "fixture:employee",
                      "observedAt": "2026-11-05T12:00:00.000Z",
                      "version": "facts-v1",
                      "assurance": "synthetic-scenario"
                    }
                  },
                  "sizeClass": {
                    "status": "known",
                    "value": 2,
                    "unit": "ordinal-1-5",
                    "provenance": {
                      "sourceRef": "fixture:employee",
                      "observedAt": "2026-11-05T12:00:00.000Z",
                      "version": "facts-v1",
                      "assurance": "synthetic-scenario"
                    }
                  },
                  "tags": {
                    "status": "known",
                    "value": [
                      "cruiser"
                    ],
                    "unit": null,
                    "provenance": {
                      "sourceRef": "fixture:employee",
                      "observedAt": "2026-11-05T12:00:00.000Z",
                      "version": "facts-v1",
                      "assurance": "synthetic-scenario"
                    }
                  },
                  "insuranceGroup": {
                    "status": "known",
                    "value": 25,
                    "unit": "insurance-group",
                    "provenance": {
                      "sourceRef": "fixture:employee",
                      "observedAt": "2026-11-05T12:00:00.000Z",
                      "version": "facts-v1",
                      "assurance": "synthetic-scenario"
                    }
                  }
                }
              },
              "terms": {
                "termsVersion": "gcsp-policy-v1:price.choices-fs-uk.001:allowance.choices-fs-uk.G7:2026-11-05T12:00:00.000Z",
                "points": {
                  "value": 800,
                  "unit": "points"
                },
                "allowanceInputs": {
                  "allowance": {
                    "value": 1300,
                    "unit": "points"
                  }
                },
                "contribution": null,
                "validFrom": "2026-11-05T12:00:00.000Z",
                "validUntil": "2026-11-05T14:00:00.000Z",
                "provenance": {
                  "sourceRef": "docs/gcsp/shared-contracts.md",
                  "version": "gcsp-policy-v1",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "assurance": "synthetic-scenario"
                },
                "kind": "employee-scheme"
              },
              "brief": {
                "schemaVersion": 1,
                "briefVersion": 1,
                "preferences": {
                  "body": {
                    "value": "estate",
                    "importance": 100,
                    "valueState": "confirmed",
                    "importanceState": "confirmed",
                    "source": "employee",
                    "confirmedAt": "2026-11-05T12:00:00.000Z"
                  }
                },
                "essentials": {
                  "seats": {
                    "value": 5,
                    "operator": "gte",
                    "unit": "count",
                    "state": "confirmed",
                    "source": "employee",
                    "confirmedAt": "2026-11-05T12:00:00.000Z"
                  }
                }
              },
              "employeeFacts": {
                "essentials": {},
                "charging": {
                  "status": "unknown",
                  "value": null,
                  "unit": null,
                  "provenance": {
                    "sourceRef": "brief:unresolved",
                    "version": "1",
                    "observedAt": "2026-11-05T12:00:00.000Z",
                    "assurance": "synthetic-scenario"
                  }
                },
                "requiredBy": {
                  "status": "known",
                  "value": "2026-12-01T23:59:59.999Z",
                  "unit": null,
                  "provenance": {
                    "sourceRef": "fixture:manual-records-v1",
                    "version": "manual-records-v1",
                    "observedAt": "2026-11-05T09:00:00.000Z",
                    "assurance": "synthetic-scenario"
                  }
                },
                "driverEligible": {
                  "status": "known",
                  "value": true,
                  "unit": null,
                  "provenance": {
                    "sourceRef": "fixture:manual-records-v1",
                    "version": "manual-records-v1",
                    "observedAt": "2026-11-05T09:00:00.000Z",
                    "assurance": "synthetic-scenario"
                  }
                }
              },
              "versions": {
                "brief": 1,
                "facts": "1",
                "policy": "gcsp-policy-v1",
                "stock": "availability-v1",
                "snapshot": "snapshot-v1",
                "terms": "gcsp-policy-v1:price.choices-fs-uk.001:allowance.choices-fs-uk.G7:2026-11-05T12:00:00.000Z",
                "clock": "2",
                "availability": "availability-v1"
              },
              "evidence": {
                "eligibility": {
                  "eligible": true,
                  "state": "eligible",
                  "ruleIds": [
                    "choices-fs-uk-001-include"
                  ],
                  "reasons": [
                    "explicit-include"
                  ],
                  "provenance": {
                    "rules": [
                      {
                        "key": "choices-fs-uk-001-include",
                        "value": "F70 Sports Hatch|120",
                        "unit": "model/engine key",
                        "status": "verified",
                        "basis": "Transcribed FS&UK Choices Vehicle Eligibility Matrix: F70 Sports Hatch, 120; source grade-band decisions only. Key mapping is a demo assumption.",
                        "source": "docs/gcsp/sources/choices-eligibility-matrices-2024-10.md",
                        "sourceDate": "2024-07-29",
                        "policyVersion": "gcsp-policy-v1",
                        "effectiveFrom": "2024-10-01T00:00:00.000Z",
                        "ruleId": "choices-fs-uk-001-include",
                        "effect": "include",
                        "matchField": "eligibilityModelKey",
                        "operator": "equals",
                        "gradeIds": [
                          "G1-6",
                          "G7",
                          "G8-10",
                          "G11-14"
                        ],
                        "model": "F70 Sports Hatch",
                        "engine": "120"
                      }
                    ],
                    "schemeRuleLinks": [
                      {
                        "key": "link-choices-fs-uk-001-include",
                        "value": "choices-fs-uk-001-include",
                        "unit": "rule reference",
                        "status": "verified",
                        "basis": "Dated link to the supplied FS&UK Choices Vehicle Eligibility Matrix; effective 1 October 2024.",
                        "source": "docs/gcsp/sources/choices-eligibility-matrices-2024-10.md",
                        "sourceDate": "2024-07-29",
                        "policyVersion": "gcsp-policy-v1",
                        "effectiveFrom": "2024-10-01T00:00:00.000Z",
                        "linkId": "link-choices-fs-uk-001-include",
                        "schemeId": "choices-fs-uk",
                        "ruleId": "choices-fs-uk-001-include"
                      }
                    ],
                    "assumptions": [
                      {
                        "key": "eligibility.rule.matchField",
                        "value": "eligibilityModelKey",
                        "unit": "field name",
                        "status": "assumed",
                        "basis": "Assumed bridge of retained series/model/engine labels to matrix rows, since target matching code is undefined (round-3). Exact mapping is versioned/provenanced in the seed; unknown mapping fails.",
                        "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                        "sourceDate": "2026-11-04",
                        "policyVersion": "gcsp-policy-v1",
                        "effectiveFrom": "2026-11-04T00:00:00.000Z"
                      },
                      {
                        "key": "eligibility.rule.precedence",
                        "value": "excludeThenInclude",
                        "unit": "enum",
                        "status": "assumed",
                        "basis": "Assumed deterministic include/exclude evaluation; unknowns cannot widen eligibility.",
                        "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                        "sourceDate": "2026-11-04",
                        "policyVersion": "gcsp-policy-v1",
                        "effectiveFrom": "2026-11-04T00:00:00.000Z"
                      },
                      {
                        "key": "eligibility.context.mapping",
                        "value": [
                          {
                            "schemeId": "choices-fs-uk",
                            "companyId": "demo-bmw-fs-uk",
                            "sourceMatrix": "FS&UK Choices Vehicle Eligibility Matrix",
                            "gradeIds": [
                              "G1-6",
                              "G7",
                              "G8-10",
                              "G11-14"
                            ]
                          },
                          {
                            "schemeId": "choices-rr-production",
                            "companyId": "demo-bmw-rr-production",
                            "sourceMatrix": "RR&Production Choices Vehicle Eligibility Matrix",
                            "gradeIds": [
                              "PG1",
                              "G8-10",
                              "G11-12"
                            ]
                          }
                        ],
                        "unit": "identifier mapping",
                        "status": "assumed",
                        "basis": "Demo scheme/company IDs and source grade bands preserve actual FS&UK and RR&Production matrices. RR&Production is not equated with UKNSC. eligibilityModelKey is exact source model + | + one source engine token; comma/slash alternatives expand without inventing engine prefixes.",
                        "source": "docs/gcsp/sources/choices-eligibility-matrices-2024-10.md",
                        "sourceDate": "2026-11-04",
                        "policyVersion": "gcsp-policy-v1",
                        "effectiveFrom": "2026-11-04T00:00:00.000Z"
                      }
                    ]
                  }
                },
                "allowance": {
                  "key": "allowance.choices-fs-uk.G7",
                  "value": 1300,
                  "unit": "points/month",
                  "status": "assumed",
                  "basis": "Synthetic monthly demo allowance; eligibility matrices contain no numeric allowances. Not a verified BMW amount.",
                  "source": "docs/gcsp/shared-contracts.md",
                  "sourceDate": "2026-11-04",
                  "policyVersion": "gcsp-policy-v1",
                  "effectiveFrom": "2026-11-04T00:00:00.000Z",
                  "allowanceId": "allowance.choices-fs-uk.G7",
                  "companyId": "demo-bmw-fs-uk",
                  "schemeId": "choices-fs-uk",
                  "gradeId": "G7",
                  "monthlyPoints": 1300
                },
                "points": {
                  "key": "price.choices-fs-uk.001",
                  "value": 800,
                  "unit": "points/month",
                  "status": "assumed",
                  "basis": "Synthetic monthly demo cost for source class UKL; matrices contain no prices. Not a verified BMW amount.",
                  "source": "docs/gcsp/shared-contracts.md",
                  "sourceDate": "2026-11-04",
                  "policyVersion": "gcsp-policy-v1",
                  "effectiveFrom": "2026-11-04T00:00:00.000Z",
                  "pricePlanId": "choices-fs-uk-synthetic-monthly-v1",
                  "priceEntryId": "price.choices-fs-uk.001",
                  "schemeId": "choices-fs-uk",
                  "matchField": "eligibilityModelKey",
                  "matchValue": "F70 Sports Hatch|120",
                  "monthlyPoints": 800
                },
                "assumptions": [
                  {
                    "key": "employee.recommendation.v1",
                    "value": {
                      "displayLimit": 3,
                      "ranking": {
                        "rule": "similarFitThenPoints",
                        "fitTolerance": 5
                      },
                      "retailBudgetEnabled": false,
                      "confirmedAssurances": [
                        "confirmed-build",
                        "confirmed-listing",
                        "synthetic-scenario"
                      ],
                      "plugInFuels": [
                        "ev",
                        "phev"
                      ],
                      "chargingAccess": [
                        "home",
                        "work",
                        "either"
                      ],
                      "availabilityStates": [
                        "available",
                        "held",
                        "allocated",
                        "unavailable",
                        "unknown"
                      ],
                      "preferences": {
                        "body": {
                          "dimension": "body",
                          "type": "enum",
                          "multiple": true,
                          "values": [
                            "hatchback",
                            "saloon",
                            "estate",
                            "suv",
                            "coupe",
                            "convertible",
                            "mpv"
                          ],
                          "facts": [
                            "body"
                          ],
                          "answer": "bodyStyles",
                          "component": "fit"
                        },
                        "fuel": {
                          "dimension": "fuel",
                          "type": "enum",
                          "multiple": true,
                          "values": [
                            "petrol",
                            "diesel",
                            "phev",
                            "ev"
                          ],
                          "facts": [
                            "fuel"
                          ],
                          "answer": "fuel",
                          "component": "fit"
                        },
                        "sportiness": {
                          "dimension": "performance",
                          "type": "slider",
                          "facts": [
                            "zeroTo62"
                          ],
                          "component": "taste",
                          "answers": {
                            "style": 5
                          }
                        },
                        "comfort": {
                          "dimension": "character",
                          "type": "slider",
                          "facts": [
                            "tags"
                          ],
                          "component": "taste",
                          "scaleMultiplier": 2,
                          "answers": {
                            "style": 3,
                            "priorities": [
                              "comfort"
                            ]
                          }
                        },
                        "economy": {
                          "dimension": "economy",
                          "type": "slider",
                          "facts": [
                            "fuel",
                            "mpg"
                          ],
                          "component": "fit"
                        },
                        "size": {
                          "dimension": "size",
                          "type": "slider",
                          "facts": [
                            "sizeClass"
                          ],
                          "component": "fit",
                          "answers": {
                            "primaryUse": "city"
                          }
                        }
                      },
                      "essentials": {
                        "seats": {
                          "operator": "gte",
                          "type": "number",
                          "unit": "count"
                        },
                        "boot": {
                          "operator": "gte",
                          "type": "number",
                          "unit": "L"
                        },
                        "equipment": {
                          "operator": "includes",
                          "type": "list",
                          "unit": "equipment-key"
                        },
                        "body": {
                          "operator": "equals",
                          "type": "string",
                          "unit": null
                        },
                        "fuel": {
                          "operator": "equals",
                          "type": "string",
                          "unit": null
                        },
                        "frontIsofix": {
                          "operator": "equals",
                          "type": "boolean",
                          "unit": null
                        },
                        "rearIsofix": {
                          "operator": "equals",
                          "type": "boolean",
                          "unit": null
                        },
                        "modelLine": {
                          "operator": "equals",
                          "type": "string",
                          "unit": null
                        }
                      },
                      "tuning": {
                        "weights": {
                          "body": 1,
                          "economy": 0,
                          "performance": 0
                        },
                        "priorityBoosts": {},
                        "fuelStrictBoost": 0,
                        "body": {
                          "match": 1,
                          "neutral": 0.7,
                          "miss": 0
                        },
                        "performance": {
                          "zeroBase": 10.5,
                          "span": 6
                        },
                        "size": {
                          "roadtripMinClass": 3,
                          "cityDivisor": 5
                        },
                        "hardFilter": {
                          "crewBoot": 430,
                          "crewSeats": 5,
                          "familySeats": 4
                        },
                        "mileage": {
                          "lowMiles": 4000,
                          "highMiles": 20000
                        }
                      },
                      "termValiditySeconds": 7200,
                      "driverEligibilityRequired": true,
                      "optionEvidence": {
                        "rule": "reviewedEquipment.v1",
                        "version": "bmw-gb-options-2026-11-11.v1",
                        "reviewSha256": "aa860e13b808599888771ea2777ef53516d83692cfbac34293d231beb672fd38",
                        "importance": 100,
                        "halfSaturationWeight": 8,
                        "sliderStep": 5,
                        "unknownModelAnchor": 50,
                        "maximumAdjustment": 20,
                        "disabledBy": {
                          "S0704": [
                            "S0225"
                          ]
                        },
                        "bundleFamilies": {
                          "sport": {
                            "groups": [
                              "sport-package",
                              "m-technology-package",
                              "styling-line",
                              "sport-body-styling"
                            ],
                            "members": [
                              "sport-brakes",
                              "sport-differential",
                              "power-boost",
                              "suspension",
                              "steering",
                              "steering-wheel",
                              "seat-design",
                              "sport-belts",
                              "sport-body-styling",
                              "wheel-tyre-set",
                              "headlining",
                              "shadowline-finish"
                            ]
                          },
                          "technology": {
                            "groups": [
                              "technology-package",
                              "cockpit"
                            ],
                            "members": [
                              "head-up-display",
                              "cockpit-display",
                              "audio-system",
                              "driving-assistance",
                              "parking-assistance",
                              "wireless-charging",
                              "phone-integration"
                            ]
                          },
                          "comfort": {
                            "groups": [
                              "comfort-package"
                            ],
                            "members": [
                              "heated-steering-wheel",
                              "heated-seats",
                              "seat-ventilation",
                              "electric-memory-seats",
                              "active-seat-function",
                              "keyless-access",
                              "powered-tailgate",
                              "lumbar-support",
                              "seat-width-adjustment",
                              "climate-control",
                              "sunblinds",
                              "sunroof",
                              "acoustic-glazing"
                            ]
                          },
                          "connected": {
                            "groups": [
                              "connected-services"
                            ],
                            "members": [
                              "connected-services"
                            ]
                          }
                        },
                        "options": {
                          "FBLAT": {
                            "group": "upholstery",
                            "weight": 0,
                            "evidence": {
                              "comfort": -1
                            }
                          },
                          "FECI2": {
                            "group": "upholstery",
                            "weight": 0,
                            "evidence": {
                              "comfort": -1
                            }
                          },
                          "FEPMI": {
                            "group": "upholstery",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "FKSFU": {
                            "group": "upholstery",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "FKSJX": {
                            "group": "upholstery",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "FKSSW": {
                            "group": "upholstery",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "FKTNL": {
                            "group": "upholstery",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "FKTSW": {
                            "group": "upholstery",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "FLKSW": {
                            "group": "upholstery",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FMAH7": {
                            "group": "upholstery",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FMAL3": {
                            "group": "upholstery",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FMAMU": {
                            "group": "upholstery",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FMANL": {
                            "group": "upholstery",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FMAOI": {
                            "group": "upholstery",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FMASW": {
                            "group": "upholstery",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FVAEW": {
                            "group": "upholstery",
                            "weight": 3,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FVATQ": {
                            "group": "upholstery",
                            "weight": 3,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FVCJL": {
                            "group": "upholstery",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FVCJM": {
                            "group": "upholstery",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FVCJN": {
                            "group": "upholstery",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "FZASW": {
                            "group": "upholstery",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "P0490": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "P0C5A": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "P0C64": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "P0C6R": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PI299": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PI327": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIA30": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIA32": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIC1K": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIC31": {
                            "group": "paint",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIC49": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIC4W": {
                            "group": "paint",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIC5L": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIP28": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIP5T": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIP6K": {
                            "group": "paint",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIP79": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIP7E": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIP80": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIP85": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIP8T": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIP8X": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIP92": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIP9A": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIP9B": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIP9C": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIP9D": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIP9F": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIP9G": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIP9Y": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIU21": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIU91": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "PIX16": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIX1E": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "PIX1G": {
                            "group": "paint",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01CE": {
                            "group": "mild-hybrid",
                            "weight": 0,
                            "evidence": {
                              "economy": 1
                            }
                          },
                          "S01CX": {
                            "group": "power-boost",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01EK": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01EN": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01EU": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {}
                          },
                          "S01G2": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01GL": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01GN": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01GP": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {}
                          },
                          "S01H5": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01H8": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01HA": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01HC": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {}
                          },
                          "S01HD": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {}
                          },
                          "S01HF": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01HK": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01HL": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01HP": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01HX": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01HZ": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01LX": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01R3": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S01W0": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            }
                          },
                          "S01W2": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            }
                          },
                          "S0225": {
                            "group": "suspension",
                            "weight": 0,
                            "evidence": {
                              "sportiness": -1
                            }
                          },
                          "S0235": {
                            "group": "towbar",
                            "weight": 0,
                            "evidence": {
                              "size": 1
                            }
                          },
                          "S0248": {
                            "group": "heated-steering-wheel",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S02NH": {
                            "group": "sport-brakes",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            }
                          },
                          "S02T4": {
                            "group": "sport-differential",
                            "weight": 2,
                            "evidence": {
                              "sportiness": 2
                            }
                          },
                          "S02TB": {
                            "group": "transmission",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S02VF": {
                            "group": "suspension",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2,
                              "comfort": -1
                            }
                          },
                          "S02VL": {
                            "group": "steering",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S02VV": {
                            "group": "suspension",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S02XH": {
                            "group": "steering-wheel",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S0316": {
                            "group": "powered-tailgate",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S0337": {
                            "group": "sport-package",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            },
                            "bundle": true
                          },
                          "S033B": {
                            "group": "sport-package",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            },
                            "bundle": true
                          },
                          "S033F": {
                            "group": "sport-package",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            },
                            "bundle": true
                          },
                          "S033T": {
                            "group": "m-technology-package",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1,
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S03AC": {
                            "group": "towbar",
                            "weight": 0,
                            "evidence": {
                              "size": 1
                            }
                          },
                          "S03AG": {
                            "group": "parking-assistance",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S03AT": {
                            "group": "roof-rails",
                            "weight": 0,
                            "evidence": {
                              "size": 1
                            }
                          },
                          "S03B5": {
                            "group": "roof-colour",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03DN": {
                            "group": "illuminated-grille",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03F9": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            }
                          },
                          "S03FA": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03FK": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03FT": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03FX": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {}
                          },
                          "S03G9": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03GD": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03GN": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03GQ": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03GV": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {}
                          },
                          "S03GX": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03M1": {
                            "group": "sport-brakes",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            }
                          },
                          "S03M2": {
                            "group": "sport-brakes",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            }
                          },
                          "S03M8": {
                            "group": "sport-brakes",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            }
                          },
                          "S03MC": {
                            "group": "roof-rails",
                            "weight": 0,
                            "evidence": {
                              "size": 1
                            }
                          },
                          "S03MF": {
                            "group": "shadowline-finish",
                            "weight": 1,
                            "evidence": {}
                          },
                          "S03NA": {
                            "group": "wheel-tyre-set",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S03NB": {
                            "group": "wheel-tyre-set",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S0402": {
                            "group": "sunroof",
                            "weight": 2,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S0403": {
                            "group": "sunroof",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S0417": {
                            "group": "sunblinds",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S0430": {
                            "group": "folding-mirrors",
                            "weight": 1,
                            "evidence": {}
                          },
                          "S043H": {
                            "group": "interior-trim",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S043K": {
                            "group": "interior-trim",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S043L": {
                            "group": "interior-trim",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S043N": {
                            "group": "interior-trim",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S043U": {
                            "group": "interior-trim",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S043Z": {
                            "group": "interior-trim",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S0451": {
                            "group": "active-seat-function",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S0453": {
                            "group": "seat-ventilation",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S0455": {
                            "group": "active-seat-function",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S0456": {
                            "group": "seat-design",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S0459": {
                            "group": "electric-memory-seats",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S0465": {
                            "group": "folding-rear-seats",
                            "weight": 0,
                            "evidence": {
                              "size": 1
                            }
                          },
                          "S0481": {
                            "group": "seat-design",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1,
                              "comfort": 1
                            }
                          },
                          "S0491": {
                            "group": "seat-width-adjustment",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S0493": {
                            "group": "extended-storage",
                            "weight": 0,
                            "evidence": {
                              "size": 1
                            }
                          },
                          "S0494": {
                            "group": "heated-seats",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S04A2": {
                            "group": "premium-controls",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S04EW": {
                            "group": "interior-trim",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S04FD": {
                            "group": "sliding-rear-seats",
                            "weight": 1,
                            "evidence": {
                              "size": 1
                            }
                          },
                          "S04FL": {
                            "group": "travel-comfort-system",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1,
                              "size": 1
                            }
                          },
                          "S04GQ": {
                            "group": "sport-belts",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S04H0": {
                            "group": "interior-trim",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S04H1": {
                            "group": "interior-trim",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S04H2": {
                            "group": "interior-trim",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S04HA": {
                            "group": "heated-seats",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S04MA": {
                            "group": "seat-design",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2,
                              "comfort": 1
                            }
                          },
                          "S04MC": {
                            "group": "interior-trim",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S04NB": {
                            "group": "climate-control",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S04NR": {
                            "group": "interior-camera",
                            "weight": 1,
                            "evidence": {}
                          },
                          "S04NW": {
                            "group": "instrument-panel-finish",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S04U0": {
                            "group": "premium-controls",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S04U6": {
                            "group": "ac-charging",
                            "weight": 1,
                            "evidence": {
                              "economy": 1
                            }
                          },
                          "S04U8": {
                            "group": "unconfirmed-activation",
                            "weight": 0,
                            "evidence": {
                              "economy": 1
                            },
                            "requiresActivation": true
                          },
                          "S04V1": {
                            "group": "iconic-sounds",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1,
                              "comfort": -1
                            }
                          },
                          "S0508": {
                            "group": "parking-assistance",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S0544": {
                            "group": "cruise-control",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S0552": {
                            "group": "headlamp-system",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S05AS": {
                            "group": "driving-assistance",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S05AT": {
                            "group": "driving-assistance",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S05AU": {
                            "group": "driving-assistance",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S05DF": {
                            "group": "cruise-control",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S05DM": {
                            "group": "parking-assistance",
                            "weight": 0,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S05DN": {
                            "group": "parking-assistance",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S05DW": {
                            "group": "parking-assistance",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S05ML": {
                            "group": "sport-package",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            },
                            "bundle": true
                          },
                          "S0610": {
                            "group": "head-up-display",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S0674": {
                            "group": "audio-system",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S0676": {
                            "group": "audio-system",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S0688": {
                            "group": "audio-system",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S06AK": {
                            "group": "connected-services",
                            "weight": 1,
                            "evidence": {},
                            "requiresActivation": true
                          },
                          "S06C4": {
                            "group": "connected-services",
                            "weight": 1,
                            "evidence": {},
                            "bundle": true,
                            "requiresActivation": true
                          },
                          "S06F4": {
                            "group": "audio-system",
                            "weight": 2,
                            "evidence": {
                              "comfort": 2
                            }
                          },
                          "S06U2": {
                            "group": "cockpit",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S06U3": {
                            "group": "cockpit",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1,
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S06WC": {
                            "group": "cockpit-display",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            }
                          },
                          "S0704": {
                            "group": "suspension",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1,
                              "comfort": -1
                            }
                          },
                          "S0710": {
                            "group": "steering-wheel",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S0711": {
                            "group": "seat-design",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S0715": {
                            "group": "sport-body-styling",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S071C": {
                            "group": "sport-body-styling",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            },
                            "bundle": true
                          },
                          "S0754": {
                            "group": "sport-body-styling",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S0760": {
                            "group": "shadowline-finish",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S0775": {
                            "group": "headlining",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S07A2": {
                            "group": "technology-package",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S07EV": {
                            "group": "technology-package",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S07EW": {
                            "group": "technology-package",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S07HW": {
                            "group": "styling-line",
                            "weight": 1,
                            "evidence": {},
                            "bundle": true
                          },
                          "S07LG": {
                            "group": "comfort-package",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S07M9": {
                            "group": "shadowline-finish",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            }
                          },
                          "S07MU": {
                            "group": "styling-line",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 1
                            },
                            "bundle": true
                          },
                          "S07VK": {
                            "group": "comfort-package",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S09T1": {
                            "group": "sport-package",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            },
                            "bundle": true
                          },
                          "S09T2": {
                            "group": "sport-package",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            },
                            "bundle": true
                          },
                          "S09TA": {
                            "group": "sport-package",
                            "weight": 0,
                            "evidence": {
                              "sportiness": 1
                            },
                            "bundle": true
                          },
                          "S09TB": {
                            "group": "sport-package",
                            "weight": 1,
                            "evidence": {
                              "sportiness": 2
                            },
                            "bundle": true
                          },
                          "S0Z0T": {
                            "group": "technology-package",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S0ZGM": {
                            "group": "comfort-package",
                            "weight": 1,
                            "evidence": {
                              "comfort": 1
                            },
                            "bundle": true
                          },
                          "S0ZGX": {
                            "group": "comfort-package",
                            "weight": 1,
                            "evidence": {
                              "comfort": 2
                            },
                            "bundle": true
                          },
                          "SE000001": {
                            "group": "unknown",
                            "weight": 0,
                            "evidence": {
                              "fuel": "ev"
                            }
                          },
                          "SE000034": {
                            "group": "unknown",
                            "weight": 0,
                            "evidence": {
                              "fuel": "ev"
                            }
                          }
                        }
                      }
                    },
                    "unit": "employee recommendation calibration and registry",
                    "status": "assumed",
                    "basis": "Existing rankCars preference curves with separate importance/indifference and confirmed exact evidence. Collaborator direction, 11 November 2026: use more of the allowance among similarly matched eligible cars; five preference-score points defines a revisable similarity band. No retail cash budget. Quote terms remain pinned for the full 7,200-second buddy hold. Demo calibration is revisable, not BMW policy. Collaborator-reviewed option mappings, 11 November: invisible equipment preference at importance 100; desirability weights 0..3. Shared fixed saturation scale (eight desirability points gives 50/100); supporting slider evidence moves five points per reviewed unit, capped at twenty. Unresolved packages use conservative overlapping-capability fallbacks, not inferred contents. Only selected active catalogue configuration/fitted evidence counts. These calibration values are revisable assumptions.",
                    "source": "docs/gcsp/employee-recommendation.md",
                    "sourceDate": "2026-11-11",
                    "policyVersion": "gcsp-policy-v1",
                    "effectiveFrom": "2026-11-04T00:00:00.000Z"
                  },
                  {
                    "key": "brief.slider.minimum",
                    "value": 0,
                    "unit": "integer slider units",
                    "status": "assumed",
                    "basis": "Assumed `brief.slider.scale`; shared position and importance scale.",
                    "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                    "sourceDate": "2026-11-04",
                    "policyVersion": "gcsp-policy-v1",
                    "effectiveFrom": "2026-11-04T00:00:00.000Z"
                  },
                  {
                    "key": "brief.slider.maximum",
                    "value": 100,
                    "unit": "integer slider units",
                    "status": "assumed",
                    "basis": "Assumed `brief.slider.scale`; dimensions declare categorical alternatives where required.",
                    "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                    "sourceDate": "2026-11-04",
                    "policyVersion": "gcsp-policy-v1",
                    "effectiveFrom": "2026-11-04T00:00:00.000Z"
                  },
                  {
                    "key": "eligibility.homeCharging.requiredForPlugIn",
                    "value": true,
                    "unit": "boolean",
                    "status": "assumed",
                    "basis": "Demo assumption only, not a BMW rule. Assumed demo practical gate from brief; target has no such BMW rule (round-2). Unknown/not-ready charging prevents a plug-in offer under this assumption.",
                    "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                    "sourceDate": "2026-11-04",
                    "policyVersion": "gcsp-policy-v1",
                    "effectiveFrom": "2026-11-04T00:00:00.000Z"
                  }
                ],
                "availability": {
                  "state": "available",
                  "availableFrom": "2026-11-05T12:00:00.000Z",
                  "availableUntil": "2027-01-01T00:00:00.000Z",
                  "version": "availability-v1"
                }
              }
            },
            "currentCarComparison": {
              "schemaVersion": "1",
              "comparisonAvailable": true,
              "binding": {
                "contractId": "current:employee-paula",
                "employeeVersion": 3,
                "slotVersion": 2,
                "source": {
                  "mode": "synthetic",
                  "sourceRef": "fixture:manual-records-v1",
                  "sourceVersion": "manual-records-v1",
                  "schemaVersion": "1",
                  "effectiveFrom": "2026-11-05T09:00:00.000Z",
                  "observedAt": "2026-11-05T09:00:00.000Z"
                }
              },
              "display": {
                "state": "available",
                "model": "BMW 3 Series Touring 320i",
                "source": {
                  "mode": "synthetic",
                  "sourceVersion": "manual-records-v1",
                  "observedAt": "2026-11-05T09:00:00.000Z"
                },
                "facts": {
                  "configuration": {
                    "value": "320i M Sport Touring",
                    "unit": null
                  },
                  "body": {
                    "value": "estate",
                    "unit": null
                  },
                  "fuel": {
                    "value": "petrol",
                    "unit": null
                  },
                  "seats": {
                    "value": 5,
                    "unit": "count"
                  },
                  "boot": {
                    "value": 500,
                    "unit": "L"
                  },
                  "mpg": {
                    "value": 42.8,
                    "unit": "mpg-imperial"
                  },
                  "zeroTo62": {
                    "value": 7.6,
                    "unit": "s"
                  },
                  "points": {
                    "value": 1100,
                    "unit": "points-per-month"
                  }
                },
                "unknowns": []
              }
            },
            "employeeVersion": 3,
            "slotVersion": 2,
            "stockVersion": 1,
            "holdTiming": {
              "key": "hold.buddy.durationSeconds",
              "value": 7200,
              "unit": "seconds",
              "status": "assumed",
              "basis": "Assumed new capability; roughly 2-hour proposal in demo brief/Q15.",
              "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
              "sourceDate": "2026-11-04",
              "policyVersion": "gcsp-policy-v1",
              "effectiveFrom": "2026-11-04T00:00:00.000Z"
            },
            "holdRules": [
              {
                "key": "hold.buddy.durationSeconds",
                "value": 7200,
                "unit": "seconds",
                "status": "assumed",
                "basis": "Assumed new capability; roughly 2-hour proposal in demo brief/Q15.",
                "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                "sourceDate": "2026-11-04",
                "policyVersion": "gcsp-policy-v1",
                "effectiveFrom": "2026-11-04T00:00:00.000Z"
              },
              {
                "key": "hold.employee.maxActive",
                "value": 1,
                "unit": "hold per employee/renewal/slot",
                "status": "assumed",
                "basis": "Assumed explicit limit from proposed offer-loop policy; all occupying/pending states count, and slot entitlement remains authoritative.",
                "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                "sourceDate": "2026-11-04",
                "policyVersion": "gcsp-policy-v1",
                "effectiveFrom": "2026-11-04T00:00:00.000Z"
              },
              {
                "key": "hold.deadline.inclusive",
                "value": true,
                "unit": "boolean",
                "status": "assumed",
                "basis": "Assumed: expiry begins at `now >= expiresAt`; closes deadline races consistently.",
                "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                "sourceDate": "2026-11-04",
                "policyVersion": "gcsp-policy-v1",
                "effectiveFrom": "2026-11-04T00:00:00.000Z"
              },
              {
                "key": "hold.pending.blocksReallocation",
                "value": true,
                "unit": "boolean",
                "status": "verified",
                "basis": "Verified HLD invariant: uncertainty cannot free the car.",
                "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                "sourceDate": "2026-11-04",
                "policyVersion": "gcsp-policy-v1",
                "effectiveFrom": "2026-11-04T00:00:00.000Z"
              },
              {
                "key": "hold.replacement.releaseFirst",
                "value": true,
                "unit": "boolean",
                "status": "assumed",
                "basis": "Assumed conservative replace/change sequence; no second active holder/claim.",
                "source": "docs/gcsp/shared-contracts.md#policy-catalogue-and-provenance",
                "sourceDate": "2026-11-04",
                "policyVersion": "gcsp-policy-v1",
                "effectiveFrom": "2026-11-04T00:00:00.000Z"
              }
            ]
          },
          "terms": {
            "termsVersion": "gcsp-policy-v1:price.choices-fs-uk.001:allowance.choices-fs-uk.G7:2026-11-05T12:00:00.000Z",
            "points": {
              "value": 800,
              "unit": "points"
            },
            "allowanceInputs": {
              "allowance": {
                "value": 1300,
                "unit": "points"
              }
            },
            "contribution": null,
            "validFrom": "2026-11-05T12:00:00.000Z",
            "validUntil": "2026-11-05T14:00:00.000Z",
            "provenance": {
              "sourceRef": "docs/gcsp/shared-contracts.md",
              "version": "gcsp-policy-v1",
              "observedAt": "2026-11-05T12:00:00.000Z",
              "assurance": "synthetic-scenario"
            },
            "kind": "employee-scheme"
          },
          "briefVersion": 1,
          "policyVersion": "gcsp-policy-v1",
          "quotedAt": "2026-11-05T12:00:00.000Z",
          "validUntil": "2026-11-05T14:00:00.000Z",
          "expiresAt": "2026-11-05T14:00:00.000Z",
          "provenance": {
            "sourceRef": "docs/gcsp/shared-contracts.md",
            "version": "gcsp-policy-v1",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "assurance": "synthetic-scenario"
          },
          "monthlyPoints": {
            "value": 800,
            "unit": "points"
          },
          "allowance": {
            "allowance": {
              "value": 1300,
              "unit": "points"
            }
          },
          "version": 1,
          "createdAt": "2026-11-14T06:30:16.738Z",
          "updatedAt": "2026-11-14T06:30:16.738Z"
        },
        "stock": {
          "orderUuid": "00000000-0000-4000-8000-000000000011",
          "orderNumber": "9123456",
          "configurationId": "RjcwOlMx",
          "facts": {
            "contractVersion": "vehicle-snapshot-v1",
            "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000011",
            "sourceNamespace": "fixture:employee",
            "identityKind": "exact-stock",
            "sourceKeys": {
              "stockId": "00000000-0000-4000-8000-000000000011"
            },
            "snapshotVersion": "snapshot-v1",
            "observedAt": "2026-11-05T12:00:00.000Z",
            "display": {
              "name": "Synthetic exact car 11"
            },
            "facts": {
              "eligibilityModelKey": {
                "status": "known",
                "value": "F70 Sports Hatch|120",
                "unit": null,
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "body": {
                "status": "known",
                "value": "hatch",
                "unit": null,
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "fuel": {
                "status": "known",
                "value": "petrol",
                "unit": null,
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "seats": {
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
              "boot": {
                "status": "known",
                "value": 380,
                "unit": "L",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "zeroTo62": {
                "status": "known",
                "value": 7,
                "unit": "s",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "mpg": {
                "status": "known",
                "value": 45,
                "unit": "mpg-imperial",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "sizeClass": {
                "status": "known",
                "value": 2,
                "unit": "ordinal-1-5",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "tags": {
                "status": "known",
                "value": [
                  "cruiser"
                ],
                "unit": null,
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              },
              "insuranceGroup": {
                "status": "known",
                "value": 25,
                "unit": "insurance-group",
                "provenance": {
                  "sourceRef": "fixture:employee",
                  "observedAt": "2026-11-05T12:00:00.000Z",
                  "version": "facts-v1",
                  "assurance": "synthetic-scenario"
                }
              }
            }
          }
        },
        "terms": {
          "schemaVersion": 1,
          "termsVersion": "fictional-order-terms-v1",
          "fictional": true,
          "wording": "Scheme terms: selection requests allocation of this exact scheme stock order under the recorded quote. The nominated driver and licence details must be correct. For a replacement, the recorded old contract and expected return mileage must be correct. Approval, appointment and collection are separate decisions; submission does not end the current contract.",
          "wordingByMode": {
            "new": "Scheme terms: selection requests allocation of this exact scheme stock order under the recorded quote. The nominated driver and licence details must be correct. Approval, appointment and collection are separate decisions."
          },
          "validUntil": "2026-12-01T00:00:00.000Z",
          "declarations": [
            {
              "id": "terms",
              "label": "I accept these scheme terms.",
              "appliesTo": "all"
            },
            {
              "id": "driver",
              "label": "The nominated driver and licence details are correct.",
              "appliesTo": "all"
            },
            {
              "id": "return",
              "label": "The old contract and expected return mileage are correct.",
              "appliesTo": "replacement"
            }
          ],
          "policyVersion": "gcsp-policy-v1",
          "approvalStages": [
            "HR approval",
            "sales-manager approval",
            "sent to ordering"
          ],
          "provenance": {
            "terms": {
              "unit": "versioned synthetic ordering contract",
              "status": "assumed",
              "basis": "Coherent fictional terms and target approval-stage names for the demonstration; approved BMW wording and workflow configuration remain unverified.",
              "source": "docs/gcsp/manual-order-contract.md",
              "sourceDate": "2026-11-05",
              "policyVersion": "gcsp-policy-v1",
              "effectiveFrom": "2026-11-04T00:00:00.000Z",
              "key": "ordering.terms.v1",
              "value": {
                "schemaVersion": 1,
                "termsVersion": "fictional-order-terms-v1",
                "fictional": true,
                "wording": "Scheme terms: selection requests allocation of this exact scheme stock order under the recorded quote. The nominated driver and licence details must be correct. For a replacement, the recorded old contract and expected return mileage must be correct. Approval, appointment and collection are separate decisions; submission does not end the current contract.",
                "wordingByMode": {
                  "new": "Scheme terms: selection requests allocation of this exact scheme stock order under the recorded quote. The nominated driver and licence details must be correct. Approval, appointment and collection are separate decisions."
                },
                "validUntil": "2026-12-01T00:00:00.000Z",
                "declarations": [
                  {
                    "id": "terms",
                    "label": "I accept these scheme terms.",
                    "appliesTo": "all"
                  },
                  {
                    "id": "driver",
                    "label": "The nominated driver and licence details are correct.",
                    "appliesTo": "all"
                  },
                  {
                    "id": "return",
                    "label": "The old contract and expected return mileage are correct.",
                    "appliesTo": "replacement"
                  }
                ]
              }
            },
            "stages": {
              "unit": "versioned synthetic ordering contract",
              "status": "assumed",
              "basis": "Coherent fictional terms and target approval-stage names for the demonstration; approved BMW wording and workflow configuration remain unverified.",
              "source": "docs/gcsp/manual-order-contract.md",
              "sourceDate": "2026-11-05",
              "policyVersion": "gcsp-policy-v1",
              "effectiveFrom": "2026-11-04T00:00:00.000Z",
              "key": "ordering.approvalStages.v1",
              "value": [
                "HR approval",
                "sales-manager approval",
                "sent to ordering"
              ]
            }
          },
          "termsDigest": "043929a16220825140ac89033524232a49b85bdc79b7cf2e5711fdb43e1c3675"
        },
        "declarations": {
          "terms": true,
          "driver": true,
          "return": true
        },
        "draft": {
          "draftVersion": 1,
          "choices": {
            "mode": "replacement",
            "driverId": "driver:employee-paula",
            "contact": {
              "phone": "01632 960000",
              "email": "paula.mason@gcsp-demo.com"
            },
            "returnOdometer": {
              "value": 6100,
              "unit": "mi"
            }
          }
        },
        "employee": {
          "employeeId": "employee-paula",
          "name": "Paula Mason",
          "companyId": "demo-bmw-fs-uk",
          "gradeId": "G7",
          "schemeId": "choices-fs-uk",
          "employeeNumber": "E749057",
          "address": {
            "line1": "27 Ashdown Road",
            "town": "Bracknell",
            "postcode": "RG12 9ZZ"
          },
          "contact": {
            "phone": "01632 960000",
            "email": "paula.mason@gcsp-demo.com"
          },
          "allowanceOverride": null
        },
        "driver": {
          "driverId": "driver:employee-paula",
          "employeeId": "employee-paula",
          "name": "Paula Mason",
          "kind": "employee",
          "eligible": {
            "status": "known",
            "value": true,
            "unit": null,
            "provenance": {
              "sourceRef": "fixture:manual-records-v1",
              "version": "manual-records-v1",
              "observedAt": "2026-11-05T09:00:00.000Z",
              "assurance": "synthetic-scenario"
            }
          },
          "licence": {
            "displayNumber": "MASON900000PM9XX",
            "categories": [
              "car"
            ],
            "validFrom": "2010-01-01",
            "validUntil": "2030-01-01",
            "source": {
              "mode": "synthetic",
              "sourceRef": "fixture:manual-records-v1",
              "schemaVersion": "1",
              "sourceVersion": "manual-records-v1",
              "effectiveFrom": "2026-11-05T09:00:00.000Z",
              "observedAt": "2026-11-05T09:00:00.000Z"
            }
          }
        },
        "oldContract": {
          "contractId": "current:employee-paula",
          "employeeId": "employee-paula",
          "schemeId": "choices-fs-uk",
          "slotId": "slot-paula",
          "driverId": "driver:employee-paula",
          "status": "current",
          "model": "BMW 3 Series Touring 320i",
          "media": {
            "src": "/assets/gcsp-vehicle-evidence/07c269dd7f55fad0a56bbad65ae72f7c35defc5e8883a8290a82972e1defb427.webp",
            "alt": "BMW 3 Series Touring"
          },
          "vehicle": {
            "configuration": "320i M Sport Touring",
            "modelLine": "G21 Touring",
            "eligibilityModelKey": "G21 Touring|320i",
            "body": "estate",
            "fuel": "petrol",
            "seats": 5,
            "boot": 500,
            "mpg": 42.8,
            "zeroTo62": 7.6,
            "points": 1100,
            "sizeClass": 2,
            "tags": [
              "family"
            ]
          },
          "actualCollectionDate": "2026-06-01",
          "contractEndDate": "2026-12-01",
          "returnedDate": null,
          "annualMileage": 12000,
          "mileageUnit": "mi/year",
          "months": 6,
          "currentOdometer": {
            "value": 5200,
            "unit": "mi"
          },
          "earliestCollectionDate": "2026-11-12",
          "latestCollectionDate": "2026-12-01",
          "source": {
            "mode": "synthetic",
            "sourceRef": "fixture:manual-records-v1",
            "schemaVersion": "1",
            "sourceVersion": "manual-records-v1",
            "effectiveFrom": "2026-11-05T09:00:00.000Z",
            "observedAt": "2026-11-05T09:00:00.000Z"
          }
        },
        "sourceVersions": {
          "employee": 3,
          "brief": 1
        },
        "employeeAuthority": {
          "employeeId": "employee-paula",
          "principalId": "demo-paula",
          "companyId": "demo-bmw-fs-uk",
          "gradeId": "G7",
          "schemeId": "choices-fs-uk",
          "version": 3
        },
        "vehicleSlot": {
          "employeeId": "employee-paula",
          "entitlementSlotId": "slot-paula",
          "capacity": 1,
          "employeeCapacity": 1,
          "runId": "demo-b6c7f3a31036d9e989f8a979c20a9451",
          "version": 3,
          "createdAt": "2026-11-14T06:30:16.694Z",
          "updatedAt": "2026-11-14T06:30:16.739Z",
          "contractId": "current:employee-paula",
          "renewalId": "renewal:employee-paula",
          "state": "entitled"
        },
        "reviewDetails": null
      },
      "progress": {
        "schemaVersion": 1,
        "selectionState": "acknowledged",
        "approved": false,
        "current": "HR approval",
        "stages": [
          {
            "name": "selection received",
            "state": "complete"
          },
          {
            "name": "HR approval",
            "state": "waiting"
          },
          {
            "name": "sales-manager approval",
            "state": "not-started"
          },
          {
            "name": "sent to ordering",
            "state": "not-started"
          }
        ]
      },
      "order": {
        "status": "confirmed",
        "operationId": "selection:d4c06073fd0ba1ae707f284ef301a8a201b85145b4c7f8724f7826c688a5174c",
        "runId": "demo-b6c7f3a31036d9e989f8a979c20a9451",
        "orderUuid": "00000000-0000-4000-8000-000000000011",
        "configurationId": "RjcwOlMx",
        "orderNumber": "9123456",
        "orderStatus": "HR approval",
        "fictional": true
      },
      "failure": null,
      "view": {
        "state": "awaiting-approval",
        "action": "view-order"
      }
    }
  }
} as const;
const pending = { ...acknowledged, "state": "handoff-pending", "receipt": { ...acknowledged["receipt"], "selection": { ...acknowledged["receipt"]["selection"], "operationState": "unknown", "selection": { ...acknowledged["receipt"]["selection"]["selection"], "quote": { ...acknowledged["receipt"]["selection"]["selection"]["quote"], "createdAt": "2026-11-14T06:30:16.808Z", "updatedAt": "2026-11-14T06:30:16.808Z" }, "vehicleSlot": { ...acknowledged["receipt"]["selection"]["selection"]["vehicleSlot"], "createdAt": "2026-11-14T06:30:16.790Z", "updatedAt": "2026-11-14T06:30:16.808Z" } }, "progress": { ...acknowledged["receipt"]["selection"]["progress"], "selectionState": "handoff-pending", "current": "selection received", "stages": [{"name":"selection received","state":"pending"},{"name":"HR approval","state":"not-started"},{"name":"sales-manager approval","state":"not-started"},{"name":"sent to ordering","state":"not-started"}] }, "order": null, "view": { ...acknowledged["receipt"]["selection"]["view"], "state": "handoff-pending", "action": "check-status" } } } } as const;
const failed = { ...acknowledged, "state": "handoff-failed", "receipt": { ...acknowledged["receipt"], "selection": { ...acknowledged["receipt"]["selection"], "operationState": "handoff-failed", "selection": { ...acknowledged["receipt"]["selection"]["selection"], "quote": { ...acknowledged["receipt"]["selection"]["selection"]["quote"], "createdAt": "2026-11-14T06:30:16.897Z", "updatedAt": "2026-11-14T06:30:16.897Z" }, "vehicleSlot": { ...acknowledged["receipt"]["selection"]["selection"]["vehicleSlot"], "createdAt": "2026-11-14T06:30:16.868Z", "updatedAt": "2026-11-14T06:30:16.897Z" } }, "progress": { ...acknowledged["receipt"]["selection"]["progress"], "selectionState": "handoff-failed", "current": "selection received", "stages": [{"name":"selection received","state":"failed"},{"name":"HR approval","state":"not-started"},{"name":"sales-manager approval","state":"not-started"},{"name":"sent to ordering","state":"not-started"}] }, "order": null, "failure": {"status":"rejected","operationId":"selection:d4c06073fd0ba1ae707f284ef301a8a201b85145b4c7f8724f7826c688a5174c","runId":"demo-b6c7f3a31036d9e989f8a979c20a9451","orderUuid":"00000000-0000-4000-8000-000000000011","reason":"synthetic-ordering-refused","fictional":true}, "view": { ...acknowledged["receipt"]["selection"]["view"], "state": "handoff-failed", "action": "contact-support" } } } } as const;
export const offerCommandProducerFixtures = [acknowledged, pending, failed] as const;
