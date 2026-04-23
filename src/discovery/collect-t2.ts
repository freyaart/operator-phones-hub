import { parseCatalogName } from './parse-catalog-slug.js';
import type { CatalogDiscoveryItem } from './types.js';
import { normalizeAvailability, operatorItemKeyFromUrl } from '../sync/upsert-catalog-item.js';

const BASE = 'https://klub.t-2.net';
const SEARCH_URL = `${BASE}/ajaxpro/PIA.portal.modules.shop.filter_search.filters,PIA2.ashx`;

type T2SearchResponse = {
  value?: {
    items?: {
      resultsHTML?: string;
      totalPages?: number;
      totalItems?: number;
    };
  };
};

function decodeHtml(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(input: string): string {
  return decodeHtml(input).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseEuro(text: string): number | null {
  const match = text.match(/([\d.]+,\d{2})\s*€/);
  if (!match) return null;
  return Number.parseFloat(match[1].replace(/\./g, '').replace(',', '.'));
}

async function fetchT2SearchPage(pageIndex: number, pageSize: number) {
  const response = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'text/plain; charset=UTF-8',
      'x-ajaxpro-method': 'Search',
      referer: `${BASE}/katalog-ugodnosti.aspx?departmentId=13&department=telefonija`,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      parameters: {
        Filters: [],
        Manufacturers: [],
        DepartmentId: 13,
        DepartmentGroupId: null,
        CategoryId: null,
        PageIndex: pageIndex,
        PageSize: pageSize,
        OrderBy: '4',
        IsBusiness: false,
        PortalID: '21',
        UserID: '4',
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`T-2 search failed: ${response.status} ${response.statusText}`);
  }
  const json = (await response.json()) as T2SearchResponse;
  return json.value?.items ?? {};
}

function parseT2ResultsHtml(resultsHTML: string): CatalogDiscoveryItem[] {
  const products = resultsHTML.split(/<div class='product'>/i).slice(1);
  const items: CatalogDiscoveryItem[] = [];

  for (const product of products) {
    const href = product.match(/href="([^"]*\/ponudba\.aspx\/[^"]+)"/i)?.[1];
    const titleHtml = product.match(/<h5 class="product_tile">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    if (!href || !titleHtml) continue;

    const displayName = stripHtml(titleHtml);
    const parsed = parseCatalogName({ name: displayName });
    if (!parsed.isPhone) continue;

    const cardText = stripHtml(product);
    const retailPriceEur = parseEuro(cardText);
    const sourceUrl = href.startsWith('http') ? href : `${BASE}${href}`;
    items.push({
      operator: 't2',
      operatorItemKey: operatorItemKeyFromUrl(sourceUrl),
      sourceUrl,
      displayName,
      variantLabel: cardText || null,
      color: parsed.color,
      storageGb: parsed.storageGb,
      availability: normalizeAvailability(cardText) === 'UNKNOWN' ? 'IN_STOCK' : normalizeAvailability(cardText),
      canonicalSlug: parsed.canonicalSlug,
      brand: parsed.brand,
      series: parsed.series,
      isPhone: parsed.isPhone,
      listingOffers:
        retailPriceEur != null
          ? [
              {
                offerKey: 'retail',
                offerType: 'RETAIL',
                title: 'T-2 cena',
                retailPriceEur,
                raw: {
                  source: 't2-search-html',
                },
              },
            ]
          : [],
    });
  }

  return items;
}

export async function collectT2CatalogItems(pageSize = 12): Promise<CatalogDiscoveryItem[]> {
  const all = new Map<string, CatalogDiscoveryItem>();
  let pageIndex = 0;
  let totalPages = 1;

  while (pageIndex < totalPages) {
    const payload = await fetchT2SearchPage(pageIndex, pageSize);
    const html = payload.resultsHTML ?? '';
    for (const item of parseT2ResultsHtml(html)) {
      all.set(item.operatorItemKey, item);
    }
    totalPages = Math.max(payload.totalPages ?? 1, 1);
    pageIndex += 1;
  }

  return [...all.values()];
}
