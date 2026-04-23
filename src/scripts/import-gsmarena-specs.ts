/**
 * Import technical phone specs from GSMArena into PhoneSpec.
 *
 *   npm run specs:gsmarena
 *   npm run specs:gsmarena -- --limit=25
 *   npm run specs:gsmarena -- --slug=apple-iphone-15-pro
 *   npm run specs:gsmarena -- --force
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { upsertPhoneModelWithSpec } from '../models/upsert-phone-model.js';
import { addScrapeArtifact, beginScrapeRun, finishScrapeRun } from '../scrape/run-log.js';
import { fetchAndParseGsmarenaSpecs } from '../specs/gsmarena.js';

function arg(name: string): string | undefined {
  const exact = process.argv.find((value) => value.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeGsmarenaDetails(
  current: Prisma.JsonValue | null | undefined,
  input: {
    matchedUrl: string;
    matchedName: string;
    searchQuery: string;
  },
): Prisma.InputJsonValue {
  const base = asRecord(current);
  const specSources = asRecord(base.specSources);
  return {
    ...base,
    specSources: {
      ...specSources,
      gsmarena: {
        url: input.matchedUrl,
        matchedName: input.matchedName,
        searchQuery: input.searchQuery,
        importedAt: new Date().toISOString(),
      },
    },
  } as Prisma.InputJsonValue;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const slug = arg('--slug');
  const limit = Number(arg('--limit') ?? 0) || undefined;
  const force = hasFlag('--force');

  const scrapeRun = await beginScrapeRun({
    operator: 'gsmarena',
    runType: 'SYNC',
    version: 'v1',
    metadata: { slug, limit, force },
  });

  let processedCount = 0;
  let successCount = 0;
  let failureCount = 0;

  try {
    const models = await prisma.phoneModel.findMany({
      where: slug ? { slug } : undefined,
      include: { phoneSpec: true },
      orderBy: [{ updatedAt: 'asc' }, { brand: 'asc' }, { series: 'asc' }],
    });

    const queue = models
      .filter((model) => force || model.phoneSpec == null)
      .slice(0, limit ?? models.length);

    for (const model of queue) {
      processedCount += 1;
      try {
        const parsed = await fetchAndParseGsmarenaSpecs({
          slug: model.slug,
          brand: model.brand,
          series: model.series,
          marketingName: model.marketingName,
        });

        if (!parsed) {
          failureCount += 1;
          await addScrapeArtifact({
            scrapeRunId: scrapeRun.id,
            operator: 'gsmarena',
            phoneModelId: model.id,
            artifactType: 'spec-search-no-match',
            contentType: 'text/plain',
            contentText: `${model.brand} ${model.marketingName ?? model.series}`,
            metadata: { slug: model.slug },
          });
          console.log(`No GSMArena match for ${model.slug}`);
          continue;
        }

        await upsertPhoneModelWithSpec({
          slug: model.slug,
          brand: model.brand,
          series: model.series,
          marketingName: parsed.marketingName || model.marketingName || model.series,
          releaseYear: parsed.releaseYear ?? model.releaseYear ?? null,
          details: mergeGsmarenaDetails(model.details, {
            matchedUrl: parsed.matched.url,
            matchedName: parsed.matched.title,
            searchQuery: parsed.matched.query,
          }),
          specs: parsed.specs,
        });

        await addScrapeArtifact({
          scrapeRunId: scrapeRun.id,
          operator: 'gsmarena',
          phoneModelId: model.id,
          artifactType: 'spec-import',
          sourceUrl: parsed.matched.url,
          contentType: 'application/json',
          contentText: JSON.stringify(
            {
              matchedName: parsed.matched.title,
              searchQuery: parsed.matched.query,
              releaseYear: parsed.releaseYear,
              marketingName: parsed.marketingName,
            },
            null,
            2,
          ),
          metadata: {
            score: parsed.matched.score,
            query: parsed.matched.query,
          },
        });

        successCount += 1;
        console.log(`Imported GSMArena specs for ${model.slug} -> ${parsed.matched.title}`);
        await sleep(300);
      } catch (error) {
        failureCount += 1;
        await addScrapeArtifact({
          scrapeRunId: scrapeRun.id,
          operator: 'gsmarena',
          phoneModelId: model.id,
          artifactType: 'spec-import-error',
          contentType: 'text/plain',
          contentText: String(error),
          metadata: { slug: model.slug },
        });
        console.error(`Failed GSMArena import for ${model.slug}:`, error);
      }
    }
  } finally {
    await finishScrapeRun(scrapeRun.id, {
      status: failureCount > 0 ? (successCount > 0 ? 'PARTIAL' : 'FAILURE') : 'SUCCESS',
      processedCount,
      successCount,
      failureCount,
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
