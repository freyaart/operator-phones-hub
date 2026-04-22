import type { Prisma } from '@prisma/client';

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function mergeDiscoveryDetails(
  existing: Prisma.JsonValue | null | undefined,
  patch: { shopUrl?: { operator: string; url: string }; importTag?: string }
): Prisma.InputJsonValue {
  const base = asRecord(existing);
  const shopUrls = { ...asRecord(base.shopUrls) };
  if (patch.shopUrl) {
    shopUrls[patch.shopUrl.operator] = patch.shopUrl.url;
  }
  const discoveredFrom = Array.isArray(base.discoveredFrom)
    ? [...(base.discoveredFrom as string[])]
    : [];
  if (patch.importTag && !discoveredFrom.includes(patch.importTag)) {
    discoveredFrom.push(patch.importTag);
  }
  return {
    ...base,
    shopUrls: Object.keys(shopUrls).length ? shopUrls : base.shopUrls,
    discoveredFrom: discoveredFrom.length ? discoveredFrom : base.discoveredFrom,
    catalogImportedAt: new Date().toISOString(),
  } as unknown as Prisma.InputJsonValue;
}
