import type { AvailabilityStatus, Prisma } from '@prisma/client';
import type { OfferPayload } from '../upsertOffer.js';

export type SyncTarget = {
  phoneModelId: string;
  operatorCatalogItemId: string;
  operator: string;
  operatorItemKey: string;
  sourceUrl: string;
  displayName: string;
  variantLabel: string | null;
  color: string | null;
  storageGb: number | null;
  phoneModel: {
    slug: string;
    brand: string;
    series: string;
    marketingName: string | null;
    details: Prisma.JsonValue;
  };
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
