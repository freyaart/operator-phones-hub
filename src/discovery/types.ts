import type { AvailabilityStatus } from '@prisma/client';

export type CatalogDiscoveryItem = {
  operator: string;
  operatorItemKey: string;
  sourceUrl: string;
  displayName: string;
  variantLabel?: string | null;
  color?: string | null;
  storageGb?: number | null;
  availability?: AvailabilityStatus;
  canonicalSlug: string;
  brand: string;
  series: string;
  isPhone: boolean;
};
