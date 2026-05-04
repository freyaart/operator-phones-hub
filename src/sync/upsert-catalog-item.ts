import type { AvailabilityStatus, MatchStatus, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { buildMatcherInput, matchOperatorItem } from '../matching/match-operator-item.js';

export type CatalogItemPayload = {
  operator: string;
  operatorItemKey: string;
  /**
   * Optional canonical link. When omitted (the common case under the
   * Reborn-first model), the matcher resolves the canonical row.
   */
  phoneModelId?: string | null;
  sourceUrl: string;
  displayName: string;
  variantLabel?: string | null;
  color?: string | null;
  storageGb?: number | null;
  availability?: AvailabilityStatus;
  parsedBrand?: string | null;
  parsedSeries?: string | null;
  parsedSlug?: string | null;
  /**
   * When true (default) and `phoneModelId` is not supplied, the matcher runs
   * synchronously and stores the resulting link + match state.
   */
  runMatcher?: boolean;
};

export type UpsertCatalogItemResult = Awaited<ReturnType<typeof prisma.operatorCatalogItem.upsert>>;

export async function upsertOperatorCatalogItem(payload: CatalogItemPayload): Promise<UpsertCatalogItemResult> {
  let phoneModelId: string | null | undefined = payload.phoneModelId ?? null;
  let matchStatus: MatchStatus = phoneModelId ? 'MATCHED_MANUAL' : 'UNMATCHED';
  let matchConfidence: number | null = phoneModelId ? 1 : null;
  let matchedBy: string | null = phoneModelId ? 'manual-upsert' : null;
  let matchedAt: Date | null = phoneModelId ? new Date() : null;

  const shouldRunMatcher =
    payload.runMatcher !== false && !payload.phoneModelId && (payload.parsedBrand || payload.parsedSlug);

  if (shouldRunMatcher) {
    const decision = await matchOperatorItem(
      buildMatcherInput({
        parsedBrand: payload.parsedBrand ?? null,
        parsedSeries: payload.parsedSeries ?? null,
        parsedSlug: payload.parsedSlug ?? null,
        storageGb: payload.storageGb ?? null,
        displayName: payload.displayName,
      }),
    );
    phoneModelId = decision.phoneModelId;
    matchStatus = decision.matchStatus;
    matchConfidence = decision.matchConfidence;
    matchedBy = decision.matchedBy;
    matchedAt = decision.phoneModelId ? new Date() : null;
  }

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
      phoneModelId: phoneModelId ?? null,
      sourceUrl: payload.sourceUrl,
      displayName: payload.displayName,
      variantLabel: payload.variantLabel ?? null,
      color: payload.color ?? null,
      storageGb: payload.storageGb ?? null,
      availability: payload.availability ?? 'UNKNOWN',
      parsedBrand: payload.parsedBrand ?? null,
      parsedSeries: payload.parsedSeries ?? null,
      parsedSlug: payload.parsedSlug ?? null,
      matchStatus,
      matchConfidence,
      matchedBy,
      matchedAt,
    },
    update: {
      sourceUrl: payload.sourceUrl,
      displayName: payload.displayName,
      variantLabel: payload.variantLabel ?? null,
      color: payload.color ?? null,
      storageGb: payload.storageGb ?? null,
      availability: payload.availability ?? 'UNKNOWN',
      parsedBrand: payload.parsedBrand ?? null,
      parsedSeries: payload.parsedSeries ?? null,
      parsedSlug: payload.parsedSlug ?? null,
      // Preserve manual matches; never overwrite them from a discovery upsert.
      ...(payload.phoneModelId !== undefined
        ? {
            phoneModelId: payload.phoneModelId,
            matchStatus,
            matchConfidence,
            matchedBy,
            matchedAt,
          }
        : shouldRunMatcher
          ? {
              phoneModelId,
              matchStatus,
              matchConfidence,
              matchedBy,
              matchedAt,
            }
          : {}),
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
