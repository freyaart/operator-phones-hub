/**
 * CLI: refresh normalized operator offers for every discovered catalog item.
 *   npm run sync
 *
 * Requires Chromium: `npx playwright install chromium`
 * Skip network scrapes (stub only): `SKIP_SCRAPE=1 npm run sync`
 *
 * Under the Reborn-first model, sync runs over operator catalog items
 * regardless of whether they are linked to a canonical `PhoneModel` yet.
 * Offers always belong to the catalog item; canonical aggregation happens
 * later via the matcher.
 */
import type { Prisma } from '@prisma/client';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
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

type CatalogItemRow = {
  id: string;
  operator: string;
  operatorItemKey: string;
  phoneModelId: string | null;
  sourceUrl: string;
  displayName: string;
  variantLabel: string | null;
  color: string | null;
  storageGb: number | null;
  parsedBrand: string | null;
  parsedSeries: string | null;
  parsedSlug: string | null;
  phoneModel:
    | {
        slug: string;
        brand: string;
        series: string;
        marketingName: string | null;
        details: Prisma.JsonValue;
      }
    | null;
};

function buildTarget(item: CatalogItemRow): SyncTarget {
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
    parsedBrand: item.parsedBrand,
    parsedSeries: item.parsedSeries,
    parsedSlug: item.parsedSlug,
    phoneModel: item.phoneModel
      ? {
          slug: item.phoneModel.slug,
          brand: item.phoneModel.brand,
          series: item.phoneModel.series,
          marketingName: item.phoneModel.marketingName,
          details: item.phoneModel.details,
        }
      : null,
  };
}

function targetIdentityLabel(target: SyncTarget): string {
  if (target.phoneModel) return target.phoneModel.slug;
  if (target.parsedSlug) return `${target.parsedSlug}*`;
  return `${target.operator}:${target.operatorItemKey}`;
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

  const [t2Result, telemachResult] = await Promise.allSettled([collectT2CatalogItems(), collectTelemachCatalogItems()]);
  const t2Items = t2Result.status === 'fulfilled' ? t2Result.value : [];
  const telemachItems = telemachResult.status === 'fulfilled' ? telemachResult.value : [];
  if (t2Result.status === 'rejected') console.warn('Listing phase: T-2 skipped:', t2Result.reason);
  if (telemachResult.status === 'rejected') console.warn('Listing phase: Telemach skipped:', telemachResult.reason);
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
      brand: target.phoneModel?.brand ?? target.parsedBrand ?? 'Unknown',
      series: target.phoneModel?.series ?? target.parsedSeries ?? target.displayName,
      storageGb: target.storageGb,
      slug: target.phoneModel?.slug ?? target.parsedSlug ?? target.operatorItemKey,
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

async function main() {
  const skip = process.env.SKIP_SCRAPE === '1';
  const listingOnly = process.env.SYNC_LISTING_ONLY === '1';
  const pdpConcurrency = Math.max(1, Number.parseInt(process.env.SYNC_PDP_CONCURRENCY ?? '3', 10) || 3);
  const dbConcurrency = Math.max(1, Number.parseInt(process.env.SYNC_DB_CONCURRENCY ?? '6', 10) || 6);
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  async function getBrowserContext() {
    if (skip) return null;
    if (context) return context;
    browser = await chromium.launch({
      headless: process.env.HEADFUL !== '1',
      args: ['--disable-blink-features=AutomationControlled'],
    });
    context = await browser.newContext({
      locale: 'sl-SI',
      timezoneId: 'Europe/Ljubljana',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    return context;
  }

  try {
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
            version: 'v3',
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
        console.error(`\n[${op}] ${targetIdentityLabel(failed.result.target)}:`, failed.error);
      }

      const scrapeTargets = listingOnly ? [] : pdpTargets;
      if (listingOnly && pdpTargets.length > 0) {
        console.log(`[${op}] skipped PDP targets in SYNC_LISTING_ONLY mode: ${pdpTargets.length}`);
      }
      const syncContext = scrapeTargets.length > 0 ? await getBrowserContext() : null;
      const { results, failures } = await scrapeTargetsWithConcurrency(syncContext, op, scrapeTargets, pdpConcurrency);
      processedCount += pdpTargets.length;

      const persisted = await persistSyncPhaseResults(results, run?.id ?? null, dbConcurrency);
      successCount += persisted.successCount;
      for (const failed of persisted.failures) {
        failureCount++;
        console.error(`\n[${op}] ${targetIdentityLabel(failed.result.target)}:`, failed.error);
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
        console.error(`\n[${op}] ${targetIdentityLabel(failed.target)}:`, failed.error);
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
    const activeContext: BrowserContext | null = context;
    const activeBrowser: Browser | null = browser;
    if (activeContext) await (activeContext as { close(): Promise<void> }).close();
    if (activeBrowser) await (activeBrowser as { close(): Promise<void> }).close();
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
