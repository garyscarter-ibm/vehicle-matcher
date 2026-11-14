import { describe, expect, it } from 'vitest';
import { stockFactRows, stockFilterOptions } from './stock.presentation';
import { projectStock } from './stock.projection';
import type { StockData, StockDisplayFact, StockGate } from './stock.types';

const origin = (assurance = 'confirmed-build') => ({ sourceRef: 'fixture:stock', observedAt: '2026-11-05T12:00:00.000Z', version: 'facts-v1', assurance });
const sourceFact = (value: StockData, assurance = value === null ? 'unknown' : 'confirmed-build') => ({
  status: value === null ? 'unknown' : 'known', value, unit: null, provenance: origin(assurance),
});
function displayFact(value: StockData, key = 'sourceKey'): StockDisplayFact {
  return { key, label: 'Source label', value, status: value === null ? 'unknown' : 'known', unit: null,
    missingLabel: 'Source did not supply this', provenance: origin(), source: { status: 'known', value, unit: null } };
}
function releasedCars() {
  const versions = { brief: 2, facts: 'facts-v1', policy: 'policy-v1', stock: 'stock-v1', clock: 'clock-v1', draft: 2, context: 'context-v1' };
  const gates: StockGate[] = ['eligible', 'eligible', 'ineligible', 'needs-confirmation'];
  const decisions = gates.map((gateStatus, index) => {
    const orderUuid = `car-${index}`; const candidateKey = `fixture%3Astock:exact-stock:${orderUuid}`;
    return { orderUuid, orderNumber: String(index + 1).padStart(7, '0'), configurationId: 'same-configuration', candidateKey,
      draftVersion: 2, gateStatus, blockers: [], unknowns: [], terms: null,
      versions: { brief: 2, facts: 'facts-v1', policy: 'policy-v1', stock: 'stock-v1', clock: 'clock-v1',
        snapshot: `snapshot-${index}`, terms: null, availability: 'available-v1' },
      snapshot: { identityKind: 'exact-stock', candidateKey, sourceNamespace: 'fixture:stock', sourceKeys: { stockId: orderUuid },
        snapshotVersion: `snapshot-${index}`, display: { name: `Car ${index}` }, facts: {
          series: sourceFact(index < 3 ? '3 Series' : 'i4'), body: sourceFact(index < 2 ? 'estate' : 'coupe'),
          exact: sourceFact('Exact source'), reference: sourceFact('Reference source', 'model-reference'),
          other: sourceFact('Unclassified source', 'derived'),
        } },
    };
  });
  return projectStock({ status: 'ok', value: { state: 'available-stock', decisions,
    cars: decisions.filter(car => car.gateStatus === 'eligible'), total: 2, versions, ranked: false, browsingReservesStock: false } });
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

describe('stock fact presentation', () => {
  it('formats nested arrays and object source keys with the frozen gallery separators', () => {
    const rows = freeze([displayFact([{ sourceCode: 'S0488', detail: [0, false, null, ''] }, { WLTP: { co2Value: 12 } }])]);
    const before = structuredClone(rows);
    const [row] = stockFactRows(rows);
    expect(row.value).toBe('source Code: S0488 · detail: 0; false; Not supplied; Not supplied;  W L T P: co2 Value: 12');
    expect(row.key).toBe('sourceKey'); expect(row.label).toBe('Source label');
    expect(row.provenance).toBe(rows[0].provenance); expect(row.source).toBe(rows[0].source);
    expect(rows).toEqual(before); expect(row).not.toBe(rows[0]);
  });

  it.each([null, '', 0, false, ' ', '<img src=x>', 1234.5] as const)('preserves scalar %s and explicit missing semantics', value => {
    const input = freeze({ ...displayFact(value), unit: 'g/km', missingLabel: 'CO2 not supplied (g/km)' });
    const [row] = stockFactRows([input]);
    expect(row.value).toBe(value); expect(row.unit).toBe('g/km'); expect(row.missingLabel).toBe(input.missingLabel);
    expect(row.status).toBe(input.status); expect(row.source).toBe(input.source);
  });

  it('handles empty nested data and empty rows without inventing supplied facts', () => {
    expect(stockFactRows([displayFact([]), displayFact({})]).map(row => row.value)).toEqual(['', '']);
    expect(stockFactRows([displayFact('Text')])[0].unit).toBeUndefined();
    expect(stockFactRows([])).toEqual([]);
  });

  it('keeps projected facts, exact, reference and unclassified groups in supplied order', () => {
    const projection = freeze(releasedCars()); const detail = projection.allCars[0].detail;
    for (const group of [detail.facts, detail.exactFacts, detail.referenceFacts, detail.unclassifiedFacts]) {
      const rows = stockFactRows(group);
      expect(rows.map(row => row.key)).toEqual(group.map(row => row.key));
      expect(rows.map(row => row.provenance)).toEqual(group.map(row => row.provenance));
      expect(rows.map(row => row.source)).toEqual(group.map(row => row.source));
    }
    expect(stockFactRows(detail.referenceFacts).map(row => row.value)).toEqual(['Reference source']);
    expect(stockFactRows(detail.unclassifiedFacts).map(row => row.value)).toEqual(['Unclassified source']);
  });
});

describe('stock filter presentation', () => {
  it('counts every released decision and distinct exact cars sharing a configuration', () => {
    const projection = freeze(releasedCars()); const before = structuredClone(projection);
    const series = freeze(['i4', '3 Series']); const bodies = freeze(['coupe', 'estate']);
    const controls = freeze({ series: 'i4', body: 'coupe', query: 'unmatched query', sort: 'points' });
    expect(projection.allCars).toHaveLength(4); expect(projection.cars).toHaveLength(2);
    expect(new Set(projection.allCars.map(car => car.identity.configurationId)).size).toBe(1);
    expect(new Set(projection.allCars.map(car => car.identity.orderUuid)).size).toBe(4);
    expect(stockFilterOptions(projection.allCars, series, bodies, controls)).toEqual({
      series: [{ value: '', label: 'All series', sub: '4 cars' }, { value: 'i4', label: 'i4', sub: '1 car' },
        { value: '3 Series', label: '3 Series', sub: '3 cars' }],
      bodies: [{ value: '', label: 'All body styles', sub: '4 cars' }, { value: 'coupe', label: 'Coupé', sub: '2 cars' },
        { value: 'estate', label: 'Estate', sub: '2 cars' }],
    });
    expect(projection).toEqual(before); expect(controls.series).toBe('i4'); expect(series).toEqual(['i4', '3 Series']);
  });

  it('retains unavailable selected source values without changing selection or duplicating present ones', () => {
    const cars = releasedCars().allCars;
    const controls = freeze({ series: 'Saved Series', body: 'sport_utility' });
    const options = stockFilterOptions(cars, ['3 Series', 'i4'], ['estate', 'coupe'], controls);
    expect(options.series.at(-1)).toEqual({ value: 'Saved Series', label: 'Saved Series (not currently available)', sub: '0 cars' });
    expect(options.bodies.at(-1)).toEqual({ value: 'sport_utility', label: 'Sport Utility (not currently available)', sub: '0 cars' });
    expect(controls).toEqual({ series: 'Saved Series', body: 'sport_utility' });
    expect(stockFilterOptions(cars, ['3 Series'], ['estate'], { series: '3 Series', body: 'estate' }).series).toHaveLength(2);
  });

  it.each([
    ['hatchback', 'Hatchback'], ['saloon', 'Saloon'], ['estate', 'Estate'], ['suv', 'SUV'], ['coupe', 'Coupé'],
    ['convertible', 'Convertible'], ['mpv', 'Family carrier'], ['  sport_UTILITY-body  ', 'Sport Utility Body'],
    ['constructor', 'Constructor'], ['toString', 'Tostring'],
  ])('labels body %s while preserving its exact source value', (value, label) => {
    expect(stockFilterOptions([], [], [value], { series: '', body: value }).bodies).toEqual([
      { value: '', label: 'All body styles', sub: '0 cars' }, { value, label, sub: '0 cars' },
    ]);
  });

  it('shows singular totals and zero totals including absent saved choices in an empty stock set', () => {
    expect(stockFilterOptions(releasedCars().allCars.slice(0, 1), [], [], { series: '', body: '' }).series[0].sub).toBe('1 car');
    expect(stockFilterOptions([], [], [], { series: '', body: '' })).toEqual({
      series: [{ value: '', label: 'All series', sub: '0 cars' }], bodies: [{ value: '', label: 'All body styles', sub: '0 cars' }],
    });
    expect(stockFilterOptions([], [], [], { series: 'Old', body: 'mpv' }).bodies.at(-1)).toEqual({
      value: 'mpv', label: 'Family carrier (not currently available)', sub: '0 cars',
    });
  });
});
