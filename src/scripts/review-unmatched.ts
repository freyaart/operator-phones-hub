import type { MatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../db.js';

async function main() {
  const includeReview = process.argv.includes('--include-review');
  const where: Prisma.OperatorCatalogItemWhereInput = {
    matchStatus: includeReview ? { in: ['UNMATCHED', 'NEEDS_REVIEW'] satisfies MatchStatus[] } : 'UNMATCHED',
  };
  const [counts, rows] = await Promise.all([
    prisma.operatorCatalogItem.groupBy({
      by: ['operator', 'matchStatus'],
      where,
      _count: { _all: true },
      orderBy: [{ operator: 'asc' }, { matchStatus: 'asc' }],
    }),
    prisma.operatorCatalogItem.findMany({
      where,
      take: 100,
      orderBy: [{ operator: 'asc' }, { displayName: 'asc' }],
      select: {
        operator: true,
        displayName: true,
        variantLabel: true,
        parsedBrand: true,
        parsedSeries: true,
        parsedSlug: true,
        matchStatus: true,
        matchConfidence: true,
        sourceUrl: true,
      },
    }),
  ]);

  console.log('\nUnmatched catalog summary');
  for (const count of counts) {
    console.log(`${count.operator} ${count.matchStatus}: ${count._count._all ?? 0}`);
  }

  console.log('\nSample rows');
  for (const row of rows) {
    console.log(
      JSON.stringify({
        operator: row.operator,
        displayName: row.displayName,
        variantLabel: row.variantLabel,
        parsedBrand: row.parsedBrand,
        parsedSeries: row.parsedSeries,
        parsedSlug: row.parsedSlug,
        matchStatus: row.matchStatus,
        matchConfidence: row.matchConfidence,
        sourceUrl: row.sourceUrl,
      }),
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
