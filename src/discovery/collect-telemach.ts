import { parseCatalogName } from './parse-catalog-slug.js';
import type { CatalogDiscoveryItem } from './types.js';

const LISTING_URL = 'https://telemach.si/api/GetProductListing';
const PDP_BASE = 'https://telemach.si/naprave/mobilni-telefoni';

type TelemachProduct = {
  productId: string | number;
  title: string;
  brand?: string | null;
  packageTitle?: string | null;
  installmentPeriod?: number | null;
  installmentValue?: number | null;
  upfrontFee?: number | null;
  productUrl: string;
  colorTitle?: string | null;
};

type TelemachListingResponse = {
  totalCount?: number;
  productGroups?: Array<{
    items?: TelemachProduct[];
    stickerText?: string | null;
  }>;
};

async function fetchTelemachListingPage(pageIndex: number, pageSize: number) {
  const response = await fetch(LISTING_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      origin: 'https://telemach.si',
      referer: `${PDP_BASE}#&page=${pageIndex + 1}`,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      pageIndex,
      pageSize,
      getAllPages: false,
      selectedBrands: [],
      packageCode: null,
      sortOrder: 0,
      minPrice: 0,
      maxPrice: 20000,
      tariffType: 'Voice',
      userType: 'Postpaid',
      networkType: 'Mobile',
      deviceType: 'mobilni-telefoni',
      devicePromo: '',
      isPromoOnly: false,
      isPageLoad: pageIndex === 0,
      deviceProperty: {},
      selectedOS: null,
      selectedHardwareType: null,
      installmentPeriod: 24,
    }),
  });
  if (!response.ok) {
    throw new Error(`Telemach listing failed: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as TelemachListingResponse;
}

function productSourceUrl(productUrl: string): string {
  const normalized = productUrl.replace(/^\/+/, '');
  return `${PDP_BASE}/${normalized}`;
}

export async function collectTelemachCatalogItems(pageSize = 12): Promise<CatalogDiscoveryItem[]> {
  const all = new Map<string, CatalogDiscoveryItem>();
  let pageIndex = 0;
  let totalPages = 1;

  while (pageIndex < totalPages) {
    const payload = await fetchTelemachListingPage(pageIndex, pageSize);
    const groups = payload.productGroups ?? [];
    for (const group of groups) {
      for (const product of group.items ?? []) {
        const parsed = parseCatalogName({
          brand: product.brand,
          name: product.title,
        });
        if (!parsed.isPhone) continue;

        const operatorItemKey = String(product.productId);
        const sourceUrl = productSourceUrl(product.productUrl);
        const variantBits = [
          product.packageTitle ? `paket ${product.packageTitle}` : null,
          product.installmentPeriod && product.installmentValue != null
            ? `${product.installmentPeriod} x ${product.installmentValue.toFixed(2)} EUR`
            : null,
          product.upfrontFee != null ? `polog ${product.upfrontFee.toFixed(2)} EUR` : null,
          group.stickerText ?? null,
        ].filter(Boolean);

        all.set(operatorItemKey, {
          operator: 'telemach',
          operatorItemKey,
          sourceUrl,
          displayName: [product.brand, product.title].filter(Boolean).join(' ').trim(),
          variantLabel: variantBits.length > 0 ? variantBits.join(' | ') : null,
          color: product.colorTitle ?? parsed.color,
          storageGb: parsed.storageGb,
          availability: 'IN_STOCK',
          canonicalSlug: parsed.canonicalSlug,
          brand: parsed.brand,
          series: parsed.series,
          isPhone: parsed.isPhone,
        });
      }
    }
    totalPages = Math.max(Math.ceil((payload.totalCount ?? 0) / pageSize), 1);
    pageIndex += 1;
  }

  return [...all.values()];
}
