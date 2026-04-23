/**
 * CLI: refresh normalized operator offers for every discovered catalog item.
 *   npm run sync
 *
 * Requires Chromium: `npx playwright install chromium`
 * Skip network scrapes (stub only): `SKIP_SCRAPE=1 npm run sync`
 */
import type { Prisma } from '@prisma/client';
import { chromium } from 'playwright';
import { OPERATORS } from '../types.js';
import { prisma } from '../db.js';
import { upsertOperatorOffer } from '../sync/upsertOffer.js';
import { stubFetchOffer } from '../sync/operators/stub.js';
import { scrapeOperatorOffer, type SyncTarget } from '../sync/operators/index.js';
import type { OperatorId } from '../types.js';
import { beginScrapeRun, finishScrapeRun, addScrapeArtifact } from '../scrape/run-log.js';
import { manualShopUrls } from '../sync/lib/phone-url.js';
import { operatorItemKeyFromUrl, upsertOperatorCatalogItem } from '../sync/upsert-catalog-item.js';
import {
  fetchRebornWaveProducts,
  hasRebornWaveApiConfigured,
  type RebornWaveGroup,
} from '../lib/reborn-wave.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeRebornWaveDetails(
  current: unknown,
  input: {
    modelQuery: string;
    groups: RebornWaveGroup[];
  },
) {
  const base = asRecord(current);
  const parentProductIds = input.groups.map((group) => group.parent.id);
  const childProductIds = input.groups.flatMap((group) => group.children.map((child) => child.id));
  return {
    ...base,
    rebornProducts: {
      modelQuery: input.modelQuery,
      parentProductIds: [...new Set(parentProductIds)],
      childProductIds: [...new Set(childProductIds)],
      groups: input.groups,
      syncedAt: new Date().toISOString(),
    },
  } as Prisma.InputJsonValue;
}

async function syncOffersForCatalogItem(target: SyncTarget, offers: Parameters<typeof upsertOperatorOffer>[0][]) {
  const offerKeys = offers.map((offer) => offer.offerKey);
  await prisma.operatorOffer.deleteMany({
    where: {
      operatorCatalogItemId: target.operatorCatalogItemId,
      ...(offerKeys.length > 0 ? { offerKey: { notIn: offerKeys } } : {}),
    },
  });
  for (const offer of offers) {
    await upsertOperatorOffer(offer);
  }
}

async function runOperatorSync(
  operator: OperatorId,
  target: SyncTarget,
  page: import('playwright').Page | null,
  scrapeRunId: string | null,
) {
  if (process.env.SKIP_SCRAPE === '1' || !page) {
    const payload = await stubFetchOffer(operator, {
      brand: target.phoneModel.brand,
      series: target.phoneModel.series,
      storageGb: target.storageGb,
      slug: target.phoneModel.slug,
    });
    await syncOffersForCatalogItem(target, [
      {
        phoneModelId: target.phoneModelId,
        operatorCatalogItemId: target.operatorCatalogItemId,
        operator,
        offerKey: 'stub',
        offerType: 'OTHER',
        title: 'Stub',
        retailPriceEur: payload.retailPriceEur,
        monthlyEur: payload.monthlyEur,
        productUrl: payload.productUrl ?? target.sourceUrl,
        raw: payload.raw as never,
      },
    ]);
    return;
  }
  const result = await scrapeOperatorOffer(page, operator, target);
  await prisma.operatorCatalogItem.update({
    where: { id: target.operatorCatalogItemId },
    data: {
      availability: result.availability ?? undefined,
      lastSeenAt: new Date(),
    },
  });
  await syncOffersForCatalogItem(target, result.offers);
  for (const artifact of result.artifacts ?? []) {
    await addScrapeArtifact({
      scrapeRunId,
      operator,
      phoneModelId: target.phoneModelId,
      operatorCatalogItemId: target.operatorCatalogItemId,
      artifactType: artifact.artifactType,
      sourceUrl: artifact.sourceUrl ?? target.sourceUrl,
      contentType: artifact.contentType,
      contentText: artifact.contentText ?? null,
      metadata: artifact.metadata,
    });
  }
}

async function ensureManualCatalogItems() {
  const phones = await prisma.phoneModel.findMany({
    include: { catalogItems: true },
    orderBy: { slug: 'asc' },
  });
  for (const phone of phones) {
    const urls = manualShopUrls({
      slug: phone.slug,
      brand: phone.brand,
      series: phone.series,
      storageGb: phone.storageGb,
      details: phone.details,
    });
    for (const [operator, url] of Object.entries(urls)) {
      if (!OPERATORS.includes(operator as OperatorId)) continue;
      await upsertOperatorCatalogItem({
        operator,
        operatorItemKey: operatorItemKeyFromUrl(url),
        phoneModelId: phone.id,
        sourceUrl: url,
        displayName: phone.marketingName || phone.series,
        storageGb: phone.storageGb,
      });
    }
  }
}

