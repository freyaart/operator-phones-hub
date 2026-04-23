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
  return base.endsWith('/') ? base.slice(0, -1) : base;
}

export function hasRebornWaveApiConfigured(): boolean {
  return getBaseUrl() != null;
}

export async function fetchRebornWaveProducts(phone: PhoneLookup): Promise<RebornWaveLookupResult | null> {
  const base = getBaseUrl();
  if (!base) return null;

  const modelQuery = phone.marketingName?.trim() || `${phone.brand} ${phone.series}`.trim();
  const url = new URL('/api/product/reborn-products', base);
  url.searchParams.set('query', modelQuery);

  const response = await fetch(url.toString(), {
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
