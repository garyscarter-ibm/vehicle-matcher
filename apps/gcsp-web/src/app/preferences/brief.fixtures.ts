import { BriefCurrentValue, BriefEditor, BriefPreferenceSaveValue, BriefPreview } from './brief.types';
export const briefEditorFixture = (): BriefEditor => ({
  context: {
    preferences: { economy: { type: 'slider', label: 'Economy', editable: true }, body: { type: 'enum', label: 'Body style', editable: true, multiple: true, values: ['saloon', 'estate'] } },
    essentials: { seats: { type: 'number', operator: 'gte', unit: 'count', minimum: 0, integer: true, editable: true }, charging: { type: 'enum', operator: 'eq', unit: null, values: ['home', 'work', 'either', 'none'], editable: true } },
    slider: { minimum: 0, maximum: 100 }, knownFacts: { currentContract: { value: { contractId: 'contract-1', model: 'Current car' }, source: 'manual-account', sourceVersion: 1, observedAt: '2026-11-14T10:00:00Z', editable: false } }, permissions: { currentContract: { editable: false } },
    policyVersion: 'policy-v1', contextVersion: 'context-v1', practicalQuestions: { seats: { label: 'Do you need at least five seats?', yes: 5, no: 2, unknown: null }, charging: { label: 'Can you charge?', yes: ['home', 'work', 'either'], no: 'none', unknown: null } },
    unconfirmedLabel: 'Not confirmed', assumptions: [],
    accountPreferences: { schemaVersion: 1, policyVersion: 'policy-v1', order: ['body', 'economy'], minimumCategories: 2, importance: { medium: 50, high: 100 }, categories: {
      body: { kind: 'multi', label: 'Body style', question: 'What body styles?', options: [{ value: 'saloon', label: 'Saloon' }, { value: 'estate', label: 'Estate' }] },
      economy: { kind: 'stops', label: 'Economy', question: 'How economical?', openDefault: 50, stops: [{ value: 0, label: 'Less' }, { value: 50, label: 'Medium' }, { value: 100, label: 'More' }] },
    }, understanding: { kind: 'input-completeness', maximum: 100, byConsidered: [0, 50, 100], sameAgain: 100, policyKey: 'brief.accountPreferences.v1' } },
  },
  initial: {
    brief: { schemaVersion: 1, preferences: { economy: { value: 50, importance: 50, valueState: 'draft', importanceState: 'draft', source: 'employee' }, body: { value: ['saloon'], importance: 0, valueState: 'draft', importanceState: 'draft', source: 'employee' } }, essentials: { seats: { value: null, operator: 'gte', unit: 'count', state: 'needs-confirmation', source: 'employee' }, charging: { value: null, operator: 'eq', unit: null, state: 'needs-confirmation', source: 'employee' } }, currentCarFeedback: { preserve: ['economy'], change: ['body'], state: 'confirmed', source: 'employee' } },
    briefVersion: 4, draftVersion: 2,
    accountPreferences: { considered: 1, categories: { economy: { state: 'considered', value: 50, importance: 'medium', exact: true }, body: { state: 'unset' } }, sameAgain: false, understanding: { kind: 'input-completeness', value: 50, maximum: 100, basis: 'considered-categories', considered: 1, policyKey: 'brief.accountPreferences.v1', policyVersion: 'policy-v1' } },
    currentCarRating: { contractId: 'contract-1', value: null }, sameAgain: { available: true, on: false, contractId: 'contract-1' },
    buddy: { state: 'disengaged', reason: null, permissionVersion: null, minimumCategories: 2, considered: 1, remaining: 1, sameAgain: false, canEngage: false }, consent: { search: false, hold: false },
  }, versions: { policy: 'policy-v1', context: 'context-v1', facts: 'facts-v1', clock: 'clock-v1' }, selection: null,
});
export function preferenceSaveFixture(): BriefPreferenceSaveValue { const initial = briefEditorFixture().initial; return { ...initial, briefVersion: 4, draftVersion: 3, buddyTransition: null }; }
export function currentBriefFixture(): BriefCurrentValue { return { brief: { ...briefEditorFixture().initial.brief, briefVersion: 5, status: 'confirmed' }, activity: { canSearch: false, canHold: false, existingOffersUnaffected: true, existingOffers: [] }, validation: { policyVersion: 'policy-v1', unknownEssentials: ['seats', 'charging'], assumptions: [] } }; }

