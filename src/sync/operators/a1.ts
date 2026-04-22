import type { Page } from 'playwright';
import type { Prisma } from '@prisma/client';
import { acceptA1Cookies } from '../lib/cookies.js';
import { parseSiEuroString } from '../lib/si-money.js';
import { manualShopUrl, searchPhrase } from '../lib/phone-url.js';
import type { OfferPayload } from '../upsertOffer.js';

type PhoneRow = {
  slug: string;
  brand: string;
  series: string;
  storageGb: number | null;
  details: Prisma.JsonValue;
};

const BAD = /ovitek|ovitki|etui|bundle|mapa|zaščit|charger|polnilec|kabli|slušalk|zvočnik/i;

function scoreHref(href: string, seriesLc: string, storageGb: number | null): number {
  const h = href.toLowerCase();
  if (!h.includes('/telefoni/')) return -1;
  if (BAD.test(h)) return -1;
  let s = 0;
  for (const token of seriesLc.split(/[^a-z0-9]+/i)) {
    if (token.length < 2) continue;
    if (h.includes(token)) s += 2;
  }
  if (h.includes('iphone') && seriesLc.includes('iphone')) s += 1;
  if (storageGb != null && h.includes(String(storageGb))) s += 3;
  return s;
}

export async function scrapeA1(page: Page, phone: PhoneRow): Promise<OfferPayload> {
  const raw: Record<string, unknown> = { operator: 'a1' };
  const manual = manualShopUrl(phone, 'a1');
  if (manual) {
    raw.manualUrl = manual;
    await page.goto(manual, { waitUntil: 'domcontentloaded', timeout: 55000 }).catch((e) => {
      raw.gotoError = String(e);
    });
  } else {
    await page.goto('https://www.a1.si/telefoni/', { waitUntil: 'domcontentloaded', timeout: 55000 });
    await acceptA1Cookies(page);
    await page.waitForTimeout(1500);
    const q = searchPhrase(phone);
    raw.searchQuery = q;
    await page.fill('#search-input', q);
    await page.keyboard.press('Enter');
    await page.waitForURL(/rezultati-iskanja/, { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await acceptA1Cookies(page);

    const seriesLc = `${phone.brand} ${phone.series}`.toLowerCase();
    const hrefs = await page.locator('a[href^="/telefoni/"]').evaluateAll((els) =>
      [...new Set(els.map((e) => e.getAttribute('href')).filter(Boolean))] as string[]
    );
    const ranked = hrefs
      .map((h) => ({ h, score: scoreHref(h, seriesLc, phone.storageGb) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    raw.rankedTop = ranked.slice(0, 5);
    const best = ranked[0]?.h;
    if (!best) {
      return {
        retailPriceEur: null,
        monthlyEur: null,
        contractLabel: null,
        tradeInAvailable: null,
        productUrl: null,
        raw: { ...raw, note: 'No /telefoni/ search hit; set details.shopUrls.a1' },
      };
    }
    const abs = best.startsWith('http') ? best : `https://www.a1.si${best}`;
    await page.goto(abs, { waitUntil: 'domcontentloaded', timeout: 55000 });
  }

  await acceptA1Cookies(page);
  await page.waitForTimeout(3500);
  const body = await page.innerText('body').catch(() => '');

  const brez = body.match(/Cena\s+brez\s+vezave:?\s*([\d.]+,\d{2})\s*€/i);
  const retailPriceEur = brez ? parseSiEuroString(brez[1]) : null;

  const obrok = body.match(/Obrok[^€]{0,160}?(\d+[\.,]\d{2})\s*€\s*\/\s*m/i);
  let monthlyEur = obrok ? parseSiEuroString(obrok[1].replace(/\./g, '')) : null;
  if (monthlyEur == null || monthlyEur > 400) {
    const m = body.match(/(\d+[\.,]\d{2})\s*€\s*\/\s*m/);
    const v = m ? parseSiEuroString(m[1].replace(/\./g, '')) : null;
    if (v != null && v < 400) monthlyEur = v;
  }

  const tradeInNeg = /staro\s+za\s+novo.*ni\s+(možn|mogoč)/i.test(body);
  const tradeInPos = /staro\s+za\s+novo/i.test(body);
  const tradeInAvailable = tradeInNeg ? false : tradeInPos ? true : null;

  const contractLabel =
    /za\s+2\s+leti/i.test(body) ? '24 mesecev (A1)' : /24\s*obrokov|24\s*mesecev/i.test(body) ? '24 mesecev (A1)' : 'A1';

  return {
    retailPriceEur,
    monthlyEur: monthlyEur && monthlyEur < 500 ? monthlyEur : monthlyEur,
    contractLabel,
    tradeInAvailable,
    productUrl: page.url(),
    raw,
  };
}