async function syncRebornWaveData() {
  if (!hasRebornWaveApiConfigured()) {
    console.log('Reborn Wave API not configured; skipping Reborn product sync.');
    return;
  }

  const run = await beginScrapeRun({
    operator: 'reborn-wave',
    runType: 'SYNC',
    version: 'v1',
  });

  let processedCount = 0;
  let successCount = 0;
  let failureCount = 0;

  try {
    const phones = await prisma.phoneModel.findMany({
      orderBy: [{ brand: 'asc' }, { series: 'asc' }],
    });

    for (const phone of phones) {
      processedCount += 1;
      try {
        const lookup = await fetchRebornWaveProducts({
          slug: phone.slug,
          brand: phone.brand,
          series: phone.series,
          marketingName: phone.marketingName,
        });

        if (!lookup) {
          await addScrapeArtifact({
            scrapeRunId: run.id,
            operator: 'reborn-wave',
            phoneModelId: phone.id,
            artifactType: 'reborn-wave-no-match',
            contentType: 'text/plain',
            contentText: `${phone.brand} ${phone.marketingName ?? phone.series}`,
            metadata: { slug: phone.slug },
          });
          continue;
        }

        await prisma.phoneModel.update({
          where: { id: phone.id },
          data: {
            details: mergeRebornWaveDetails(phone.details, {
              modelQuery: lookup.modelQuery,
              groups: lookup.groups,
            }),
          },
        });

        await addScrapeArtifact({
          scrapeRunId: run.id,
          operator: 'reborn-wave',
          phoneModelId: phone.id,
          artifactType: 'reborn-wave-match',
          contentType: 'application/json',
          contentText: JSON.stringify(lookup, null, 2),
          metadata: { slug: phone.slug },
        });
        successCount += 1;
      } catch (error) {
        failureCount += 1;
        await addScrapeArtifact({
          scrapeRunId: run.id,
          operator: 'reborn-wave',
          phoneModelId: phone.id,
          artifactType: 'reborn-wave-error',
          contentType: 'text/plain',
          contentText: String(error),
          metadata: { slug: phone.slug },
        });
      }
    }
  } finally {
    await finishScrapeRun(run.id, {
      status: failureCount > 0 ? (successCount > 0 ? 'PARTIAL' : 'FAILURE') : 'SUCCESS',
      processedCount,
      successCount,
      failureCount,
    });
  }
}

async function main() {
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
    await ensureManualCatalogItems();
    await syncRebornWaveData();
    const items = await prisma.operatorCatalogItem.findMany({
      include: {
        phoneModel: true,
      },
      orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
    });
    if (items.length === 0) {
      console.error('No operator catalog items found. Run: npm run discover');
      process.exit(1);
    }

    for (const op of OPERATORS) {
      const run = skip
        ? null
        : await beginScrapeRun({
            operator: op,
            runType: 'SYNC',
            version: 'v2',
          });
      let processedCount = 0;
      let successCount = 0;
      let failureCount = 0;
      for (const item of items.filter((candidate) => candidate.operator === op)) {
        try {
          processedCount++;
          const target: SyncTarget = {
            phoneModelId: item.phoneModelId,
            operatorCatalogItemId: item.id,
            operator: item.operator,
            operatorItemKey: item.operatorItemKey,
            sourceUrl: item.sourceUrl,
            displayName: item.displayName,
            variantLabel: item.variantLabel,
            color: item.color,
            storageGb: item.storageGb,
            phoneModel: {
              slug: item.phoneModel.slug,
              brand: item.phoneModel.brand,
              series: item.phoneModel.series,
              marketingName: item.phoneModel.marketingName,
              details: item.phoneModel.details,
            },
          };
          await runOperatorSync(op, target, page, run?.id ?? null);
          successCount++;
          process.stdout.write('.');
        } catch (e) {
          failureCount++;
          console.error(`\n[${op}] ${item.phoneModel.slug}:`, e);
          if (run) {
            await addScrapeArtifact({
              scrapeRunId: run.id,
              operator: op,
              phoneModelId: item.phoneModelId,
              operatorCatalogItemId: item.id,
              artifactType: 'sync-error',
              sourceUrl: item.sourceUrl,
              contentType: 'text/plain',
              contentText: String(e),
            });
          }
        }
      }
      if (run) {
        await finishScrapeRun(run.id, {
          status: failureCount > 0 ? 'PARTIAL' : 'SUCCESS',
          processedCount,
          successCount,
          failureCount,
        });
      }
    }
  } finally {
    await context?.close();
    await browser?.close();
  }

  const finalCount = await prisma.operatorCatalogItem.count();
  console.log(`\nSynced ${finalCount} catalog items.${skip ? ' (SKIP_SCRAPE stub)' : ''}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
