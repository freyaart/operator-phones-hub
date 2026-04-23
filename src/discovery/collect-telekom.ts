import type { Page } from 'playwright';
import { parseCatalogSlug } from './parse-catalog-slug.js';
import type { CatalogDiscoveryItem } from './types.js';
import { normalizeAvailability, operatorItemKeyFromUrl } from '../sync/upsert-catalog-item.js';

const HASH =
  'https://www.telekom.si/e-trgovina/telefonija/mobiteli#q=:datum-padajoce:tip-cene:najnizja:zaloga:vse:napovedujemo:ne:v-prodaji:da&stran=';

/** Collect unique Telekom PDPs using deterministic hash pagination. */
export async function collectTelekomCatalogItems(page: Page, maxPages = 60): Promise<CatalogDiscoveryItem[]> {
  const all = new Map<string, CatalogDiscoveryItem>();
  let stagnant = 0;
  for (let stran = 1; stran <= maxPages; stran++) {
    await page.goto(HASH + stran, { waitUntil: 'domcontentloaded', timeout: 65000 });
    await page.waitForTimeout(5500);
    const rows = await page.locator('a[href]').evaluateAll((els) => {
      const out: Array<{ href: string; text: string; cardText: string }> = [];
      for (const e of els) {
        const h = e.getAttribute('href');
        if (h && /\/mobiteli\/p\//.test(h)) {
          const card = e.closest('article, .product, .product-preview, .product-list-item, li, div');
          out.push({
            href: h.split('#')[0],
            text: (e.textContent || '').replace(/\s+/g, ' ').trim(),
            cardText: (card?.textContent || '').replace(/\s+/g, ' ').trim(),
          });
        }
      }
      return out;
    });
    const before = all.size;
    for (const row of rows) {
      const href = row.href.startsWith('http') ? row.href : `https://www.telekom.si${row.href}`;
      const itemKey = operatorItemKeyFromUrl(href);
      const pathSegment = itemKey.split('/').pop();
      if (!pathSegment) continue;
      const parsed = parseCatalogSlug(pathSegment);
      if (!parsed.isPhone) continue;
      all.set(itemKey, {
        operator: 'telekom',
        operatorItemKey: itemKey,
        sourceUrl: href,
        displayName: row.text || parsed.series,
        variantLabel: row.cardText || null,
        color: parsed.color,
        storageGb: parsed.storageGb,
        availability: normalizeAvailability(row.cardText),
        canonicalSlug: parsed.canonicalSlug,
        brand: parsed.brand,
        series: parsed.series,
        isPhone: parsed.isPhone,
      });
    }
    const added = all.size - before;
    if (added === 0) {
      stagnant++;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
  }
  return [...all.values()];
}
