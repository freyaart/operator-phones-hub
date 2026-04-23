/**
 * Discover canonical phone models plus operator-specific catalog items.
 *
 *   npm run discover
 *   npm run discover -- --sources=telekom
 *   npm run discover -- --dry-run
 */
import { chromium } from 'playwright';
import { prisma } from '../db.js';
import { collectTelekomCatalogItems } from '../discovery/collect-telekom.js';
import { collectA1CatalogItems } from '../discovery/collect-a1.js';
import { collectT2CatalogItems } from '../discovery/collect-t2.js';
import { collectTelemachCatalogItems } from '../discovery/collect-telemach.js';
import { mergeDiscoveryDetails } from '../discovery/merge-details.js';
import type { CatalogDiscoveryItem } from '../discovery/types.js';
import { upsertPhoneModelWithSpec } from '../models/upsert-phone-model.js';
import { beginScrapeRun, finishScrapeRun, addScrapeArtifact } from '../scrape/run-log.js';
import { upsertOperatorCatalogItem } from '../sync/upsert-catalog-item.js';

function arg(name: string): string | undefined {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function hasFlag(f: string): boolean {
  return process.argv.includes(f);
}

async function upsertDiscoveredItem(item: CatalogDiscoveryItem, dryRun: boolean, scrapeRunId: string | null) {
  if (dryRun) {
    console.log(
      `[${item.operator}]`,
      item.canonicalSlug,
      '→',
      item.brand,
      item.series,
      item.storageGb,
      item.color ?? '',
    );
    return;
  }

  const existing = await prisma.phoneModel.findUnique({ where: { slug: item.canonicalSlug } });
  const details = mergeDiscoveryDetails(existing?.details, {
    shopUrl: { operator: item.operator, url: item.sourceUrl },
    importTag: `${item.operator}-listing`,
  });
  const phoneModel = await upsertPhoneModelWithSpec({
    slug: item.canonicalSlug,
    brand: item.brand,
    series: item.series,
    marketingName: item.series,
    details,
  });

  const catalogItem = await upsertOperatorCatalogItem({
    operator: item.operator,
    operatorItemKey: item.operatorItemKey,
    phoneModelId: phoneModel.id,
    sourceUrl: item.sourceUrl,
    displayName: item.displayName,
    variantLabel: item.variantLabel,
    color: item.color,
    storageGb: item.storageGb,
    availability: item.availability,
  });

  await addScrapeArtifact({
    scrapeRunId,
    operator: item.operator,
    phoneModelId: phoneModel.id,
    operatorCatalogItemId: catalogItem.id,
    artifactType: 'listing-card',
    sourceUrl: item.sourceUrl,
    contentType: 'text/plain',
    contentText: item.variantLabel ?? item.displayName,
    metadata: {
      canonicalSlug: item.canonicalSlug,
      storageGb: item.storageGb,
      color: item.color,
      availability: item.availability,
    },
  });
}

async function processSource(
  operator: 'telekom' | 'a1' | 't2' | 'telemach',
  items: CatalogDiscoveryItem[],
  dryRun: boolean,
) {
  const scrapeRun = dryRun
    ? null
    : await beginScrapeRun({
        operator,
        runType: 'DISCOVER',
        version: 'v2',
        metadata: { discoveredCount: items.length },
      });
  let successCount = 0;
  let failureCount = 0;
  try {
    for (const item of items) {
      try {
        await upsertDiscoveredItem(item, dryRun, scrapeRun?.id ?? null);
        successCount++;
      } catch (error) {
        failureCount++;
        if (scrapeRun) {
          await addScrapeArtifact({
            scrapeRunId: scrapeRun.id,
            operator,
            artifactType: 'discovery-error',
            sourceUrl: item.sourceUrl,
            contentType: 'text/plain',
            contentText: String(error),
            metadata: { itemKey: item.operatorItemKey, canonicalSlug: item.canonicalSlug },
          });
        }
      }
    }
  } finally {
    if (scrapeRun) {
      await finishScrapeRun(scrapeRun.id, {
        status: failureCount > 0 ? 'PARTIAL' : 'SUCCESS',
        processedCount: items.length,
        successCount,
        failureCount,
      });
    }
  }
}

async function main() {
  const dryRun = hasFlag('--dry-run');
  const sourcesArg = arg('--sources');
  const sources = new Set(
    (sourcesArg ?? 'telekom,a1,t2,telemach')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );

  const browser = await chromium.launch({
    headless: process.env.HEADFUL !== '1',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'sl-SI',
    timezoneId: 'Europe/Ljubljana',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let telekomCount = 0;
  let a1Count = 0;
  let t2Count = 0;
  let telemachCount = 0;

  try {
    if (sources.has('telekom')) {
      const items = await collectTelekomCatalogItems(page);
      telekomCount = items.length;
      console.log(`Telekom: ${items.length} catalog items`);
      await processSource('telekom', items, dryRun);
    }

    if (sources.has('a1')) {
      const items = await collectA1CatalogItems(page);
      a1Count = items.length;
      console.log(`A1: ${items.length} catalog items`);
      await processSource('a1', items, dryRun);
    }

    if (sources.has('t2')) {
      const items = await collectT2CatalogItems();
      t2Count = items.length;
      console.log(`T-2: ${items.length} catalog items`);
      await processSource('t2', items, dryRun);
    }

    if (sources.has('telemach')) {
      const items = await collectTelemachCatalogItems();
      telemachCount = items.length;
      console.log(`Telemach: ${items.length} catalog items`);
      await processSource('telemach', items, dryRun);
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (!dryRun) {
    const total = await prisma.phoneModel.count();
    console.log(`Done. PhoneModel rows in DB: ${total}`);
  } else {
    console.log(
      `Dry run: telekom URLs=${telekomCount}, a1 paths=${a1Count}, t2 items=${t2Count}, telemach items=${telemachCount} (no DB writes)`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
