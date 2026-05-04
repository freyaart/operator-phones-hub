import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import type { PhoneTechnicalSpecs } from '../specs/phone-technical-specs.js';
import { mapPhoneTechnicalSpecsToPhoneSpec } from '../specs/map-phone-technical-specs.js';

export type UpsertPhoneModelInput = {
  slug: string;
  brand: string;
  series: string;
  marketingName?: string | null;
  releaseYear?: number | null;
  source?: string;
  specs?: PhoneTechnicalSpecs;
  details?: Prisma.InputJsonValue;
};

/**
 * Upsert a canonical `PhoneModel` row by slug. Used by spec importers
 * (e.g. GSMArena) to enrich existing canonical rows. Under the Reborn-first
 * model, canonical rows themselves are owned by `sync:reborn`.
 */
export async function upsertPhoneModelWithSpec(input: UpsertPhoneModelInput) {
  const phoneModel = await prisma.phoneModel.upsert({
    where: { slug: input.slug },
    create: {
      slug: input.slug,
      brand: input.brand,
      series: input.series,
      marketingName: input.marketingName ?? null,
      releaseYear: input.releaseYear ?? null,
      source: input.source ?? 'reborn',
      specs: input.specs === undefined ? undefined : (input.specs as Prisma.InputJsonValue),
      details: input.details,
    },
    update: {
      brand: input.brand,
      series: input.series,
      marketingName: input.marketingName ?? null,
      releaseYear: input.releaseYear ?? null,
      ...(input.source ? { source: input.source } : {}),
      specs: input.specs === undefined ? undefined : (input.specs as Prisma.InputJsonValue),
      details: input.details,
    },
  });

  if (input.specs) {
    const specData = mapPhoneTechnicalSpecsToPhoneSpec(input.specs);
    await prisma.phoneSpec.upsert({
      where: { phoneModelId: phoneModel.id },
      create: {
        ...(specData as Prisma.PhoneSpecUncheckedCreateInput),
        phoneModelId: phoneModel.id,
      },
      update: specData as Prisma.PhoneSpecUncheckedUpdateInput,
    });
  }

  return phoneModel;
}
