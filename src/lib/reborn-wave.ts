import { humanizeSeries } from '../discovery/parse-catalog-slug.js';

type PhoneLookup = {
  slug: string;
  brand: string;
  series: string;
  marketingName: string | null;
};

export type RebornWaveProduct = {
  id: number;
  name: string | null;
  optionText: string | null;
  sku: string | null;
  price: number | null;
  oldPrice: number | null;
  conditionStatus: string | null;
  foxwayItemVariantId: string | null;
  purchaseStatus: boolean;
  active: boolean;
  isReborn: boolean;
  matched?: boolean;
};

export type RebornWaveGroup = {
  parent: RebornWaveProduct;
  children: RebornWaveProduct[];
  matchedChildIds: number[];
};

export type RebornWaveLookupResult = {
  modelQuery: string;
  groups: RebornWaveGroup[];
};

const REBORN_QUERY_NOISE_WORDS = [
  'ultramarin',
  'titan',
  'pescena',
  'temno',
  'porcelan',
  'jade',
  'iris',
  'polnocno',
  'kavno',
  'sivka',
  'mornarsko',
  'fog',
  'frost',
  'crno',
  'blescece',
  'modra',
  'senca',
];

const REBORN_STORAGE_HINTS = new Set(['4', '6', '8', '12', '16', '24', '32', '64', '128', '256', '512']);

function getBaseUrl(): string | null {
  const base = process.env.REBORN_WAVE_API_URL?.trim() || '';
  if (!base) return null;
  return base;
}

function getLookupUrl(base: string, modelQuery: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const url = new URL('product/reborn-products', normalizedBase);
  url.searchParams.set('query', modelQuery);
  return url.toString();
}

function normalizeWords(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isTooThinModelName(value: string): boolean {
  const normalized = normalizeWords(value);
  if (!normalized) return true;
  return /^\d+[a-z]?$/i.test(normalized);
}

export function getRebornWaveModelQuery(phone: PhoneLookup): string {
  const brand = normalizeWords(phone.brand);
  const series = normalizeWords(phone.series);
  const marketingName = normalizeWords(phone.marketingName ?? '');
  const slugSeries = normalizeWords(humanizeSeries(phone.slug, phone.brand));
  const base = !isTooThinModelName(series)
    ? series
    : !isTooThinModelName(marketingName)
      ? marketingName
      : slugSeries || `${phone.brand} ${phone.slug}`;
  const includesBrand = new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(base);
  return includesBrand ? base : `${brand} ${base}`.trim();
}

function getRebornWaveFallbackModelQuery(modelQuery: string): string | null {
  const words = normalizeWords(modelQuery)
    .split(' ')
    .map((word) => (word.toLowerCase() === 'xl' ? 'XL' : word));

  const filtered = words.filter((word, index) => {
    const lower = word.toLowerCase();

    if (REBORN_QUERY_NOISE_WORDS.includes(lower)) return false;
    if (lower === '5g' || lower === '4g') return false;
    if (/^\d+(?:gb|tb|mb)$/i.test(word)) return false;
    if (/^\d+$/.test(word) && index > 1 && REBORN_STORAGE_HINTS.has(word)) return false;
    return true;
  });

  const simplified = normalizeWords(filtered.join(' ').replace(/\bproplus\b/gi, 'Pro Plus'));
  return simplified && simplified !== modelQuery ? simplified : null;
}

function getRebornWaveModelQueries(phone: PhoneLookup): string[] {
  const primary = getRebornWaveModelQuery(phone);
  const fallback = getRebornWaveFallbackModelQuery(primary);
  return fallback ? [primary, fallback] : [primary];
}

async function lookupRebornWaveQuery(
  base: string,
  phone: PhoneLookup,
  modelQuery: string,
): Promise<RebornWaveLookupResult | null> {
  const url = getLookupUrl(base, modelQuery);
  const response = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Reborn Wave lookup failed (${response.status}) for ${phone.slug}`);
  }

  const data = (await response.json()) as {
    query?: string;
    groups?: RebornWaveGroup[];
  };
  if (!Array.isArray(data.groups) || data.groups.length === 0) return null;

  return {
    modelQuery: data.query ?? modelQuery,
    groups: data.groups,
  };
}

export function hasRebornWaveApiConfigured(): boolean {
  return getBaseUrl() != null;
}

export async function fetchRebornWaveProducts(phone: PhoneLookup): Promise<RebornWaveLookupResult | null> {
  const base = getBaseUrl();
  if (!base) return null;

  for (const modelQuery of getRebornWaveModelQueries(phone)) {
    const result = await lookupRebornWaveQuery(base, phone, modelQuery);
    if (result) return result;
  }

  return null;
}

/**
 * Brand-level seed queries used when discovering the entire Reborn catalog
 * (Reborn-first sync). The Wave API only takes a `query` parameter, so the
 * Reborn catalog has to be fanned out across coarse brand probes.
 */
export const REBORN_BRAND_SEED_QUERIES: string[] = [
  'Apple',
  'Samsung',
  'Google',
  'Xiaomi',
  'Huawei',
  'Honor',
  'OnePlus',
  'Motorola',
  'Realme',
  'Nothing',
  'Oppo',
  'Doro',
  'Sony',
  'ZTE',
  'Asus',
];

/**
 * Run a single Reborn lookup with a free-form query (no phone slug).
 * Used by the Reborn-first catalog importer.
 */
export async function fetchRebornWaveByQuery(query: string): Promise<RebornWaveLookupResult | null> {
  const base = getBaseUrl();
  if (!base) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;
  return lookupRebornWaveQuery(base, { slug: `query:${trimmed}`, brand: '', series: trimmed, marketingName: null }, trimmed);
}
