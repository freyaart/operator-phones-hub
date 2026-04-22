import type { Page } from 'playwright';
import type { Prisma } from '@prisma/client';
import { manualShopUrl } from '../lib/phone-url.js';
import { parseSiEuroString } from '../lib/si-money.js';
import type { OfferPayload } from '../upsertOffer.js';

type PhoneRow = {
  slug: string;
  brand: string;
  series: string;
  storageGb: number | null;
  details: Prisma.JsonValue;
};

/**
 * T-2 shop HTML varies; listing search did not expose stable product URLs in probes.
 * Provide `details.shopUrls.t2` for a direct PDP, or extend this module with a known pattern.
 */
export async function scrapeT2(page: Page, phone: PhoneRow): Promise<OfferPayload> {
  const manual = manualShopUrl(phone, 't2');
  if (!manual) {
    return {
      retailPriceEur: null,
      monthlyEur: null,
      contractLabel: null,
      tradeInAvailable: null,
      productUrl: null,
      raw: {
        operator: 't2',
        note: 'Set details.shopUrls.t2 to a product PDP URL, or implement discovery for www.t-2.net',
      },
    };
  }
  await page.goto(manual, { waitUntil: 'domcontentloaded', timeout: 55000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const body = await page.innerText('body').catch(() => '');
  const m = body.match(/([\d.]+,\d{2})\s*€/);
  const retailPriceEur = m ? parseSiEuroString(m[1]) : null;
  return {
    retailPriceEur,
    monthlyEur: null,
    contractLabel: 'T-2',
    tradeInAvailable: null,
    productUrl: page.url(),
    raw: { operator: 't2', manual: true, excerpt: body.slice(0, 400) },
  };
}
