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

export async function scrapeTelemach(page: Page, phone: PhoneRow): Promise<OfferPayload> {
  const manual = manualShopUrl(phone, 'telemach');
  const raw: Record<string, unknown> = { operator: 'telemach' };

  const target = manual ?? 'https://telemach.si/nakup/mobilni-telefoni';
  const res = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch((e) => {
    raw.gotoError = String(e);
    return null;
  });
  await page.waitForTimeout(3000);
  const title = await page.title().catch(() => '');
  const html = await page.content().catch(() => '');
  if (/access blocked/i.test(title) || /access blocked/i.test(html)) {
    return {
      retailPriceEur: null,
      monthlyEur: null,
      contractLabel: null,
      tradeInAvailable: null,
      productUrl: null,
      raw: {
        ...raw,
        note: 'Telemach WAF blocked automated access from this environment. Use details.shopUrls.telemach or run sync from a residential IP / browser session.',
        title,
      },
    };
  }

  if (manual) {
    const body = await page.innerText('body').catch(() => '');
    const m = body.match(/([\d.]+,\d{2})\s*€/);
    const retailPriceEur = m ? parseSiEuroString(m[1]) : null;
    return {
      retailPriceEur,
      monthlyEur: null,
      contractLabel: 'Telemach',
      tradeInAvailable: null,
      productUrl: page.url(),
      raw: { ...raw, status: res?.status() },
    };
  }

  return {
    retailPriceEur: null,
    monthlyEur: null,
    contractLabel: null,
    tradeInAvailable: null,
    productUrl: null,
    raw: { ...raw, note: 'Set details.shopUrls.telemach for PDP scraping', title },
  };
}
