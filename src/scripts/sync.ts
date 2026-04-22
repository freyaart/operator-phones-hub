/**
 * CLI: refresh operator rows for every phone in the catalog.
 *   npm run sync
 *
 * Wire real scrapers in `src/sync/operators/` and call them from `runOperatorSync`.
 */
import { OPERATORS } from '../types.js';
import { prisma } from '../db.js';
import { upsertOperatorOffer } from '../sync/upsertOffer.js';
import { stubFetchOffer } from '../sync/operators/stub.js';
import type { OperatorId } from '../types.js';

async function runOperatorSync(operator: OperatorId, phone: { id: string; brand: string; series: string; storageGb: number | null; slug: string }) {
  const payload = await stubFetchOffer(operator, phone);
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

  for (const phone of phones) {
    for (const op of OPERATORS) {
      try {
        await runOperatorSync(op, phone);
        process.stdout.write('.');
      } catch (e) {
        console.error(`\n[${op}] ${phone.slug}:`, e);
      }
    }
  }

  console.log(`\nSynced ${phones.length} phones × ${OPERATORS.length} operators.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
