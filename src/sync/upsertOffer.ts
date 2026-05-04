import { prisma } from '../db.js';
import type { AvailabilityStatus, OfferType, Prisma } from '@prisma/client';

export type OfferPayload = {
  /** Optional canonical link; mirrors the matched catalog item. */
  phoneModelId?: string | null;
  operatorCatalogItemId: string;
  operator: string;
  offerKey: string;
  offerType?: OfferType;
  title?: string | null;
  retailPriceEur?: number | null;
  monthlyEur?: number | null;
  initialDepositEur?: number | null;
  contractMonths?: number | null;
  planLabel?: string | null;
  tradeInAvailable?: boolean | null;
  availability?: AvailabilityStatus;
  productUrl?: string | null;
  raw?: Prisma.InputJsonValue;
};

export async function upsertOperatorOffer(payload: OfferPayload) {
  return prisma.operatorOffer.upsert({
    where: {
      operatorCatalogItemId_offerKey: {
        operatorCatalogItemId: payload.operatorCatalogItemId,
        offerKey: payload.offerKey,
      },
    },
    create: {
      phoneModelId: payload.phoneModelId ?? null,
      operatorCatalogItemId: payload.operatorCatalogItemId,
      operator: payload.operator,
      offerKey: payload.offerKey,
      offerType: payload.offerType ?? 'OTHER',
      title: payload.title ?? null,
      retailPriceEur: payload.retailPriceEur ?? null,
      monthlyEur: payload.monthlyEur ?? null,
      initialDepositEur: payload.initialDepositEur ?? null,
      contractMonths: payload.contractMonths ?? null,
      planLabel: payload.planLabel ?? null,
      tradeInAvailable: payload.tradeInAvailable ?? null,
      availability: payload.availability ?? 'UNKNOWN',
      productUrl: payload.productUrl ?? null,
      raw: payload.raw,
    },
    update: {
      phoneModelId: payload.phoneModelId ?? null,
      title: payload.title ?? null,
      offerType: payload.offerType ?? 'OTHER',
      retailPriceEur: payload.retailPriceEur ?? null,
      monthlyEur: payload.monthlyEur ?? null,
      initialDepositEur: payload.initialDepositEur ?? null,
      contractMonths: payload.contractMonths ?? null,
      planLabel: payload.planLabel ?? null,
      tradeInAvailable: payload.tradeInAvailable ?? null,
      availability: payload.availability ?? 'UNKNOWN',
      productUrl: payload.productUrl ?? null,
      raw: payload.raw,
      capturedAt: new Date(),
    },
  });
}
