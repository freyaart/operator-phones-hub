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

function buildModelQuery(phone: PhoneLookup): string {
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

export function hasRebornWaveApiConfigured(): boolean {
  return getBaseUrl() != null;
}

export async function fetchRebornWaveProducts(phone: PhoneLookup): Promise<RebornWaveLookupResult | null> {
  const base = getBaseUrl();
  if (!base) return null;

  const modelQuery = buildModelQuery(phone);
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
