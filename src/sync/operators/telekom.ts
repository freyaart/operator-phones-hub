import type { Page } from 'playwright';
import type { Prisma } from '@prisma/client';
import { acceptTelekomCookies } from '../lib/cookies.js';
import { parseSiEuroString } from '../lib/si-money.js';
import { telekomMobitelSlugs } from '../lib/phone-url.js';
import type { OfferPayload } from '../upsertOffer.js';

type PhoneRow = {
  slug: string;
  brand: string;
  series: string;
  storageGb: number | null;
  details: Prisma.JsonValue;
};

const BASE = 'https://www.telekom.si/e-trgovina/telefonija/mobiteli/p/';

export async function scrapeTelekom(page: Page, phone: PhoneRow): Promise<OfferPayload> {
  const raw: Record<string, unknown> = { operator: 'telekom', slugsTried: telekomMobitelSlugs(phone) };

  for (const slug of telekomMobitelSlugs(phone)) {
    const url = `${BASE}${slug}`;
    raw.lastUrl = url;
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 55000 }).catch((e) => {
      raw.gotoError = String(e);
      return null;
    });
    if (!res || res.status() === 404) {
      raw.lastStatus = res?.status() ?? 'no-response';
      continue;
    }
    await acceptTelekomCookies(page);
    await page.waitForTimeout(6000);
    const body = await page.innerText('body').catch(() => '');
    if (/ni več v prodaji/i.test(body)) {
      raw.discontinued = true;
      continue;
    }

    await page.locator('[data-tab="brez-vezave"]').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const panel = await page.locator('[data-panel="brez-vezave"]').first().innerText().catch(() => '');
    const redna = panel.match(/REDNA\s+CENA\s*([\d.]+,\d{2})\s*€/i);
    const retailPriceEur = redna ? parseSiEuroString(redna[1]) : null;

    await page.locator('[data-tab="vezava"]').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const vez = await page.locator('[data-panel="vezava"]').first().innerText().catch(() => '');
    const inst = vez.match(/(\d+)\s*x\s*([\d.]+,\d{2})\s*€/i);
    const monthlyEur = inst ? parseSiEuroString(inst[2]) : null;
    const months = inst ? parseInt(inst[1], 10) : null;
    const obd = vez.match(/Obdobje\s+vezave\s*(\d+)\s*mesecev/i);
    const m2 = obd ? parseInt(obd[1], 10) : months;
    const contractLabel =
      m2 != null && Number.isFinite(m2) ? `${m2} mesecev (Telekom e-trgovina)` : 'Telekom e-trgovina';

    const tradeInNeg = /staro\s+za\s+novo.*ni\s+(možn|mogoč)/i.test(body);
    const tradeInPos = /staro\s+za\s+novo/i.test(body);
    const tradeInAvailable = tradeInNeg ? false : tradeInPos ? true : null;

    raw.panelBrezVezave = panel.slice(0, 800);
    raw.panelVezava = vez.slice(0, 800);

    return {
      retailPriceEur,
      monthlyEur,
      contractLabel,
      tradeInAvailable,
      productUrl: page.url(),
      raw,
    };
  }

  return {
    retailPriceEur: null,
    monthlyEur: null,
    contractLabel: null,
    tradeInAvailable: null,
    productUrl: null,
    raw: { ...raw, note: 'No Telekom PDP matched slug candidates; set details.shopUrls.telekom' },
  };
}
