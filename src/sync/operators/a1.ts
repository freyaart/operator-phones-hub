import type { Page } from 'playwright';
import { acceptA1Cookies } from '../lib/cookies.js';
import { parseSiEuroString } from '../lib/si-money.js';
import { normalizeAvailability } from '../upsert-catalog-item.js';
import type { OperatorSyncResult, SyncTarget } from './types.js';

function extractMonthlyAndDeposit(body: string) {
  const compact = body.replace(/\u00a0/g, ' ');
  const explicit =
    compact.match(/Možnost\s+nakupa\s+na\s+obroke\s*([\d.]+,\d{2})\s*€\s*\+\s*([\d.]+,\d{2})\s*€\s*predplačila/i) ??
    compact.match(/([\d.]+,\d{2})\s*€\s*\+\s*([\d.]+,\d{2})\s*€\s*predplačila/i);
  if (explicit) {
    return {
      monthlyEur: parseSiEuroString(explicit[1]),
      initialDepositEur: parseSiEuroString(explicit[2]),
    };
  }
  const monthly = compact.match(/Obrok[^€]{0,200}?([\d.]+,\d{2})\s*€\s*\/\s*m/i) ?? compact.match(/([\d.]+,\d{2})\s*€\s*\/\s*m/i);
  const deposit = compact.match(/([\d.]+,\d{2})\s*€\s*predplačila/i);
  return {
    monthlyEur: monthly ? parseSiEuroString(monthly[1]) : null,
    initialDepositEur: deposit ? parseSiEuroString(deposit[1]) : null,
  };
}

export async function scrapeA1(page: Page, target: SyncTarget): Promise<OperatorSyncResult> {
  await page.goto(target.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 55000 });
  await acceptA1Cookies(page);
  await page.waitForTimeout(3500);
  const body = await page.innerText('body').catch(() => '');
  const availability = normalizeAvailability(body);

  const brez = body.match(/Cena\s+brez\s+vezave:?\s*([\d.]+,\d{2})\s*€/i);
  const retailPriceEur = brez ? parseSiEuroString(brez[1]) : null;
  const { monthlyEur, initialDepositEur } = extractMonthlyAndDeposit(body);

  const planLabelMatch =
    body.match(/Paket\s+([A-Za-z0-9 +\-]+?)\s+\d+,\d{2}\s*€\s*\/\s*m/i) ??
    body.match(/Paket\s+([A-Za-z0-9 +\-]+?)\s+\d+,\d{2}\s*€/i);
  const contractMonths = /za\s+2\s+leti|24\s*obrokov|24\s*mesecev/i.test(body) ? 24 : null;
  const tradeInNeg = /staro\s+za\s+novo.*ni\s+(možn|mogoč)/i.test(body);
  const tradeInPos = /staro\s+za\s+novo/i.test(body);
  const tradeInAvailable = tradeInNeg ? false : tradeInPos ? true : null;

  const offers = [
    retailPriceEur != null
      ? {
          phoneModelId: target.phoneModelId,
          operatorCatalogItemId: target.operatorCatalogItemId,
          operator: target.operator,
          offerKey: 'retail',
          offerType: 'RETAIL' as const,
          title: 'Brez vezave',
          retailPriceEur,
          tradeInAvailable,
          availability,
          productUrl: target.sourceUrl,
          raw: { operator: target.operator },
        }
      : null,
    monthlyEur != null || initialDepositEur != null
      ? {
          phoneModelId: target.phoneModelId,
          operatorCatalogItemId: target.operatorCatalogItemId,
          operator: target.operator,
          offerKey: 'contract',
          offerType: 'CONTRACT' as const,
          title: 'Z vezavo',
          monthlyEur,
          initialDepositEur,
          contractMonths,
          planLabel: planLabelMatch ? planLabelMatch[1].trim() : null,
          tradeInAvailable,
          availability,
          productUrl: target.sourceUrl,
          raw: { operator: target.operator },
        }
      : null,
  ].filter((offer): offer is NonNullable<typeof offer> => offer !== null);

  return {
    availability,
    offers,
    artifacts: [
      {
        artifactType: 'pdp-body',
        sourceUrl: target.sourceUrl,
        contentType: 'text/plain',
        contentText: body.slice(0, 4000),
      },
    ],
  };
}
