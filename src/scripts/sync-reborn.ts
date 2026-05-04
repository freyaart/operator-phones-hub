/**
 * Reborn-first catalog importer.
 *
 * Pulls the Reborn catalog from the Wave API (fanned out across brand seed
 * queries because the API only accepts a `query` param) and rebuilds canonical
 * `PhoneModel` rows + `RebornProduct` variants. Operator catalog items live
 * independently and are linked back to canonical models by the matcher in
 * `discover-models.ts` / `sync.ts`.
 *
 *   npm run sync:reborn
 *   npm run sync:reborn -- --queries=Apple,Samsung   # restrict to specific seeds
 *   npm run sync:reborn -- --extra-queries=Honor 90,Honor Magic7
 *   npm run sync:reborn -- --dry-run                  # no DB writes
 *   npm run sync:reborn -- --rematch                  # re-run matcher against existing operator items
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import {
  fetchRebornWaveByQuery,
  hasRebornWaveApiConfigured,
  REBORN_BRAND_SEED_QUERIES,
  type RebornWaveGroup,
  type RebornWaveProduct,
} from '../lib/reborn-wave.js';
import {
  parseRebornChildColor,
  parseRebornProductName,
  type ParsedRebornName,
} from '../lib/reborn-name-parser.js';
import { addScrapeArtifact, beginScrapeRun, finishScrapeRun } from '../scrape/run-log.js';
import { rematchAllOperatorCatalogItems } from '../matching/match-operator-item.js';

type CliOptions = {
  queries: string[];
  dryRun: boolean;
  rematch: boolean;
};

function parseCli(): CliOptions {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const exact = argv.find((value) => value.startsWith(`${name}=`));
    if (exact) return exact.slice(name.length + 1);
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const list = (name: string): string[] | undefined => {
    const value = get(name);
    if (value == null) return undefined;
    return value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const queries = list('--queries') ?? [...REBORN_BRAND_SEED_QUERIES];
  const extra = list('--extra-queries') ?? [];
  const dryRun = argv.includes('--dry-run');
  const rematch = argv.includes('--rematch');

  return {
    queries: [...new Set([...queries, ...extra])],
    dryRun,
    rematch,
  };
}

type ParsedRebornGroup = {
  parent: RebornWaveProduct;
  children: RebornWaveProduct[];
  matchedChildIds: Set<number>;
  parsed: ParsedRebornName;
};

function dedupeGroupsByParentId(groups: RebornWaveGroup[]): RebornWaveGroup[] {
  const byParent = new Map<number, RebornWaveGroup>();
  for (const group of groups) {
    const id = group.parent?.id;
    if (id == null) continue;
    if (!byParent.has(id)) byParent.set(id, group);
  }
  return [...byParent.values()];
}

function parseGroups(groups: RebornWaveGroup[]): {
  parsed: ParsedRebornGroup[];
  unparsable: { parentId: number; name: string | null }[];
} {
  const parsed: ParsedRebornGroup[] = [];
  const unparsable: { parentId: number; name: string | null }[] = [];

  for (const group of groups) {
    const parentName = group.parent.name ?? '';
    const parsedName = parseRebornProductName(parentName);
    if (!parsedName) {
      unparsable.push({ parentId: group.parent.id, name: group.parent.name });
      continue;
    }
    parsed.push({
      parent: group.parent,
      children: group.children ?? [],
      matchedChildIds: new Set(group.matchedChildIds ?? []),
      parsed: parsedName,
    });
  }

  return { parsed, unparsable };
}

type CanonicalAggregate = {
  brand: string;
  series: string;
  marketingName: string;
  canonicalSlug: string;
  groups: ParsedRebornGroup[];
};

function aggregateByCanonical(parsed: ParsedRebornGroup[]): Map<string, CanonicalAggregate> {
  const byCanonical = new Map<string, CanonicalAggregate>();
  for (const group of parsed) {
    const key = group.parsed.canonicalSlug;
    const existing = byCanonical.get(key);
    if (existing) {
      existing.groups.push(group);
      continue;
    }
    byCanonical.set(key, {
      brand: group.parsed.brand,
      series: group.parsed.series,
      marketingName: group.parsed.marketingName,
      canonicalSlug: group.parsed.canonicalSlug,
      groups: [group],
    });
  }
  return byCanonical;
}

function flatVariantRows(
  phoneModelId: string,
  aggregate: CanonicalAggregate,
): Prisma.RebornProductCreateManyInput[] {
  const rows: Prisma.RebornProductCreateManyInput[] = [];
  const seen = new Set<number>();

  for (const group of aggregate.groups) {
    if (!seen.has(group.parent.id)) {
      seen.add(group.parent.id);
      rows.push({
        phoneModelId,
        productId: group.parent.id,
        parentProductId: group.parent.id,
        isParent: true,
        isMatched: Boolean(group.parent.matched),
        name: group.parent.name ?? null,
        optionText: group.parent.optionText ?? null,
        sku: group.parent.sku ?? null,
        storageGb: group.parsed.storageGb ?? null,
        color: null,
        grade: group.parsed.grade ?? null,
        priceEur: group.parent.price ?? null,
        oldPriceEur: group.parent.oldPrice ?? null,
        conditionStatus: group.parent.conditionStatus ?? null,
        foxwayItemVariantId: group.parent.foxwayItemVariantId ?? null,
        purchaseStatus: group.parent.purchaseStatus ?? null,
        active: group.parent.active ?? null,
      });
    }

    for (const child of group.children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      const parsedChild = parseRebornProductName(child.name ?? '') ?? group.parsed;
      rows.push({
        phoneModelId,
        productId: child.id,
        parentProductId: group.parent.id,
        isParent: false,
        isMatched: group.matchedChildIds.has(child.id) || Boolean(child.matched),
        name: child.name ?? null,
        optionText: child.optionText ?? null,
        sku: child.sku ?? null,
        storageGb: parsedChild.storageGb ?? group.parsed.storageGb ?? null,
        color: parseRebornChildColor(child),
        grade: parsedChild.grade ?? group.parsed.grade ?? null,
        priceEur: child.price ?? null,
        oldPriceEur: child.oldPrice ?? null,
        conditionStatus: child.conditionStatus ?? null,
        foxwayItemVariantId: child.foxwayItemVariantId ?? null,
        purchaseStatus: child.purchaseStatus ?? null,
        active: child.active ?? null,
      });
    }
  }

  return rows;
}

async function upsertCanonicalModel(
  aggregate: CanonicalAggregate,
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.phoneModel.findUnique({ where: { slug: aggregate.canonicalSlug } });
  const data: Prisma.PhoneModelUncheckedCreateInput = {
    slug: aggregate.canonicalSlug,
    brand: aggregate.brand,
    series: aggregate.series,
    marketingName: aggregate.marketingName,
    source: 'reborn',
  };

  if (existing) {
    const updated = await prisma.phoneModel.update({
      where: { id: existing.id },
      data: {
        brand: data.brand,
        series: data.series,
        marketingName: data.marketingName,
        source: data.source,
      },
    });
    return { id: updated.id, created: false };
  }

  const created = await prisma.phoneModel.create({ data });
  return { id: created.id, created: true };
}

async function persistAggregate(aggregate: CanonicalAggregate): Promise<{ created: boolean; variantCount: number }> {
  const { id, created } = await upsertCanonicalModel(aggregate);
  const rows = flatVariantRows(id, aggregate);
  if (rows.length === 0) return { created, variantCount: 0 };

  await prisma.$transaction(async (tx) => {
    await tx.rebornProduct.deleteMany({ where: { phoneModelId: id } });
    if (rows.length > 0) {
      await tx.rebornProduct.createMany({ data: rows });
    }
  });
  return { created, variantCount: rows.length };
}

async function main() {
  if (!hasRebornWaveApiConfigured()) {
    console.error('REBORN_WAVE_API_URL is not configured.');
    process.exit(1);
  }

  const cli = parseCli();
  const run = cli.dryRun
    ? null
    : await beginScrapeRun({
        operator: 'reborn-wave',
        runType: 'SYNC',
        version: 'v3',
        metadata: { mode: 'reborn-first', queries: cli.queries },
      });

  const allGroups: RebornWaveGroup[] = [];
  const queryStats: { query: string; groups: number }[] = [];
  let queryFailures = 0;

  for (const query of cli.queries) {
    try {
      const result = await fetchRebornWaveByQuery(query);
      const groups = result?.groups ?? [];
      queryStats.push({ query, groups: groups.length });
      if (groups.length === 0) {
        process.stdout.write('·');
      } else {
        allGroups.push(...groups);
        process.stdout.write('.');
      }
    } catch (error) {
      queryFailures += 1;
      process.stdout.write('!');
      if (run) {
        await addScrapeArtifact({
          scrapeRunId: run.id,
          operator: 'reborn-wave',
          artifactType: 'reborn-wave-query-error',
          contentType: 'text/plain',
          contentText: String(error),
          metadata: { query },
        });
      }
    }
  }
  process.stdout.write('\n');

  const dedupedGroups = dedupeGroupsByParentId(allGroups);
  const { parsed, unparsable } = parseGroups(dedupedGroups);
  const canonicalGroups = aggregateByCanonical(parsed);

  console.log(
    `Reborn API: ${cli.queries.length} seed queries, ${dedupedGroups.length} unique parent products, ` +
      `${parsed.length} parsable -> ${canonicalGroups.size} canonical models, ${unparsable.length} unparsable, ${queryFailures} query failures.`,
  );
  for (const stat of queryStats) {
    console.log(`  - ${stat.query}: ${stat.groups} groups`);
  }
  if (unparsable.length > 0) {
    console.log('Unparsable parent products:');
    for (const u of unparsable.slice(0, 25)) console.log(`  ! [${u.parentId}] ${u.name ?? '(no name)'}`);
    if (unparsable.length > 25) console.log(`  (+${unparsable.length - 25} more)`);
  }

  if (cli.dryRun) {
    console.log('\nDry run; no DB writes.');
    return;
  }

  let createdModels = 0;
  let updatedModels = 0;
  let totalVariants = 0;

  const aggregates = [...canonicalGroups.values()].sort((a, b) =>
    a.brand === b.brand ? a.series.localeCompare(b.series) : a.brand.localeCompare(b.brand),
  );
  const seenCanonicalIds = new Set<string>();

  for (const aggregate of aggregates) {
    try {
      const { created, variantCount } = await persistAggregate(aggregate);
      if (created) createdModels += 1;
      else updatedModels += 1;
      totalVariants += variantCount;
      const phoneModel = await prisma.phoneModel.findUnique({ where: { slug: aggregate.canonicalSlug } });
      if (phoneModel) seenCanonicalIds.add(phoneModel.id);
      if (run) {
        await addScrapeArtifact({
          scrapeRunId: run.id,
          operator: 'reborn-wave',
          phoneModelId: phoneModel?.id ?? null,
          artifactType: 'reborn-wave-canonical',
          contentType: 'text/plain',
          contentText: `${aggregate.brand} ${aggregate.series}`,
          metadata: {
            slug: aggregate.canonicalSlug,
            variantCount,
            created,
          },
        });
      }
    } catch (error) {
      console.error(`\nFailed to persist ${aggregate.canonicalSlug}:`, error);
      if (run) {
        await addScrapeArtifact({
          scrapeRunId: run.id,
          operator: 'reborn-wave',
          artifactType: 'reborn-wave-persist-error',
          contentType: 'text/plain',
          contentText: String(error),
          metadata: { slug: aggregate.canonicalSlug },
        });
      }
    }
  }

  // Drop canonical models that no longer appear in the Reborn catalog (only the reborn-sourced ones).
  const stale = await prisma.phoneModel.findMany({
    where: { source: 'reborn', id: { notIn: [...seenCanonicalIds] } },
    select: { id: true, slug: true },
  });
  if (stale.length > 0) {
    console.log(`\nRemoving ${stale.length} stale Reborn-sourced PhoneModel rows:`);
    for (const phone of stale) console.log(`  - ${phone.slug}`);
    await prisma.phoneModel.deleteMany({ where: { id: { in: stale.map((p) => p.id) } } });
  }

  const matchSummary = cli.rematch
    ? await rematchAllOperatorCatalogItems()
    : await rematchAllOperatorCatalogItems({ onlyUnmatched: true });

  if (run) {
    await finishScrapeRun(run.id, {
      status: queryFailures > 0 ? 'PARTIAL' : 'SUCCESS',
      processedCount: cli.queries.length,
      successCount: createdModels + updatedModels,
      failureCount: queryFailures,
      metadata: {
        createdModels,
        updatedModels,
        totalVariants,
        canonicalCount: canonicalGroups.size,
        rematched: matchSummary,
      },
    });
  }

  console.log(
    `\nReborn import: created=${createdModels}, updated=${updatedModels}, totalVariants=${totalVariants}, removedStale=${stale.length}.`,
  );
  console.log(
    `Operator matcher: matched=${matchSummary.matched}, needsReview=${matchSummary.needsReview}, unmatched=${matchSummary.unmatched} (scope=${cli.rematch ? 'all' : 'unmatched'}).`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
