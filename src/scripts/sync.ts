/**
 * CLI: refresh normalized operator offers for every discovered catalog item.
 *   npm run sync
 *
 * Requires Chromium: `npx playwright install chromium`
 * Skip network scrapes (stub only): `SKIP_SCRAPE=1 npm run sync`
 */
import type { Prisma } from '@prisma/client';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { collectT2CatalogItems } from '../discovery/collect-t2.js';
import { collectTelemachCatalogItems } from '../discovery/collect-telemach.js';
import type { CatalogDiscoveryItem, CatalogDiscoveryOffer } from '../discovery/types.js';
import { OPERATORS } from '../types.js';
import { prisma } from '../db.js';
import { upsertOperatorOffer, type OfferPayload } from '../sync/upsertOffer.js';
import { stubFetchOffer } from '../sync/operators/stub.js';
import { scrapeOperatorOffer, type SyncTarget } from '../sync/operators/index.js';
import type { OperatorId } from '../types.js';
import { beginScrapeRun, finishScrapeRun, addScrapeArtifact } from '../scrape/run-log.js';
import { manualShopUrls } from '../sync/lib/phone-url.js';
import { operatorItemKeyFromUrl, upsertOperatorCatalogItem } from '../sync/upsert-catalog-item.js';
import type { ArtifactPayload, OperatorSyncResult } from '../sync/operators/types.js';

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

type ListingPhaseData = Record<OperatorId, Map<string, CatalogDiscoveryItem>>;

type SyncPhaseResult = {
  target: SyncTarget;
  listingItem?: CatalogDiscoveryItem;
  result: OperatorSyncResult;
};

type FailedTarget = {
  target: SyncTarget;
  error: unknown;
};

type PersistFailure = {
  result: SyncPhaseResult;
  error: unknown;
};

function createEmptyListingPhaseData(): ListingPhaseData {
  return {
    a1: new Map(),
    telekom: new Map(),
    t2: new Map(),
    telemach: new Map(),
  };
}

