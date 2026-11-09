// Synthetic dated service snapshot, not active policy. Recomputed against PolicyService in the account tests.
export const ACCOUNT_SNAPSHOT = {
  "status": "ok",
  "value": {
    "state": "ready",
    "asOf": "2026-11-05T09:00:00.000Z",
    "account": {
      "employeeId": "employee-paula",
      "name": "Paula (fictional)",
      "companyId": "demo-bmw-fs-uk",
      "gradeId": "G7",
      "schemeId": "choices-fs-uk",
      "employeeNumber": "DEMO-employee-paula",
      "address": {
        "line1": "1 Fictional Way",
        "town": "Example Town",
        "postcode": "ZZ1 1ZZ"
      },
      "contact": {
        "phone": "01632 960000",
        "email": "employee-paula@example.invalid"
      },
      "allowanceOverride": null
    },
    "drivers": [
      {
        "driverId": "driver:employee-paula",
        "employeeId": "employee-paula",
        "name": "Paula (fictional)",
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
          "displayNumber": "FICTIONAL-LICENCE",
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
      {
        "driverId": "nominated:employee-paula",
        "employeeId": "employee-paula",
        "name": "Casey (fictional)",
        "kind": "nominated",
        "relationship": "spouse",
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
          "displayNumber": "FICTIONAL-NOMINEE",
          "categories": [
            "car"
          ],
          "validFrom": "2012-01-01",
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
      }
    ],
    "contracts": [
      {
        "contractId": "current:employee-paula",
        "employeeId": "employee-paula",
        "schemeId": "choices-fs-uk",
        "slotId": "slot-paula",
        "driverId": "driver:employee-paula",
        "status": "current",
        "model": "Fictional BMW 320i Touring",
        "vehicle": {"configuration": "G21 320i M Sport Touring", "body": "estate", "fuel": "petrol", "seats": 5, "boot": 500, "mpg": 42.8, "zeroTo62": 7.6, "points": 1100},
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
      }
    ],
    "slots": [
      {
        "employeeId": "employee-paula",
        "entitlementSlotId": "slot-paula",
        "capacity": 1,
        "employeeCapacity": 1,
        "runId": "demo-ecbf8fbcd78d4f7316302db1afd2a440",
        "version": 2,
        "createdAt": "2026-11-05T09:00:00.000Z",
        "updatedAt": "2026-11-05T09:00:00.000Z",
        "contractId": "current:employee-paula",
        "renewalId": "renewal:employee-paula",
        "state": "entitled",
        "ordering": {
          "enabled": true,
          "reason": null
        }
      }
    ],
    "currentContract": {
      "contractId": "current:employee-paula",
      "employeeId": "employee-paula",
      "schemeId": "choices-fs-uk",
      "slotId": "slot-paula",
      "driverId": "driver:employee-paula",
      "status": "current",
      "model": "Fictional BMW 320i Touring",
      "vehicle": {"configuration": "G21 320i M Sport Touring", "body": "estate", "fuel": "petrol", "seats": 5, "boot": 500, "mpg": 42.8, "zeroTo62": 7.6, "points": 1100},
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
    "contractState": "current-contract",
    "histories": [
      {
        "schemeId": "choices-fs-uk",
        "label": "BMW Choices",
        "entries": [
          {
            "contractId": "current:employee-paula",
            "employeeId": "employee-paula",
            "schemeId": "choices-fs-uk",
            "slotId": "slot-paula",
            "driverId": "driver:employee-paula",
            "status": "current",
            "model": "Fictional BMW 320i Touring",
            "vehicle": {"configuration": "G21 320i M Sport Touring", "body": "estate", "fuel": "petrol", "seats": 5, "boot": 500, "mpg": 42.8, "zeroTo62": 7.6, "points": 1100},
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
          }
        ],
        "state": "history",
        "count": 1,
        "orderingSupported": true
      },
      {
        "schemeId": "pcs-ukfs-bmw",
        "label": "PCS UK FS BMW",
        "entries": [
          {
            "contractId": "historic:employee-paula",
            "employeeId": "employee-paula",
            "schemeId": "pcs-ukfs-bmw",
            "status": "returned",
            "actualCollectionDate": "2025-01-01",
            "returnedDate": "2025-12-01",
            "source": {
              "mode": "synthetic",
              "sourceRef": "fixture:manual-records-v1",
              "schemaVersion": "1",
              "sourceVersion": "manual-records-v1",
              "effectiveFrom": "2026-11-05T09:00:00.000Z",
              "observedAt": "2026-11-05T09:00:00.000Z"
            }
          }
        ],
        "state": "history",
        "count": 1,
        "orderingSupported": false
      },
      {
        "schemeId": "motorcycle-choices",
        "label": "Motorcycle Choices",
        "entries": [],
        "state": "empty-history",
        "count": 0,
        "orderingSupported": false
      }
    ],
    "actions": [
      {
        "action": "replace",
        "slotId": "slot-paula",
        "schemeId": "choices-fs-uk",
        "oldContractId": "current:employee-paula",
        "enabled": true
      }
    ],
    "choices": {
      "schemeId": "choices-fs-uk",
      "slotId": "slot-paula",
      "drivers": [
        {
          "driverId": "driver:employee-paula",
          "name": "Paula (fictional)",
          "kind": "employee"
        },
        {
          "driverId": "nominated:employee-paula",
          "name": "Casey (fictional)",
          "kind": "nominated"
        }
      ],
      "contractOptions": [
        {
          "contractOptionId": "six-month-8000",
          "months": 6,
          "annualMileage": 8000,
          "mileageUnit": "mi/year",
          "schemeIds": [
            "choices-fs-uk"
          ],
          "driverKinds": [
            "employee",
            "nominated"
          ]
        },
        {
          "contractOptionId": "twelve-month-12000",
          "months": 12,
          "annualMileage": 12000,
          "mileageUnit": "mi/year",
          "schemeIds": [
            "choices-fs-uk"
          ],
          "driverKinds": [
            "employee"
          ]
        }
      ],
      "collectionLocations": [
        {
          "locationId": "demo-collection-centre",
          "label": "Fictional collection centre",
          "contractOptionIds": [
            "six-month-8000",
            "twelve-month-12000"
          ],
          "driverKinds": [
            "employee",
            "nominated"
          ],
          "closedDates": []
        },
        {
          "locationId": "demo-company-site",
          "label": "Fictional company site",
          "contractOptionIds": [
            "twelve-month-12000"
          ],
          "driverKinds": [
            "employee"
          ],
          "closedDates": []
        }
      ],
      "brands": [
        "bmw"
      ]
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
    "assumptions": [
      {
        "key": "manual.context.v1",
        "value": {
          "enabledSchemes": [
            "choices-fs-uk"
          ],
          "brands": [
            "bmw"
          ],
          "contractOptions": [
            {
              "contractOptionId": "six-month-8000",
              "months": 6,
              "annualMileage": 8000,
              "mileageUnit": "mi/year",
              "schemeIds": [
                "choices-fs-uk"
              ],
              "driverKinds": [
                "employee",
                "nominated"
              ]
            },
            {
              "contractOptionId": "twelve-month-12000",
              "months": 12,
              "annualMileage": 12000,
              "mileageUnit": "mi/year",
              "schemeIds": [
                "choices-fs-uk"
              ],
              "driverKinds": [
                "employee"
              ]
            }
          ],
          "locations": [
            {
              "locationId": "demo-collection-centre",
              "label": "Fictional collection centre",
              "contractOptionIds": [
                "six-month-8000",
                "twelve-month-12000"
              ],
              "driverKinds": [
                "employee",
                "nominated"
              ],
              "closedDates": []
            },
            {
              "locationId": "demo-company-site",
              "label": "Fictional company site",
              "contractOptionIds": [
                "twelve-month-12000"
              ],
              "driverKinds": [
                "employee"
              ],
              "closedDates": []
            }
          ],
          "minimumLeadDays": 7,
          "maximumLeadDays": 180,
          "maximumSpecialRequirements": 500,
          "maximumReturnMileage": 500000,
          "insuranceMaximumByGrade": {
            "G1-6": 30,
            "G7": 35,
            "G8-10": 45,
            "G11-14": 50
          }
        },
        "unit": "manual contract months; annual mileage mi/year; lead days; insurance group; return miles; text characters",
        "status": "assumed",
        "basis": "Revisable synthetic manual rules, not transcribed dropdowns or BMW policy. One explicitly enabled October 2024 FS&UK matrix and BMW brand; permitted nominated-driver/contract/location combinations and insurance caps demonstrate real validation. Choices monthly points uses the shared allowance gate; cash top-up keys remain unused.",
        "source": "docs/gcsp/manual-journey-refinement.md#implemented-manual-context-contract--fucq-65",
        "sourceDate": "2026-11-05",
        "policyVersion": "gcsp-policy-v1",
        "effectiveFrom": "2026-11-04T00:00:00.000Z"
      }
    ],
    "contextVersion": "7e08b6e05c284c5f3e6b44c46e83accedadfb38d1ee72aa533a8adfdc9201605",
    "versions": {
      "policy": "gcsp-policy-v1",
      "employeeContract": {
        "mode": "synthetic",
        "sourceRef": "fixture:manual-records-v1",
        "schemaVersion": "1",
        "sourceVersion": "manual-records-v1",
        "effectiveFrom": "2026-11-05T09:00:00.000Z",
        "observedAt": "2026-11-05T09:00:00.000Z"
      },
      "driver": {
        "mode": "synthetic",
        "sourceRef": "fixture:manual-records-v1",
        "schemaVersion": "1",
        "sourceVersion": "manual-records-v1",
        "effectiveFrom": "2026-11-05T09:00:00.000Z",
        "observedAt": "2026-11-05T09:00:00.000Z"
      },
      "recordSetId": "manual:employee-paula:v1",
      "employee": 2,
      "slot": 2,
      "clock": "1"
    },
    "view": {
      "state": "ready",
      "editable": true,
      "supportOwner": "employee",
      "action": "choose-order-options",
      "fields": {
        "account": {
          "editable": false,
          "supportOwner": "hr-support"
        },
        "licence": {
          "editable": false,
          "supportOwner": "driver-support"
        },
        "driver": {
          "editable": true,
          "supportOwner": "driver-support"
        },
        "contract": {
          "editable": true,
          "supportOwner": "scheme-support"
        },
        "collection": {
          "editable": true,
          "supportOwner": "collection-support"
        },
        "contact": {
          "editable": true,
          "supportOwner": "employee"
        },
        "expectedReturnMileage": {
          "editable": true,
          "supportOwner": "employee"
        },
        "specialRequirements": {
          "editable": true,
          "supportOwner": "employee"
        }
      }
    }
  },
  "contractVersion": "1.0.0"
};

export const FIXTURE_NAMES = Object.freeze(['ready', 'multi-slot', 'missing-image', 'no-current-car', 'no-history',
  'absent-hr-account', 'not-yet-eligible', 'unsupported-scheme', 'no-entitlement', 'source-failure', 'refused', 'conflict']);

// These historical inputs exercise presentation states; production always reads the HTTP service.
export function accountFixture(name = 'ready') {
  if (!FIXTURE_NAMES.includes(name)) return null;
  if (name === 'unsupported-scheme') return structuredClone(UNSUPPORTED_SNAPSHOT);
  const envelope = structuredClone(ACCOUNT_SNAPSHOT);
  const value = envelope.value;
  if (['source-failure', 'refused', 'conflict'].includes(name)) return {
    status: { 'source-failure': 'unavailable', refused: 'forbidden', conflict: 'stale-version' }[name],
    code: `synthetic-${name}`, retryable: name === 'source-failure',
    view: { state: name, editable: false, supportOwner: 'scheme-support', action: name === 'conflict' ? 'refresh-review' : 'contact-support' },
  };
  if (name === 'absent-hr-account') {
    value.state = name; value.account = null; value.drivers = []; value.contracts = []; value.slots = [];
    value.currentContract = null; value.histories = []; value.actions = []; value.choices = null;
    value.allowance = null; value.contextVersion = null;
  }
  if (name === 'multi-slot') {
    const second = { ...structuredClone(value.currentContract), contractId: 'synthetic:second-contract',
      slotId: 'synthetic:second-slot', schemeId: 'pcs-ukfs-bmw', model: 'Fictional BMW 320i M Sport Touring with Technology and Comfort packages',
      driverId: value.drivers[1].driverId, vin: 'ZZSYNTHETIC000002', orderNumber: '1234567',
      media: null, status: 'current' };
    value.contracts.push(second);
    value.slots.push({ ...structuredClone(value.slots[0]), entitlementSlotId: second.slotId, schemeId: second.schemeId,
      contractId: second.contractId, ordering: { enabled: false, reason: 'outside-trusted-context' } });
    value.histories[1].entries.push(structuredClone(second)); value.histories[1].count += 1;
  }
  if (name === 'missing-image') for (const contract of value.contracts) contract.media = null;
  if (name === 'no-history') for (const history of value.histories) {
    history.entries = []; history.count = 0; history.state = 'empty-history';
  }
  if (name === 'no-current-car') {
    value.currentContract = null; value.contracts = []; value.contractState = 'no-contract';
    for (const slot of value.slots) slot.contractId = null;
    value.actions = value.actions.map((action) => ({ ...action, action: 'order', oldContractId: null }));
    for (const history of value.histories) {
      history.entries = []; history.count = 0; history.state = 'empty-history';
    }
  }
  if (name === 'not-yet-eligible') {
    value.contracts[0].earliestCollectionDate = '2027-06-01'; value.contracts[0].latestCollectionDate = '2027-06-15';
    value.currentContract = structuredClone(value.contracts[0]);
    value.histories[0].entries[0] = structuredClone(value.currentContract);
  }
  if (name === 'no-entitlement') for (const slot of value.slots) slot.state = 'disabled';
  if (['absent-hr-account', 'not-yet-eligible', 'unsupported-scheme', 'no-entitlement'].includes(name)) {
    value.state = name; value.actions = [];
    value.view = { ...value.view, state: name, editable: false, supportOwner: 'scheme-support', action: 'contact-support' };
    for (const field of Object.values(value.view.fields ?? {})) field.editable = false;
    for (const slot of value.slots) slot.ordering = { enabled: false, reason: name };
  }
  return envelope;
}

// Synthetic unsupported-scheme snapshot from the same canonical service.
export const UNSUPPORTED_SNAPSHOT = {
  "status": "ok",
  "value": {
    "state": "unsupported-scheme",
    "asOf": "2026-11-05T09:00:00.000Z",
    "account": {
      "employeeId": "employee-sam",
      "name": "Sam (fictional)",
      "companyId": "demo-bmw-rr-production",
      "gradeId": "PG1",
      "schemeId": "choices-rr-production",
      "employeeNumber": "DEMO-employee-sam",
      "address": {
        "line1": "1 Fictional Way",
        "town": "Example Town",
        "postcode": "ZZ1 1ZZ"
      },
      "contact": {
        "phone": "01632 960000",
        "email": "employee-sam@example.invalid"
      },
      "allowanceOverride": null
    },
    "drivers": [
      {
        "driverId": "driver:employee-sam",
        "employeeId": "employee-sam",
        "name": "Sam (fictional)",
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
          "displayNumber": "FICTIONAL-LICENCE",
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
      {
        "driverId": "nominated:employee-sam",
        "employeeId": "employee-sam",
        "name": "Casey (fictional)",
        "kind": "nominated",
        "relationship": "spouse",
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
          "displayNumber": "FICTIONAL-NOMINEE",
          "categories": [
            "car"
          ],
          "validFrom": "2012-01-01",
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
      }
    ],
    "contracts": [
      {
        "contractId": "current:employee-sam",
        "employeeId": "employee-sam",
        "schemeId": "choices-rr-production",
        "slotId": "slot-sam",
        "driverId": "driver:employee-sam",
        "status": "current",
        "model": "Fictional BMW 320i Touring",
        "vehicle": {"configuration": "G21 320i M Sport Touring", "body": "estate", "fuel": "petrol", "seats": 5, "boot": 500, "mpg": 42.8, "zeroTo62": 7.6, "points": 1100},
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
      }
    ],
    "slots": [
      {
        "employeeId": "employee-sam",
        "entitlementSlotId": "slot-sam",
        "capacity": 1,
        "employeeCapacity": 1,
        "runId": "demo-ecbf8fbcd78d4f7316302db1afd2a440",
        "version": 2,
        "createdAt": "2026-11-05T09:00:00.000Z",
        "updatedAt": "2026-11-05T09:00:00.000Z",
        "contractId": "current:employee-sam",
        "renewalId": "renewal:employee-sam",
        "state": "entitled",
        "ordering": {
          "enabled": false,
          "reason": "unsupported-scheme"
        }
      }
    ],
    "currentContract": {
      "contractId": "current:employee-sam",
      "employeeId": "employee-sam",
      "schemeId": "choices-rr-production",
      "slotId": "slot-sam",
      "driverId": "driver:employee-sam",
      "status": "current",
      "model": "Fictional BMW 320i Touring",
      "vehicle": {"configuration": "G21 320i M Sport Touring", "body": "estate", "fuel": "petrol", "seats": 5, "boot": 500, "mpg": 42.8, "zeroTo62": 7.6, "points": 1100},
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
    "contractState": "current-contract",
    "histories": [
      {
        "schemeId": "choices-rr-production",
        "label": "Rolls-Royce and Production Choices",
        "entries": [
          {
            "contractId": "current:employee-sam",
            "employeeId": "employee-sam",
            "schemeId": "choices-rr-production",
            "slotId": "slot-sam",
            "driverId": "driver:employee-sam",
            "status": "current",
            "model": "Fictional BMW 320i Touring",
            "vehicle": {"configuration": "G21 320i M Sport Touring", "body": "estate", "fuel": "petrol", "seats": 5, "boot": 500, "mpg": 42.8, "zeroTo62": 7.6, "points": 1100},
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
          }
        ],
        "state": "history",
        "count": 1,
        "orderingSupported": false
      },
      {
        "schemeId": "pcs-ukfs-bmw",
        "label": "PCS UK FS BMW",
        "entries": [
          {
            "contractId": "historic:employee-sam",
            "employeeId": "employee-sam",
            "schemeId": "pcs-ukfs-bmw",
            "status": "returned",
            "actualCollectionDate": "2025-01-01",
            "returnedDate": "2025-12-01",
            "source": {
              "mode": "synthetic",
              "sourceRef": "fixture:manual-records-v1",
              "schemaVersion": "1",
              "sourceVersion": "manual-records-v1",
              "effectiveFrom": "2026-11-05T09:00:00.000Z",
              "observedAt": "2026-11-05T09:00:00.000Z"
            }
          }
        ],
        "state": "history",
        "count": 1,
        "orderingSupported": false
      },
      {
        "schemeId": "motorcycle-choices",
        "label": "Motorcycle Choices",
        "entries": [],
        "state": "empty-history",
        "count": 0,
        "orderingSupported": false
      }
    ],
    "actions": [],
    "choices": {
      "schemeId": "choices-rr-production",
      "slotId": "slot-sam",
      "drivers": [
        {
          "driverId": "driver:employee-sam",
          "name": "Sam (fictional)",
          "kind": "employee"
        },
        {
          "driverId": "nominated:employee-sam",
          "name": "Casey (fictional)",
          "kind": "nominated"
        }
      ],
      "contractOptions": [
        {
          "contractOptionId": "six-month-8000",
          "months": 6,
          "annualMileage": 8000,
          "mileageUnit": "mi/year",
          "schemeIds": [
            "choices-fs-uk"
          ],
          "driverKinds": [
            "employee",
            "nominated"
          ]
        },
        {
          "contractOptionId": "twelve-month-12000",
          "months": 12,
          "annualMileage": 12000,
          "mileageUnit": "mi/year",
          "schemeIds": [
            "choices-fs-uk"
          ],
          "driverKinds": [
            "employee"
          ]
        }
      ],
      "collectionLocations": [
        {
          "locationId": "demo-collection-centre",
          "label": "Fictional collection centre",
          "contractOptionIds": [
            "six-month-8000",
            "twelve-month-12000"
          ],
          "driverKinds": [
            "employee",
            "nominated"
          ],
          "closedDates": []
        },
        {
          "locationId": "demo-company-site",
          "label": "Fictional company site",
          "contractOptionIds": [
            "twelve-month-12000"
          ],
          "driverKinds": [
            "employee"
          ],
          "closedDates": []
        }
      ],
      "brands": [
        "bmw"
      ]
    },
    "allowance": {
      "key": "allowance.choices-rr-production.PG1",
      "value": 1300,
      "unit": "points/month",
      "status": "assumed",
      "basis": "Synthetic monthly demo allowance; eligibility matrices contain no numeric allowances. Not a verified BMW amount.",
      "source": "docs/gcsp/shared-contracts.md",
      "sourceDate": "2026-11-04",
      "policyVersion": "gcsp-policy-v1",
      "effectiveFrom": "2026-11-04T00:00:00.000Z",
      "allowanceId": "allowance.choices-rr-production.PG1",
      "companyId": "demo-bmw-rr-production",
      "schemeId": "choices-rr-production",
      "gradeId": "PG1",
      "monthlyPoints": 1300
    },
    "assumptions": [
      {
        "key": "manual.context.v1",
        "value": {
          "enabledSchemes": [
            "choices-fs-uk"
          ],
          "brands": [
            "bmw"
          ],
          "contractOptions": [
            {
              "contractOptionId": "six-month-8000",
              "months": 6,
              "annualMileage": 8000,
              "mileageUnit": "mi/year",
              "schemeIds": [
                "choices-fs-uk"
              ],
              "driverKinds": [
                "employee",
                "nominated"
              ]
            },
            {
              "contractOptionId": "twelve-month-12000",
              "months": 12,
              "annualMileage": 12000,
              "mileageUnit": "mi/year",
              "schemeIds": [
                "choices-fs-uk"
              ],
              "driverKinds": [
                "employee"
              ]
            }
          ],
          "locations": [
            {
              "locationId": "demo-collection-centre",
              "label": "Fictional collection centre",
              "contractOptionIds": [
                "six-month-8000",
                "twelve-month-12000"
              ],
              "driverKinds": [
                "employee",
                "nominated"
              ],
              "closedDates": []
            },
            {
              "locationId": "demo-company-site",
              "label": "Fictional company site",
              "contractOptionIds": [
                "twelve-month-12000"
              ],
              "driverKinds": [
                "employee"
              ],
              "closedDates": []
            }
          ],
          "minimumLeadDays": 7,
          "maximumLeadDays": 180,
          "maximumSpecialRequirements": 500,
          "maximumReturnMileage": 500000,
          "insuranceMaximumByGrade": {
            "G1-6": 30,
            "G7": 35,
            "G8-10": 45,
            "G11-14": 50
          }
        },
        "unit": "manual contract months; annual mileage mi/year; lead days; insurance group; return miles; text characters",
        "status": "assumed",
        "basis": "Revisable synthetic manual rules, not transcribed dropdowns or BMW policy. One explicitly enabled October 2024 FS&UK matrix and BMW brand; permitted nominated-driver/contract/location combinations and insurance caps demonstrate real validation. Choices monthly points uses the shared allowance gate; cash top-up keys remain unused.",
        "source": "docs/gcsp/manual-journey-refinement.md#implemented-manual-context-contract--fucq-65",
        "sourceDate": "2026-11-05",
        "policyVersion": "gcsp-policy-v1",
        "effectiveFrom": "2026-11-04T00:00:00.000Z"
      }
    ],
    "contextVersion": "b963b662974bbc589bcc691f5f1fe4b26b15838ed802e121715197d2a3eed8bd",
    "versions": {
      "policy": "gcsp-policy-v1",
      "employeeContract": {
        "mode": "synthetic",
        "sourceRef": "fixture:manual-records-v1",
        "schemaVersion": "1",
        "sourceVersion": "manual-records-v1",
        "effectiveFrom": "2026-11-05T09:00:00.000Z",
        "observedAt": "2026-11-05T09:00:00.000Z"
      },
      "driver": {
        "mode": "synthetic",
        "sourceRef": "fixture:manual-records-v1",
        "schemaVersion": "1",
        "sourceVersion": "manual-records-v1",
        "effectiveFrom": "2026-11-05T09:00:00.000Z",
        "observedAt": "2026-11-05T09:00:00.000Z"
      },
      "recordSetId": "manual:employee-sam:v1",
      "employee": 2,
      "slot": 2,
      "clock": "1"
    },
    "view": {
      "state": "unsupported-scheme",
      "editable": false,
      "supportOwner": "scheme-support",
      "action": "contact-support",
      "fields": {
        "account": {
          "editable": false,
          "supportOwner": "hr-support"
        },
        "licence": {
          "editable": false,
          "supportOwner": "driver-support"
        },
        "driver": {
          "editable": false,
          "supportOwner": "driver-support"
        },
        "contract": {
          "editable": false,
          "supportOwner": "scheme-support"
        },
        "collection": {
          "editable": false,
          "supportOwner": "collection-support"
        },
        "contact": {
          "editable": false,
          "supportOwner": "employee"
        },
        "expectedReturnMileage": {
          "editable": false,
          "supportOwner": "employee"
        },
        "specialRequirements": {
          "editable": false,
          "supportOwner": "employee"
        }
      }
    }
  },
  "contractVersion": "1.0.0"
};