// Presentation fields copied from docs/gcsp/evidence/fucq94/representative-snapshot.json.
// Synthetic source fixture only; not live adapter or acceptance evidence.
export const representativePreviewFixture = (): BriefPreview => ({
  "state": "recommendations",
  "eligibleCount": 1,
  "versions": {
    "brief": null,
    "facts": "employee-facts-v1",
    "policy": "gcsp-policy-v1",
    "stock": "stock-v1",
    "clock": "1"
  },
  "decisions": [
    {
      "orderUuid": "00000000-0000-4000-8000-000000000001",
      "configurationId": "RzIxOlMx",
      "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000001",
      "gateStatus": "eligible",
      "versions": {
        "brief": null,
        "facts": "employee-facts-v1",
        "policy": "gcsp-policy-v1",
        "stock": "stock-v1",
        "snapshot": "snapshot-v1",
        "terms": "gcsp-policy-v1:price.choices-fs-uk.015:allowance.choices-fs-uk.G7:2026-11-05T09:00:00.000Z",
        "clock": "1",
        "availability": "availability-v1"
      },
      "snapshot": {
        "display": {
          "name": "BMW 320i M Sport Touring",
          "photo": "/assets/brand-hero/bmw.jpg",
          "images": [
            {
              "src": "/assets/brand-hero/bmw.jpg"
            }
          ]
        },
        "facts": {
          "body": {
            "status": "known",
            "value": "estate",
            "unit": null
          },
          "fuel": {
            "status": "known",
            "value": "petrol",
            "unit": null
          },
          "seats": {
            "status": "known",
            "value": 5,
            "unit": "count"
          },
          "boot": {
            "status": "known",
            "value": 500,
            "unit": "L"
          },
          "zeroTo62": {
            "status": "known",
            "value": 7,
            "unit": "s"
          },
          "mpg": {
            "status": "known",
            "value": 45,
            "unit": "mpg-imperial"
          }
        }
      },
      "terms": {
        "points": {
          "value": 1100,
          "unit": "points"
        },
        "allowanceInputs": {
          "allowance": {
            "value": 1300,
            "unit": "points"
          }
        }
      },
      "reasons": [
        {
          "code": "driver-eligible"
        },
        {
          "code": "policy-include"
        },
        {
          "code": "allowance-sufficient",
          "allowance": 1300,
          "monthlyPoints": 1100
        },
        {
          "code": "essential-met",
          "field": "seats"
        },
        {
          "code": "essential-met",
          "field": "boot"
        },
        {
          "code": "essential-met",
          "field": "equipment"
        },
        {
          "code": "required-by-met"
        },
        {
          "code": "preference-fit",
          "field": "body",
          "score": 100,
          "desired": "estate",
          "observed": 100
        },
        {
          "code": "preference-fit",
          "field": "fuel",
          "score": 100,
          "desired": "petrol",
          "observed": 100
        }
      ],
      "tradeOffs": [
        {
          "code": "preference-fit",
          "field": "sportiness",
          "score": 23,
          "desired": 90,
          "observed": 13
        },
        {
          "code": "preference-fit",
          "field": "comfort",
          "score": 90,
          "desired": 90,
          "observed": 100
        },
        {
          "code": "preference-fit",
          "field": "size",
          "score": 90,
          "desired": 50,
          "observed": 60
        }
      ],
      "blockers": [],
      "unknowns": []
    },
    {
      "orderUuid": "00000000-0000-4000-8000-000000000002",
      "configurationId": "RzIxOlMx",
      "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000002",
      "gateStatus": "needs-confirmation",
      "versions": {
        "brief": null,
        "facts": "employee-facts-v1",
        "policy": "gcsp-policy-v1",
        "stock": "stock-v1",
        "snapshot": "snapshot-v1",
        "terms": "gcsp-policy-v1:price.choices-fs-uk.015:allowance.choices-fs-uk.G7:2026-11-05T09:00:00.000Z",
        "clock": "1",
        "availability": "availability-v1"
      },
      "snapshot": {
        "display": {
          "name": "BMW 330e M Sport Pro Edition Touring with Technology Plus and Comfort Pack"
        },
        "facts": {
          "body": {
            "status": "known",
            "value": "estate",
            "unit": null
          },
          "fuel": {
            "status": "known",
            "value": "phev",
            "unit": null
          },
          "seats": {
            "status": "known",
            "value": 5,
            "unit": "count"
          },
          "boot": {
            "status": "known",
            "value": 500,
            "unit": "L"
          },
          "zeroTo62": {
            "status": "known",
            "value": 7,
            "unit": "s"
          },
          "mpg": {
            "status": "known",
            "value": 45,
            "unit": "mpg-imperial"
          }
        }
      },
      "terms": {
        "points": {
          "value": 1100,
          "unit": "points"
        },
        "allowanceInputs": {
          "allowance": {
            "value": 1300,
            "unit": "points"
          }
        }
      },
      "reasons": [
        {
          "code": "driver-eligible"
        },
        {
          "code": "policy-include"
        },
        {
          "code": "allowance-sufficient",
          "allowance": 1300,
          "monthlyPoints": 1100
        },
        {
          "code": "essential-met",
          "field": "seats"
        },
        {
          "code": "essential-met",
          "field": "boot"
        },
        {
          "code": "essential-met",
          "field": "equipment"
        },
        {
          "code": "required-by-met"
        }
      ],
      "tradeOffs": [],
      "blockers": [],
      "unknowns": [
        {
          "code": "charging-unconfirmed"
        }
      ]
    }
  ],
  "recommendations": [
    {
      "orderUuid": "00000000-0000-4000-8000-000000000001",
      "configurationId": "RzIxOlMx",
      "candidateKey": "fixture%3Aemployee:exact-stock:00000000-0000-4000-8000-000000000001",
      "gateStatus": "eligible",
      "versions": {
        "brief": null,
        "facts": "employee-facts-v1",
        "policy": "gcsp-policy-v1",
        "stock": "stock-v1",
        "snapshot": "snapshot-v1",
        "terms": "gcsp-policy-v1:price.choices-fs-uk.015:allowance.choices-fs-uk.G7:2026-11-05T09:00:00.000Z",
        "clock": "1",
        "availability": "availability-v1"
      },
      "snapshot": {
        "display": {
          "name": "BMW 320i M Sport Touring",
          "photo": "/assets/brand-hero/bmw.jpg",
          "images": [
            {
              "src": "/assets/brand-hero/bmw.jpg"
            }
          ]
        },
        "facts": {
          "body": {
            "status": "known",
            "value": "estate",
            "unit": null
          },
          "fuel": {
            "status": "known",
            "value": "petrol",
            "unit": null
          },
          "seats": {
            "status": "known",
            "value": 5,
            "unit": "count"
          },
          "boot": {
            "status": "known",
            "value": 500,
            "unit": "L"
          },
          "zeroTo62": {
            "status": "known",
            "value": 7,
            "unit": "s"
          },
          "mpg": {
            "status": "known",
            "value": 45,
            "unit": "mpg-imperial"
          }
        }
      },
      "terms": {
        "points": {
          "value": 1100,
          "unit": "points"
        },
        "allowanceInputs": {
          "allowance": {
            "value": 1300,
            "unit": "points"
          }
        }
      },
      "reasons": [
        {
          "code": "driver-eligible"
        },
        {
          "code": "policy-include"
        },
        {
          "code": "allowance-sufficient",
          "allowance": 1300,
          "monthlyPoints": 1100
        },
        {
          "code": "essential-met",
          "field": "seats"
        },
        {
          "code": "essential-met",
          "field": "boot"
        },
        {
          "code": "essential-met",
          "field": "equipment"
        },
        {
          "code": "required-by-met"
        },
        {
          "code": "preference-fit",
          "field": "body",
          "score": 100,
          "desired": "estate",
          "observed": 100
        },
        {
          "code": "preference-fit",
          "field": "fuel",
          "score": 100,
          "desired": "petrol",
          "observed": 100
        }
      ],
      "tradeOffs": [
        {
          "code": "preference-fit",
          "field": "sportiness",
          "score": 23,
          "desired": 90,
          "observed": 13
        },
        {
          "code": "preference-fit",
          "field": "comfort",
          "score": 90,
          "desired": 90,
          "observed": 100
        },
        {
          "code": "preference-fit",
          "field": "size",
          "score": 90,
          "desired": 50,
          "observed": 60
        }
      ],
      "blockers": [],
      "unknowns": []
    }
  ]
});
