import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import {
  fetchRebornWaveProducts,
  hasRebornWaveApiConfigured,
  type RebornWaveGroup,
  type RebornWaveProduct,
} from '../lib/reborn-wave.js';
import { beginScrapeRun, finishScrapeRun, addScrapeArtifact } from '../scrape/run-log.js';

type FlatRebornProduct = {
  productId: number;
  parentProductId: number;
  isParent: boolean;
  isMatched: boolean;
  name: string | null;
  optionText: string | null;
  sku: string | null;
  priceEur: number | null;
  oldPriceEur: number | null;
  conditionStatus: string | null;
  foxwayItemVariantId: string | null;
  purchaseStatus: boolean | null;
  active: boolean | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function cleanupRebornDetails(
  details: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  const base = { ...asRecord(details) };
  delete base.rebornProducts;
  delete base.rebornWave;
  return Object.keys(base).length > 0 ? (base as Prisma.InputJsonValue) : Prisma.DbNull;
}

function toFlatProduct(
  parentProductId: number,
  product: RebornWaveProduct,
  isParent: boolean,
  matchedChildIds: number[],
): FlatRebornProduct {
  return {
    productId: product.id,
    parentProductId,
    isParent,
    isMatched: matchedChildIds.includes(product.id) || Boolean(product.matched),
    name: product.name ?? null,
    optionText: product.optionText ?? null,
    sku: product.sku ?? null,
    priceEur: product.price ?? null,
    oldPriceEur: product.oldPrice ?? null,
    conditionStatus: product.conditionStatus ?? null,
    foxwayItemVariantId: product.foxwayItemVariantId ?? null,
    purchaseStatus: product.purchaseStatus ?? null,
    active: product.active ?? null,
  };
}

function flattenGroups(groups: RebornWaveGroup[]): FlatRebornProduct[] {
  const byId = new Map<number, FlatRebornProduct>();

  for (const group of groups) {
    const parentProductId = group.parent.id;
    byId.set(parentProductId, toFlatProduct(parentProductId, group.parent, true, group.matchedChildIds));

    for (const child of group.children) {
      byId.set(child.id, toFlatProduct(parentProductId, child, false, group.matchedChildIds));
    }
  }

  return [...byId.values()];
}

function selectCanonicalProduct(products: FlatRebornProduct[]): FlatRebornProduct | null {
  if (products.length === 0) return null;

  return [...products].sort((a, b) => {
    if (a.isMatched !== b.isMatched) return Number(b.isMatched) - Number(a.isMatched);
    if (a.isParent !== b.isParent) return Number(a.isParent) - Number(b.isParent);
    if ((a.priceEur == null) !== (b.priceEur == null)) return a.priceEur == null ? 1 : -1;
    if ((a.priceEur ?? Infinity) !== (b.priceEur ?? Infinity)) return (a.priceEur ?? Infinity) - (b.priceEur ?? Infinity);
    return a.productId - b.productId;
  })[0] ?? null;
}

async function syncPhoneReborn(phone: {
  id: string;
  slug: string;
  brand: string;
  series: string;
  marketingName: string | null;
  details: Prisma.JsonValue | null;
}) {
  const lookup = await fetchRebornWaveProducts({
    slug: phone.slug,
    brand: phone.brand,
    series: phone.series,
    marketingName: phone.marketingName,
  });

  if (!lookup) {
    await prisma.phoneModel.update({
      where: { id: phone.id },
      data: {
        rebornProductId: null,
        rebornParentProductId: null,
        rebornPriceEur: null,
        details: cleanupRebornDetails(phone.details),
      },
    });
    return null;
  }

  const products = flattenGroups(lookup.groups);
  const canonical = selectCanonicalProduct(products);
  const writes: Prisma.PrismaPromise<unknown>[] = [];

  if (canonical?.productId != null) {
    writes.push(
      prisma.phoneModel.updateMany({
        where: {
          rebornProductId: canonical.productId,
          id: { not: phone.id },
        },
        data: {
          rebornProductId: null,
          rebornParentProductId: null,
          rebornPriceEur: null,
        },
      }),
    );
  }

  writes.push(
    prisma.phoneModel.update({
      where: { id: phone.id },
      data: {
        rebornProductId: canonical?.productId ?? null,
        rebornParentProductId: canonical?.parentProductId ?? null,
        rebornPriceEur: canonical?.priceEur ?? null,
        details: cleanupRebornDetails(phone.details),
      },
    }),
  );

  for (const product of products) {
    writes.push(
      prisma.rebornProduct.upsert({
        where: { productId: product.productId },
        create: {
          phoneModelId: phone.id,
          productId: product.productId,
          parentProductId: product.parentProductId,
          isParent: product.isParent,
          isMatched: product.isMatched,
          name: product.name,
          optionText: product.optionText,
          sku: product.sku,
          priceEur: product.priceEur,
          oldPriceEur: product.oldPriceEur,
          conditionStatus: product.conditionStatus,
          foxwayItemVariantId: product.foxwayItemVariantId,
          purchaseStatus: product.purchaseStatus,
          active: product.active,
        },
        update: {
          phoneModelId: phone.id,
          parentProductId: product.parentProductId,
          isParent: product.isParent,
          isMatched: product.isMatched,
          name: product.name,
          optionText: product.optionText,
          sku: product.sku,
          priceEur: product.priceEur,
          oldPriceEur: product.oldPriceEur,
          conditionStatus: product.conditionStatus,
          foxwayItemVariantId: product.foxwayItemVariantId,
          purchaseStatus: product.purchaseStatus,
          active: product.active,
        },
      }),
    );
  }

  await prisma.$transaction(writes);
  return {
    modelQuery: lookup.modelQuery,
    canonical,
    products,
  };
}

async function main() {
  if (!hasRebornWaveApiConfigured()) {
    console.error('REBORN_WAVE_API_URL is not configured.');
    process.exit(1);
  }

  const concurrency = Math.max(1, Number.parseInt(process.env.REBORN_SYNC_CONCURRENCY ?? '1', 10) || 1);
  const run = await beginScrapeRun({
    operator: 'reborn-wave',
    runType: 'SYNC',
    version: 'v2',
  });

  let processedCount = 0;
  let successCount = 0;
  let failureCount = 0;

  const phones = await prisma.phoneModel.findMany({
    orderBy: [{ brand: 'asc' }, { series: 'asc' }],
  });

  await prisma.$transaction([
    prisma.rebornProduct.deleteMany(),
    prisma.phoneModel.updateMany({
      data: {
        rebornProductId: null,
        rebornParentProductId: null,
        rebornPriceEur: null,
      },
    }),
  ]);

  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(phones.length, 1)) }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        if (currentIndex >= phones.length) break;

        const phone = phones[currentIndex];
        processedCount += 1;

        try {
          const synced = await syncPhoneReborn(phone);
          if (!synced) {
            await addScrapeArtifact({
              scrapeRunId: run.id,
              operator: 'reborn-wave',
              phoneModelId: phone.id,
              artifactType: 'reborn-wave-no-match',
              contentType: 'text/plain',
              contentText: `${phone.brand} ${phone.marketingName ?? phone.series}`,
              metadata: { slug: phone.slug },
            });
            process.stdout.write('-');
            continue;
          }

          await addScrapeArtifact({
            scrapeRunId: run.id,
            operator: 'reborn-wave',
            phoneModelId: phone.id,
            artifactType: 'reborn-wave-match',
            contentType: 'application/json',
            contentText: JSON.stringify(synced, null, 2),
            metadata: { slug: phone.slug, canonicalProductId: synced.canonical?.productId ?? null },
          });
          successCount += 1;
          process.stdout.write('.');
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
          process.stdout.write('!');
        }
      }
    }),
  );

  await finishScrapeRun(run.id, {
    status: failureCount > 0 ? (successCount > 0 ? 'PARTIAL' : 'FAILURE') : 'SUCCESS',
    processedCount,
    successCount,
    failureCount,
  });

  console.log(`\nSynced Reborn data for ${processedCount} phone models.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
