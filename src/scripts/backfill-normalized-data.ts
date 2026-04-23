/**
 * Backfill normalized tables from legacy `PhoneModel.specs` and `details.shopUrls`.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import type { PhoneTechnicalSpecs } from '../specs/phone-technical-specs.js';
import { mapPhoneTechnicalSpecsToPhoneSpec } from '../specs/map-phone-technical-specs.js';
import { upsertOperatorCatalogItem, operatorItemKeyFromUrl } from '../sync/upsert-catalog-item.js';

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function main() {
  const phones = await prisma.phoneModel.findMany();
  for (const phone of phones) {
    if (phone.specs) {
      const specData = mapPhoneTechnicalSpecsToPhoneSpec(phone.specs as unknown as PhoneTechnicalSpecs);
      await prisma.phoneSpec.upsert({
        where: { phoneModelId: phone.id },
        create: {
          ...(specData as Prisma.PhoneSpecUncheckedCreateInput),
          phoneModelId: phone.id,
        },
        update: specData as Prisma.PhoneSpecUncheckedUpdateInput,
      });
    }

    const details = asRecord(phone.details);
    const shopUrls =
      details.shopUrls && typeof details.shopUrls === 'object' && !Array.isArray(details.shopUrls)
        ? (details.shopUrls as Record<string, unknown>)
        : {};
    for (const [operator, value] of Object.entries(shopUrls)) {
      if (typeof value !== 'string' || !value.startsWith('http')) continue;
      await upsertOperatorCatalogItem({
        operator,
        operatorItemKey: operatorItemKeyFromUrl(value),
        phoneModelId: phone.id,
        sourceUrl: value,
        displayName: phone.marketingName || phone.series,
        storageGb: phone.storageGb,
      });
    }
    console.log('Backfilled', phone.slug);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
