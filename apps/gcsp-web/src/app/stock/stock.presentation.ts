import type { FactRow } from '../kit/fact-list.component';
import type { OptionListOption } from '../kit/option-list.component';
import type { StockControls } from './stock.store';
import type { StockCar, StockData, StockDisplayFact } from './stock.types';

function shown(value: StockData): string {
  if (value === null || value === '') return 'Not supplied';
  if (Array.isArray(value)) return value.map(shown).join('; ');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) =>
    `${key.replace(/([A-Z])/g, ' $1')}: ${shown(item)}`).join(' · ');
  return String(value);
}

export function stockFactRows(rows: readonly StockDisplayFact[]) {
  return rows.map(row => ({ ...row, unit: row.unit ?? undefined,
    value: typeof row.value === 'object' && row.value !== null ? shown(row.value) : row.value } satisfies FactRow));
}

const bodyLabels: Readonly<Record<string, string>> = {
  hatchback: 'Hatchback', saloon: 'Saloon', estate: 'Estate', suv: 'SUV',
  coupe: 'Coupé', convertible: 'Convertible', mpv: 'Family carrier',
};
function bodyLabel(value: string): string {
  const key = value.trim();
  return Object.hasOwn(bodyLabels, key) ? bodyLabels[key]
    : key.replace(/[-_]+/g, ' ').toLowerCase().replace(/(^|\s)\S/g, part => part.toUpperCase());
}
const carCount = (count: number): string => `${count.toLocaleString('en-GB')} ${count === 1 ? 'car' : 'cars'}`;

function choices(cars: readonly StockCar[], values: readonly string[], selected: string, all: string,
  read: (car: StockCar) => StockData, label: (value: string) => string): readonly OptionListOption[] {
  return [{ value: '', label: all, sub: carCount(cars.length) },
    ...values.map(value => ({ value, label: label(value), sub: carCount(cars.filter(car => read(car) === value).length) })),
    ...(selected && !values.includes(selected)
      ? [{ value: selected, label: `${label(selected)} (not currently available)`, sub: carCount(0) }] : [])];
}

export function stockFilterOptions(allCars: readonly StockCar[], series: readonly string[], bodies: readonly string[],
  controls: Pick<StockControls, 'series' | 'body'>) {
  return {
    series: choices(allCars, series, controls.series, 'All series', car => car.series.value, value => value),
    bodies: choices(allCars, bodies, controls.body, 'All body styles', car => car.fields['body'].value, bodyLabel),
  };
}
