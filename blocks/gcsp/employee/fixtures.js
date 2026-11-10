// SYNTHETIC fixtures for the employee shell: no real person, car or account data.
// Points values are assumed, synthetic policy entries; each records its policy key and version.
import { renderRepresentativeBody } from './representative-body.js';

export const FIXTURE_NAMES = Object.freeze(['representative', 'representative-loading', 'representative-unavailable', 'representative-no-images']);

export const REPRESENTATIVE_ACCOUNT = Object.freeze({
  status: 'ready',
  name: 'Alex Brennan',
  context: 'Choices, grade G7',
});

const POLICY_VERSION = 'gcsp-policy-v1';
const IMAGE = new URL('../../../assets/brand-hero/bmw.jpg', import.meta.url).href;
const points = (value, policyKey) => ({ value, unit: 'points/month', policyKey, policyVersion: POLICY_VERSION, status: 'assumed, synthetic' });
const photo = (on, crop) => (on ? { src: IMAGE, crop } : null);

/** Fresh fixture data. photos: false drops every image, including the current car's. */
export function representativeData({ photos = true } = {}) {
  return {
    now: '2026-11-05',
    synthetic: true,
    allowance: points(1300, 'allowance.choices-fs-uk.G7'),
    currentCar: {
      name: 'BMW 320i M Sport Touring',
      photo: photo(photos, 'car'),
      registration: 'SY25 DEM',
      vin: 'ZZSYNTHETIC000001',
      contractStart: '2026-06-02',
      contractEnd: '2026-12-02',
      term: '6 months',
      miles: 8500,
      scheme: 'Choices FS UK',
      points: points(1100, 'price.choices-fs-uk.015'),
      details: [
        { label: 'Contract start', date: '2026-06-02' },
        { label: 'Collection site', value: 'Bracknell collection centre' },
        { label: 'Licence type', value: 'Full car licence' },
        { label: 'Licence number', value: null },
        { label: 'Additional drivers', value: '1 approved' },
      ],
    },
    stock: [
      {
        orderUuid: '8f1c2b64-0000-4000-8000-000000000001', orderNumber: '4815162', configurationId: 'CFG-G21-320I-0001',
        name: 'BMW 320i M Sport Touring', photo: photo(photos, 'car'),
        colour: 'Portimao Blue metallic', interior: 'Vernasca leather, Black', fuel: 'Petrol', transmission: 'Automatic',
        co2: 143, collection: '2026-12-14', points: points(1100, 'price.choices-fs-uk.015'),
      },
      {
        orderUuid: '8f1c2b64-0000-4000-8000-000000000002', orderNumber: '2718281', configurationId: 'CFG-G21-330E-0002',
        name: 'BMW 330e M Sport Pro Edition Touring with Technology Plus and Comfort Pack', photo: null,
        colour: 'Brooklyn Grey metallic', interior: 'Sensatec, Oyster', fuel: 'Plug-in hybrid', transmission: 'Automatic',
        co2: null, collection: '2026-12-21', points: points(1100, 'price.choices-fs-uk.016'),
      },
      {
        orderUuid: '8f1c2b64-0000-4000-8000-000000000003', orderNumber: '1618033', configurationId: 'CFG-G61-530E-0003',
        name: 'BMW 530e M Sport Touring', photo: photo(photos, 'right'),
        colour: 'Carbon Black metallic', interior: 'Veganza, Cognac', fuel: 'Plug-in hybrid', transmission: 'Automatic',
        co2: 29, collection: '2027-01-11', points: points(1400, 'price.choices-fs-uk.027'),
      },
    ],
  };
}

export const REPRESENTATIVE_DATA = representativeData();

function never(signal) {
  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

function after(ms, signal, produce) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(produce()), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

const withBody = (data) => (main, ctx) => renderRepresentativeBody(main, { ...ctx, data });

/** Adapter for the named fixture, or null when the name is unknown. */
export function fixtureAdapter(name) {
  const noImages = name === 'representative-no-images';
  if (name === 'representative' || noImages) {
    const data = representativeData({ photos: !noImages });
    return {
      loadAccount: ({ signal } = {}) => after(400, signal, () => ({ ...REPRESENTATIVE_ACCOUNT })),
      renderBody: withBody(data),
    };
  }
  if (name === 'representative-loading') {
    return { loadAccount: ({ signal } = {}) => never(signal), renderBody: withBody(representativeData()) };
  }
  if (name === 'representative-unavailable') {
    return {
      loadAccount: ({ signal } = {}) => after(300, signal, () => ({ status: 'unavailable', message: 'Your account could not be loaded.' })),
      renderBody: withBody(representativeData()),
    };
  }
  return null;
}
