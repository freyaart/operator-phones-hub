import type { AvailabilityStatus, Prisma } from '@prisma/client';
import type { OfferPayload } from '../upsertOffer.js';

/**
 * Identity passed to per-operator scrapers. Under the Reborn-first model the
 * canonical link is optional: operator items can be scraped before they are
 * matched to a `PhoneModel`. Scrapers must rely on `parsedBrand`/`parsedSeries`
 * (or `displayName`) when `phoneModel` is null.
 */
export type SyncTarget = {
  phoneModelId: string | null;
  operatorCatalogItemId: string;
  operator: string;
  operatorItemKey: string;
  sourceUrl: string;
  displayName: string;
  variantLabel: string | null;
  color: string | null;
  storageGb: number | null;
  parsedBrand: string | null;
  parsedSeries: string | null;
  parsedSlug: string | null;
  phoneModel: {
    slug: string;
    brand: string;
    series: string;
    marketingName: string | null;
    details: Prisma.JsonValue;
  } | null;
};

export type ArtifactPayload = {
  artifactType: string;
  sourceUrl?: string | null;
  contentType?: string | null;
  contentText?: string | null;
  metadata?: Prisma.InputJsonValue;
};

export type OperatorSyncResult = {
  availability?: AvailabilityStatus;
  offers: OfferPayload[];
  artifacts?: ArtifactPayload[];
  note?: string;
};
