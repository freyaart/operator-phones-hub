import type { Page } from 'playwright';
import { parseSiEuroString } from '../lib/si-money.js';
import { normalizeAvailability } from '../upsert-catalog-item.js';
import type { OperatorSyncResult, SyncTarget } from './types.js';

export async function scrapeTelemach(page: Page, target: SyncTarget): Promise<OperatorSyncResult> {
  const res = await page.goto(target.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => null);
  await page.waitForTimeout(2500);
  const title = await page.title().catch(() => '');
  const html = await page.content().catch(() => '');
  if (/access blocked/i.test(title) || /access blocked/i.test(html)) {
    return {
      availability: 'BLOCKED',
      offers: [],
      artifacts: [
        {
          artifactType: 'blocked-html',
          sourceUrl: target.sourceUrl,
          contentType: 'text/html',
          contentText: html.slice(0, 4000),
          metadata: { status: res?.status?.(), title },
        },
      ],
      note: 'Telemach WAF blocked automated access from this environment.',
    };
  }

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
              title: 'Telemach cena',
              retailPriceEur,
              availability: normalizeAvailability(body),
              productUrl: target.sourceUrl,
              raw: { operator: target.operator },
            },
          ]
        : [],
    artifacts: [
      {
        artifactType: 'pdp-body',
        sourceUrl: target.sourceUrl,
        contentType: 'text/plain',
        contentText: body.slice(0, 2500),
        metadata: { status: res?.status?.(), title },
      },
    ],
  };
}
