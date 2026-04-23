import type { Page } from 'playwright';
import { parseCatalogSlug } from './parse-catalog-slug.js';
import type { CatalogDiscoveryItem } from './types.js';
import { acceptA1Cookies } from '../sync/lib/cookies.js';
import { normalizeAvailability, operatorItemKeyFromUrl } from '../sync/upsert-catalog-item.js';

const BAD = /apple-care|zavarovanje|servis|pogoji|pomoč|kontakt|cookie/i;
const BASE = 'https://www.a1.si';

/** Collect A1 handset listing items using deterministic `lb.page` pagination. */
export async function collectA1CatalogItems(page: Page, maxPages = 50): Promise<CatalogDiscoveryItem[]> {
  const all = new Map<string, CatalogDiscoveryItem>();
  let stagnant = 0;
  for (let lbPage = 1; lbPage <= maxPages; lbPage++) {
    await page.goto(`https://www.a1.si/telefoni?lb.page=${lbPage}`, {
      waitUntil: 'domcontentloaded',
      timeout: 65000,
    });
    await page.waitForTimeout(4500);
    await acceptA1Cookies(page);
    await page.waitForTimeout(1200);
    const rows = await page.locator('a[href^="/telefoni/"]').evaluateAll((els) =>
      els.map((e) => {
        const href = e.getAttribute('href');
        const text = (e.textContent || '').replace(/\s+/g, ' ').trim();
        const card = e.closest('article, .product, .product-container, .product-preview, li, div');
        const cardText = (card?.textContent || '').replace(/\s+/g, ' ').trim();
        return { href, text, cardText };
      }),
    );

    const before = all.size;
    for (const row of rows) {
      const href = row.href?.split('#')[0];
      if (!href || !href.startsWith('/telefoni/') || BAD.test(href)) continue;
      const parsed = parseCatalogSlug(href.replace(/^\/telefoni\//, ''));
      if (!parsed.isPhone) continue;
      const displayName = row.text || row.cardText || parsed.series;
      const item: CatalogDiscoveryItem = {
        operator: 'a1',
        operatorItemKey: operatorItemKeyFromUrl(href),
        sourceUrl: `${BASE}${href}`,
        displayName,
        variantLabel: row.cardText || null,
        color: parsed.color,
        storageGb: parsed.storageGb,
        availability: normalizeAvailability(row.cardText),
        canonicalSlug: parsed.canonicalSlug,
        brand: parsed.brand,
        series: parsed.series,
        isPhone: parsed.isPhone,
      };
      all.set(item.operatorItemKey, item);
    }
    if (all.size === before) {
      stagnant++;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
  }
  return [...all.values()];
}
