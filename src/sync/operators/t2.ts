import type { Page } from 'playwright';
import { parseSiEuroString } from '../lib/si-money.js';
import { normalizeAvailability } from '../upsert-catalog-item.js';
import type { OperatorSyncResult, SyncTarget } from './types.js';

/**
 * T-2 still relies on direct PDP URLs; discovery is not deterministic yet.
 * This adapter records a clear artifact when a PDP is missing or weak.
 */
export async function scrapeT2(page: Page, target: SyncTarget): Promise<OperatorSyncResult> {
  await page.goto(target.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3500);
  const body = await page.innerText('body').catch(() => '');
  const retailMatch = body.match(/([\d.]+,\d{2})\s*€/);
  const retailPriceEur = retailMatch ? parseSiEuroString(retailMatch[1]) : null;
  return {
    availability: normalizeAvailability(body),
    offers:
      retailPriceEur != null
        ? [
            {
              phoneModelId: target.phoneModelId,
              operatorCatalogItemId: target.operatorCatalogItemId,
              operator: target.operator,
              offerKey: 'retail',
              offerType: 'RETAIL',
              title: 'T-2 cena',
              retailPriceEur,
              availability: normalizeAvailability(body),
              productUrl: target.sourceUrl,
              raw: { operator: target.operator, manualOrDirect: true },
            },
          ]
        : [],
    artifacts: [
      {
        artifactType: 'pdp-body',
        sourceUrl: target.sourceUrl,
        contentType: 'text/plain',
        contentText: body.slice(0, 2500),
      },
    ],
    note: retailPriceEur == null ? 'T-2 PDP parsed without a structured retail price.' : undefined,
  };
}