function buildTarget(item: {
  phoneModelId: string;
  id: string;
  operator: string;
  operatorItemKey: string;
  sourceUrl: string;
  displayName: string;
  variantLabel: string | null;
  color: string | null;
  storageGb: number | null;
  phoneModel: {
    slug: string;
    brand: string;
    series: string;
    marketingName: string | null;
    details: Prisma.JsonValue;
  };
}): SyncTarget {
  return {
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
}

function buildOfferFromListing(
  target: SyncTarget,
  offer: CatalogDiscoveryOffer,
  availability: OperatorSyncResult['availability'],
  productUrl: string,
): OfferPayload {
  return {
    phoneModelId: target.phoneModelId,
    operatorCatalogItemId: target.operatorCatalogItemId,
    operator: target.operator,
    offerKey: offer.offerKey,
    offerType: offer.offerType,
    title: offer.title,
    retailPriceEur: offer.retailPriceEur ?? null,
    monthlyEur: offer.monthlyEur ?? null,
    initialDepositEur: offer.initialDepositEur ?? null,
    contractMonths: offer.contractMonths ?? null,
    planLabel: offer.planLabel ?? null,
    availability,
    productUrl,
    raw: offer.raw,
  };
}

function buildListingResult(target: SyncTarget, listingItem: CatalogDiscoveryItem): OperatorSyncResult | null {
  const offers = (listingItem.listingOffers ?? []).map((offer) =>
    buildOfferFromListing(target, offer, listingItem.availability, listingItem.sourceUrl),
  );
  if (offers.length === 0) return null;

  const artifacts: ArtifactPayload[] = [
    {
      artifactType: 'listing-offer',
      sourceUrl: listingItem.sourceUrl,
      contentType: 'application/json',
      contentText: JSON.stringify(
        {
          operatorItemKey: listingItem.operatorItemKey,
          offers: listingItem.listingOffers ?? [],
        },
        null,
        2,
      ),
      metadata: {
        canonicalSlug: listingItem.canonicalSlug,
        displayName: listingItem.displayName,
      },
    },
  ];
  if (listingItem.variantLabel) {
    artifacts.push({
      artifactType: 'listing-card',
      sourceUrl: listingItem.sourceUrl,
      contentType: 'text/plain',
      contentText: listingItem.variantLabel,
    });
  }

  return {
    availability: listingItem.availability,
    offers,
    artifacts,
  };
}

function shouldUseListingOnly(operator: OperatorId, listingItem: CatalogDiscoveryItem | undefined): boolean {
  if (!listingItem || (listingItem.listingOffers?.length ?? 0) === 0) return false;
  return operator === 'telemach' || operator === 't2';
}

async function collectListingPhaseData(skip: boolean): Promise<ListingPhaseData> {
  const data = createEmptyListingPhaseData();
  if (skip) return data;

  const [t2Items, telemachItems] = await Promise.all([collectT2CatalogItems(), collectTelemachCatalogItems()]);
  data.t2 = new Map(t2Items.map((item) => [item.operatorItemKey, item]));
  data.telemach = new Map(telemachItems.map((item) => [item.operatorItemKey, item]));

  console.log(`Listing phase: T-2=${t2Items.length}, Telemach=${telemachItems.length}`);
  return data;
}

async function scrapeTarget(
  operator: OperatorId,
  target: SyncTarget,
  page: Page | null,
): Promise<OperatorSyncResult> {
  if (process.env.SKIP_SCRAPE === '1' || !page) {
    const payload = await stubFetchOffer(operator, {
      brand: target.phoneModel.brand,
      series: target.phoneModel.series,
      storageGb: target.storageGb,
      slug: target.phoneModel.slug,
    });
    return {
      offers: [
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
      ],
    };
  }
  return scrapeOperatorOffer(page, operator, target);
}

async function scrapeTargetsWithConcurrency(
  context: BrowserContext | null,
  operator: OperatorId,
  targets: Array<{ target: SyncTarget; listingItem?: CatalogDiscoveryItem }>,
  concurrency: number,
): Promise<{ results: SyncPhaseResult[]; failures: FailedTarget[] }> {
  const results: SyncPhaseResult[] = [];
  const failures: FailedTarget[] = [];
  let nextIndex = 0;
  const workerCount =
    process.env.SKIP_SCRAPE === '1' || !context ? 1 : Math.max(1, Math.min(concurrency, targets.length));
  const pages =
    process.env.SKIP_SCRAPE === '1' || !context
      ? [null]
      : await Promise.all(Array.from({ length: workerCount }, () => context.newPage()));

  try {
    await Promise.all(
      pages.map(async (page) => {
        while (true) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          if (currentIndex >= targets.length) break;

          const current = targets[currentIndex];
          try {
            const result = await scrapeTarget(operator, current.target, page);
            results.push({
              target: current.target,
              listingItem: current.listingItem,
              result,
            });
            process.stdout.write('.');
          } catch (error) {
            failures.push({ target: current.target, error });
            process.stdout.write('!');
          }
        }
      }),
    );
  } finally {
    await Promise.all(pages.map((page) => page?.close()));
  }

  return { results, failures };
}

async function persistSyncPhaseResult(result: SyncPhaseResult, scrapeRunId: string | null) {
  const availability = result.result.availability ?? result.listingItem?.availability ?? undefined;
  await prisma.operatorCatalogItem.update({
    where: { id: result.target.operatorCatalogItemId },
    data: {
      sourceUrl: result.listingItem?.sourceUrl ?? result.target.sourceUrl,
      displayName: result.listingItem?.displayName ?? result.target.displayName,
      variantLabel: result.listingItem?.variantLabel ?? result.target.variantLabel,
      color: result.listingItem?.color ?? result.target.color,
      storageGb: result.listingItem?.storageGb ?? result.target.storageGb,
      availability,
      lastSeenAt: new Date(),
    },
  });
  await syncOffersForCatalogItem(result.target, result.result.offers);
  for (const artifact of result.result.artifacts ?? []) {
    await addScrapeArtifact({
      scrapeRunId,
      operator: result.target.operator,
      phoneModelId: result.target.phoneModelId,
      operatorCatalogItemId: result.target.operatorCatalogItemId,
      artifactType: artifact.artifactType,
      sourceUrl: artifact.sourceUrl ?? result.target.sourceUrl,
      contentType: artifact.contentType,
      contentText: artifact.contentText ?? null,
      metadata: artifact.metadata,
    });
  }
}

