/**
 * CLI: refresh operator rows for every phone in the catalog.
 *   npm run sync
 *
 * Requires Chromium: `npx playwright install chromium`
 * Skip network scrapes (stub only): `SKIP_SCRAPE=1 npm run sync`
 */
import { chromium } from 'playwright';
import { OPERATORS } from '../types.js';
import { prisma } from '../db.js';
import { upsertOperatorOffer } from '../sync/upsertOffer.js';
import { stubFetchOffer } from '../sync/operators/stub.js';
import { scrapeOperatorOffer, type PhoneSyncRow } from '../sync/operators/index.js';
import type { OperatorId } from '../types.js';

async function runOperatorSync(operator: OperatorId, phone: PhoneSyncRow, page: import('playwright').Page | null) {
  if (process.env.SKIP_SCRAPE === '1' || !page) {
    const payload = await stubFetchOffer(operator, phone);
    await upsertOperatorOffer(phone.id, operator, payload);
    return;
  }
  const payload = await scrapeOperatorOffer(page, operator, phone);
  await upsertOperatorOffer(phone.id, operator, payload);
}

async function main() {
  const phones = await prisma.phoneModel.findMany({
    orderBy: { slug: 'asc' },
  });

  if (phones.length === 0) {
    console.error('No phone models in DB. Run: npm run seed');
    process.exit(1);
  }

  const skip = process.env.SKIP_SCRAPE === '1';
  const browser = skip
    ? null
    : await chromium.launch({
        headless: process.env.HEADFUL !== '1',
        args: ['--disable-blink-features=AutomationControlled'],
      });
  const context =
    browser &&
    (await browser.newContext({
      locale: 'sl-SI',
      timezoneId: 'Europe/Ljubljana',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    }));
  const page = context ? await context.newPage() : null;

  try {
    for (const phone of phones) {
      for (const op of OPERATORS) {
        try {
          await runOperatorSync(op, phone, page);
          process.stdout.write('.');
        } catch (e) {
          console.error(`\n[${op}] ${phone.slug}:`, e);
        }
      }
    }
  } finally {
    await context?.close();
    await browser?.close();
  }

  console.log(`\nSynced ${phones.length} phones × ${OPERATORS.length} operators.${skip ? ' (SKIP_SCRAPE stub)' : ''}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
