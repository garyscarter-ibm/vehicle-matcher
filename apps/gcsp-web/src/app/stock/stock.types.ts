export type StockData = null | boolean | number | string | readonly StockData[] | { readonly [key: string]: StockData };
export interface StockRecord { readonly [key: string]: unknown }
export type StockGate = 'eligible' | 'ineligible' | 'needs-confirmation';
export interface StockProvenance extends StockRecord {
  readonly sourceRef: string; readonly observedAt: string; readonly version: string; readonly assurance: string;
}
export interface StockFact extends StockRecord {
  readonly status: 'known' | 'unknown'; readonly value: StockData; readonly unit: string | null;
  readonly provenance?: StockProvenance;
}
export interface StockImage extends StockRecord {
  readonly src: string; readonly alt?: string | null; readonly caption?: string | null; readonly provenance?: StockRecord;
}
export interface StockSnapshot extends StockRecord {
  readonly identityKind: 'exact-stock'; readonly candidateKey: string; readonly sourceNamespace: string;
  readonly sourceKeys: StockRecord & { readonly stockId: string }; readonly snapshotVersion: string;
  readonly facts: Readonly<Record<string, StockFact>>;
  readonly display: StockRecord & { readonly name?: string | null; readonly photo?: string | null; readonly images?: readonly StockImage[] };
}
export interface StockPoints { readonly value: number; readonly unit: 'points' }
export interface StockContribution { readonly amount: number; readonly currency: string; readonly period: 'month' | 'year' | 'one-off' }
export interface StockTerms extends StockRecord {
  readonly kind: 'employee-scheme'; readonly termsVersion: string; readonly points: StockPoints;
  readonly allowanceInputs: Readonly<Record<string, StockPoints>>; readonly contribution: StockContribution | null;
  readonly provenance?: StockProvenance; readonly validFrom?: string; readonly validUntil?: string;
}
export interface StockVersions extends StockRecord {
  readonly brief: number; readonly facts: string; readonly policy: string; readonly stock: string; readonly clock: string;
  readonly draft: number; readonly context: string;
}
export interface StockDecisionVersions extends StockRecord {
  readonly brief: number; readonly facts: string; readonly policy: string; readonly stock: string; readonly clock: string;
  readonly snapshot: string; readonly terms: string | null; readonly availability: string;
}
export interface StockClaimInput {
  readonly orderUuid: string; readonly expectedStockVersion: number; readonly expectedDraftVersion: number;
  readonly expectedContextVersion: string; readonly expectedTermsDigest: string;
}
export interface StockIdentity {
  readonly orderUuid: string; readonly orderNumber: string; readonly configurationId: string; readonly candidateKey: string;
}
export interface StockDecision extends StockIdentity, StockRecord {
  readonly draftVersion: number; readonly gateStatus: StockGate; readonly snapshot: StockSnapshot;
  readonly score?: null; readonly suitable?: boolean;
  readonly terms: StockTerms | null; readonly versions: StockDecisionVersions; readonly claimInput?: StockClaimInput | null;
  readonly blockers: readonly (StockRecord | string)[]; readonly unknowns: readonly (StockRecord | string)[];
}
export interface StockReleaseHistory extends StockRecord {
  readonly runId: string; readonly observedAt: string; readonly source: StockRecord & { readonly state: 'current-version-unknown' };
  readonly history: { readonly state: 'none-visible' | 'released'; readonly releasedCarCount: number;
    readonly releaseCount: number; readonly latestReleasedAt: string | null; readonly sourceVersions: readonly string[] };
}
export interface StockPayload extends StockRecord {
  readonly state: 'available-stock' | 'no-eligible-stock' | 'empty-stock' | 'nothing-released-yet';
  readonly decisions: readonly StockDecision[]; readonly cars: readonly StockDecision[]; readonly total: number;
  readonly versions: StockVersions; readonly ranked: false; readonly browsingReservesStock: false;
  readonly releaseHistory?: StockReleaseHistory; readonly heldOffer?: StockRecord | null;
}
export interface StockDisplayFact {
  readonly key: string; readonly label: string; readonly value: StockData; readonly status: 'known' | 'unknown';
  readonly unit: string | null; readonly missingLabel: string; readonly provenance?: StockProvenance;
  readonly source?: StockFact; readonly basis?: string | null;
}
export interface StockMedia {
  readonly src: string | null; readonly alt: string; readonly caption: string | null;
  readonly provenance?: StockRecord; readonly images: readonly StockImage[];
}
export interface StockCar {
  readonly id: string; readonly identity: StockIdentity; readonly gateStatus: StockGate;
  readonly name: string; readonly fields: Readonly<Record<string, StockDisplayFact>>; readonly emissions: readonly StockDisplayFact[];
  readonly series: StockDisplayFact; readonly media: StockMedia;
  readonly cost: { readonly kind: 'points-monthly'; readonly value: number | null; readonly allowance: number | null };
  readonly contribution: StockContribution | null;
  readonly detail: { readonly identity: StockIdentity; readonly snapshot: StockSnapshot; readonly facts: readonly StockDisplayFact[];
    readonly exactFacts: readonly StockDisplayFact[]; readonly referenceFacts: readonly StockDisplayFact[];
    readonly unclassifiedFacts: readonly StockDisplayFact[]; readonly media: StockMedia; readonly terms: StockTerms | null;
    readonly equipment: StockFact | null; readonly specifications: StockFact | null; readonly historic: StockFact | null };
  readonly review: StockIdentity & { readonly facts: Readonly<Record<string, StockFact>>; readonly snapshot: StockSnapshot;
    readonly terms: StockTerms | null; readonly draftVersion: number; readonly versions: StockVersions;
    readonly decisionVersions: StockDecisionVersions; readonly claimInput: StockClaimInput | null };
  readonly reviewAvailable: boolean; readonly reviewDisabledReason: string | null; readonly evidence: StockDecision;
}
export type StockState = 'available-stock' | 'no-suitable-stock' | 'empty-stock' | 'nothing-released-yet' | 'no-visible-releases'
  | 'choices-invalid' | 'context-refresh' | 'car-taken' | 'source-unavailable';
export interface StockProjection {
  readonly state: StockState; readonly allCars: readonly StockCar[]; readonly cars: readonly StockCar[];
  readonly counts: { readonly records: number; readonly eligible: number }; readonly source: StockPayload | null;
  readonly releaseHistory: StockReleaseHistory | null; readonly failure: StockRecord | null;
  readonly ranked: false; readonly browsingReservesStock: false;
}
