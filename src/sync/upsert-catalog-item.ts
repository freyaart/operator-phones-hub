import type { AvailabilityStatus, Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export type CatalogItemPayload = {
  operator: string;
  operatorItemKey: string;
  phoneModelId: string;
  sourceUrl: string;
  displayName: string;
  variantLabel?: string | null;
  color?: string | null;
  storageGb?: number | null;
  availability?: AvailabilityStatus;
};

export async function upsertOperatorCatalogItem(payload: CatalogItemPayload) {
  return prisma.operatorCatalogItem.upsert({
    where: {
      operator_operatorItemKey: {
        operator: payload.operator,
        operatorItemKey: payload.operatorItemKey,
      },
    },
    create: {
      operator: payload.operator,
      operatorItemKey: payload.operatorItemKey,
      phoneModelId: payload.phoneModelId,
      sourceUrl: payload.sourceUrl,
      displayName: payload.displayName,
      variantLabel: payload.variantLabel ?? null,
      color: payload.color ?? null,
      storageGb: payload.storageGb ?? null,
      availability: payload.availability ?? 'UNKNOWN',
    },
    update: {
      phoneModelId: payload.phoneModelId,
      sourceUrl: payload.sourceUrl,
      displayName: payload.displayName,
      variantLabel: payload.variantLabel ?? null,
      color: payload.color ?? null,
      storageGb: payload.storageGb ?? null,
      availability: payload.availability ?? 'UNKNOWN',
      lastSeenAt: new Date(),
    },
  });
}

export function operatorItemKeyFromUrl(urlOrPath: string): string {
  return urlOrPath.split('#')[0].replace(/^https?:\/\/[^/]+/i, '').replace(/^\//, '');
}

export function normalizeAvailability(value: string | null | undefined): AvailabilityStatus {
  const text = String(value || '').toLowerCase();
  if (!text) return 'UNKNOWN';
  if (/access blocked|blocked/.test(text)) return 'BLOCKED';
  if (/prednaro|preorder/.test(text)) return 'PREORDER';
  if (/ni več v prodaji|discontinued/.test(text)) return 'DISCONTINUED';
  if (/ni na zalogi|out of stock|razprodano/.test(text)) return 'OUT_OF_STOCK';
  if (/na zalogi|in stock|dostava/.test(text)) return 'IN_STOCK';
  return 'UNKNOWN';
}

export function mergeJson(
  current: Prisma.JsonValue | null | undefined,
  patch: Record<string, unknown>,
): Prisma.InputJsonValue {
  const base =
    current != null && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, ...patch } as Prisma.InputJsonValue;
}