async function persistSyncPhaseResults(
  results: SyncPhaseResult[],
  scrapeRunId: string | null,
  concurrency: number,
): Promise<{ successCount: number; failures: PersistFailure[] }> {
  let nextIndex = 0;
  let successCount = 0;
  const failures: PersistFailure[] = [];
  const workerCount = Math.max(1, Math.min(concurrency, Math.max(results.length, 1)));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= results.length) break;

        const current = results[currentIndex];
        try {
          await persistSyncPhaseResult(current, scrapeRunId);
          successCount += 1;
        } catch (error) {
          failures.push({ result: current, error });
        }
      }
    }),
  );

  return { successCount, failures };
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

async function main() {
  const skip = process.env.SKIP_SCRAPE === '1';
  const pdpConcurrency = Math.max(1, Number.parseInt(process.env.SYNC_PDP_CONCURRENCY ?? '3', 10) || 3);
  const dbConcurrency = Math.max(1, Number.parseInt(process.env.SYNC_DB_CONCURRENCY ?? '6', 10) || 6);
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

  try {
    await ensureManualCatalogItems();
    const listingPhaseData = await collectListingPhaseData(skip);
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
      const operatorItems = items.filter((candidate) => candidate.operator === op);
      const listingMap = listingPhaseData[op];
      const listingOnlyResults: SyncPhaseResult[] = [];
      const pdpTargets: Array<{ target: SyncTarget; listingItem?: CatalogDiscoveryItem }> = [];

      for (const item of operatorItems) {
        const target = buildTarget(item);
        const listingItem = listingMap.get(item.operatorItemKey);
        if (shouldUseListingOnly(op, listingItem)) {
          const listingResult = buildListingResult(target, listingItem!);
          if (listingResult) {
            listingOnlyResults.push({ target, listingItem, result: listingResult });
            continue;
          }
        }
        pdpTargets.push({ target, listingItem });
      }

      if (listingOnlyResults.length > 0) {
        console.log(`\n[${op}] listing-only=${listingOnlyResults.length}`);
      }
      processedCount += listingOnlyResults.length;
      const listingPersisted = await persistSyncPhaseResults(listingOnlyResults, run?.id ?? null, dbConcurrency);
      successCount += listingPersisted.successCount;
      for (const failed of listingPersisted.failures) {
        failureCount++;
        console.error(`\n[${op}] ${failed.result.target.phoneModel.slug}:`, failed.error);
      }

      const { results, failures } = await scrapeTargetsWithConcurrency(context, op, pdpTargets, pdpConcurrency);
      processedCount += pdpTargets.length;

      const persisted = await persistSyncPhaseResults(results, run?.id ?? null, dbConcurrency);
      successCount += persisted.successCount;
      for (const failed of persisted.failures) {
        failureCount++;
        console.error(`\n[${op}] ${failed.result.target.phoneModel.slug}:`, failed.error);
        if (run) {
          await addScrapeArtifact({
            scrapeRunId: run.id,
            operator: op,
            phoneModelId: failed.result.target.phoneModelId,
            operatorCatalogItemId: failed.result.target.operatorCatalogItemId,
            artifactType: 'sync-error',
            sourceUrl: failed.result.target.sourceUrl,
            contentType: 'text/plain',
            contentText: String(failed.error),
          });
        }
      }

      for (const failed of failures) {
        failureCount++;
        console.error(`\n[${op}] ${failed.target.phoneModel.slug}:`, failed.error);
        if (run) {
          await addScrapeArtifact({
            scrapeRunId: run.id,
            operator: op,
            phoneModelId: failed.target.phoneModelId,
            operatorCatalogItemId: failed.target.operatorCatalogItemId,
            artifactType: 'sync-error',
            sourceUrl: failed.target.sourceUrl,
            contentType: 'text/plain',
            contentText: String(failed.error),
          });
        }
      }

      if (run) {
        await finishScrapeRun(run.id, {
          status: failureCount > 0 ? (successCount > 0 ? 'PARTIAL' : 'FAILURE') : 'SUCCESS',
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
