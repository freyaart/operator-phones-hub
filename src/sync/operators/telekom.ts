import type { Page } from 'playwright';
import { acceptTelekomCookies } from '../lib/cookies.js';
import { parseSiEuroString } from '../lib/si-money.js';
import { normalizeAvailability } from '../upsert-catalog-item.js';
import type { OperatorSyncResult, SyncTarget } from './types.js';

function parseRetailPanel(panel: string, target: SyncTarget) {
  const redna = panel.match(/REDNA\s+CENA\s*([\d.]+,\d{2})\s*€/i);
  return redna
    ? {
        phoneModelId: target.phoneModelId,
        operatorCatalogItemId: target.operatorCatalogItemId,
        operator: target.operator,
        offerKey: 'retail',
        offerType: 'RETAIL' as const,
        title: 'Brez vezave',
        retailPriceEur: parseSiEuroString(redna[1]),
        productUrl: target.sourceUrl,
      }
    : null;
}

function parseContractPanel(panel: string, target: SyncTarget, offerKey: string, title: string) {
  const inst = panel.match(/(\d+)\s*x\s*([\d.]+,\d{2})\s*€/i);
  const monthlyEur = inst ? parseSiEuroString(inst[2]) : null;
  const upfront =
    panel.match(/Plačilo\s+vnaprej\s*([\d.]+,\d{2})\s*€/i) ||
    panel.match(/Prvi\s+del\s+kupnine\s*([\d.]+,\d{2})\s*€/i);
  const months = panel.match(/Obdobje\s+vezave\s*(\d+)\s*mesecev/i);
  const planLabelMatch = panel.match(/Naročnina\s*([^\n]+?)\s*(?:Obdobje vezave|Način plačila|Naročniško razmerje)/i);
  if (!monthlyEur && !upfront) return null;
  return {
    phoneModelId: target.phoneModelId,
    operatorCatalogItemId: target.operatorCatalogItemId,
    operator: target.operator,
    offerKey,
    offerType: offerKey === 'loyalty' ? ('LOYALTY' as const) : ('CONTRACT' as const),
    title,
    monthlyEur,
    initialDepositEur: upfront ? parseSiEuroString(upfront[1]) : null,
    contractMonths: months ? parseInt(months[1], 10) : null,
    planLabel: planLabelMatch ? planLabelMatch[1].trim() : null,
    productUrl: target.sourceUrl,
  };
}

async function readPanelText(page: Page, tabSelector: string, panelSelector: string): Promise<string> {
  const tab = page.locator(tabSelector).first();
  if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
    await tab.click({ timeout: 5000 }).catch(() => {});
  }

  const panel = page.locator(panelSelector).first();
  await panel.waitFor({ state: 'visible', timeout: 7000 }).catch(() => {});
  return panel.innerText().catch(() => '');
}

export async function scrapeTelekom(page: Page, target: SyncTarget): Promise<OperatorSyncResult> {
  await page.goto(target.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 55000 });
  await acceptTelekomCookies(page);
  await page.locator('body').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  await page
    .locator('[data-tab="brez-vezave"], [data-panel="brez-vezave"]')
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
    .catch(() => {});
  const body = await page.innerText('body').catch(() => '');
  const availability = normalizeAvailability(body);
  const tradeInNeg = /staro\s+za\s+novo.*ni\s+(možn|mogoč)/i.test(body);
  const tradeInPos = /staro\s+za\s+novo/i.test(body);
  const tradeInAvailable = tradeInNeg ? false : tradeInPos ? true : null;

  const retailPanel = await readPanelText(page, '[data-tab="brez-vezave"]', '[data-panel="brez-vezave"]');
  const contractPanel = await readPanelText(page, '[data-tab="vezava"]', '[data-panel="vezava"]');
  const loyaltyPanel = await readPanelText(
    page,
    '[data-tab="program-zvestobe"]',
    '[data-panel="program-zvestobe"]',
  );

  const offers = [
    parseRetailPanel(retailPanel, target),
    parseContractPanel(contractPanel, target, 'contract', 'Z vezavo'),
    parseContractPanel(loyaltyPanel, target, 'loyalty', 'Program zvestobe'),
  ]
    .filter((offer): offer is NonNullable<typeof offer> => offer !== null)
    .map((offer) => ({
      ...offer,
      tradeInAvailable,
      availability,
      raw: {
        operator: target.operator,
        bodyExcerpt: body.slice(0, 600),
      },
    }));

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
      {
        artifactType: 'telekom-panel-brez-vezave',
        sourceUrl: target.sourceUrl,
        contentType: 'text/plain',
        contentText: retailPanel,
      },
      {
        artifactType: 'telekom-panel-vezava',
        sourceUrl: target.sourceUrl,
        contentType: 'text/plain',
        contentText: contractPanel,
      },
      {
        artifactType: 'telekom-panel-program-zvestobe',
        sourceUrl: target.sourceUrl,
        contentType: 'text/plain',
        contentText: loyaltyPanel,
      },
    ],
  };
}
