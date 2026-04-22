import type { OperatorId } from '../types.js';
import { prisma } from '../db.js';

export type OfferPayload = {
  retailPriceEur?: number | null;
  monthlyEur?: number | null;
  contractLabel?: string | null;
  tradeInAvailable?: boolean | null;
  productUrl?: string | null;
  raw?: unknown;
};

export async function upsertOperatorOffer(
  phoneModelId: string,
  operator: OperatorId,
  payload: OfferPayload
) {
  return prisma.operatorOffer.upsert({
    where: {
      phoneModelId_operator: { phoneModelId, operator },
    },
    create: {
      phoneModelId,
      operator,
      retailPriceEur: payload.retailPriceEur ?? null,
      monthlyEur: payload.monthlyEur ?? null,
      contractLabel: payload.contractLabel ?? null,
      tradeInAvailable: payload.tradeInAvailable ?? null,
      productUrl: payload.productUrl ?? null,
      raw: payload.raw === undefined ? undefined : (payload.raw as object),
    },
    update: {
      retailPriceEur: payload.retailPriceEur ?? null,
      monthlyEur: payload.monthlyEur ?? null,
      contractLabel: payload.contractLabel ?? null,
      tradeInAvailable: payload.tradeInAvailable ?? null,
      productUrl: payload.productUrl ?? null,
      raw: payload.raw === undefined ? undefined : (payload.raw as object),
      syncedAt: new Date(),
    },
  });
}
