import type { AvailabilityStatus, OfferType, Prisma } from '@prisma/client';

export type CatalogDiscoveryOffer = {
  offerKey: string;
  offerType: OfferType;
  title: string;
  retailPriceEur?: number | null;
  monthlyEur?: number | null;
  initialDepositEur?: number | null;
  contractMonths?: number | null;
  planLabel?: string | null;
  raw?: Prisma.InputJsonValue;
};

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
  listingOffers?: CatalogDiscoveryOffer[];
};
