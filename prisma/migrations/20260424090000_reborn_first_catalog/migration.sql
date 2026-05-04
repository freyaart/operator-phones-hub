-- Reborn-first canonical catalog migration.
-- 1. Wipe operator-derived rows (catalog will be rebuilt from Reborn + new matcher).
-- 2. Drop the old Reborn fields from PhoneModel (they live in RebornProduct now).
-- 3. Add match-state and parsed-discovery columns to OperatorCatalogItem.
-- 4. Make canonical FK columns on operator rows nullable (operator items can exist
--    without a canonical link until the matcher resolves them).
-- 5. Extend RebornProduct with storage / color / grade parsed from the Reborn name.

BEGIN;

-- 1. Truncate operator + canonical data so the pipeline can repopulate Reborn-first.
--    `RebornProduct` has FK ON DELETE CASCADE to `PhoneModel`, so it's wiped automatically.
TRUNCATE TABLE
  "OperatorOffer",
  "OperatorCatalogItem",
  "PhoneSpec",
  "RebornProduct",
  "PhoneModel",
  "ScrapeArtifact",
  "ScrapeRun"
RESTART IDENTITY CASCADE;

-- 2. Drop legacy Reborn columns from PhoneModel (migrated into RebornProduct rows).
DROP INDEX IF EXISTS "PhoneModel_rebornProductId_key";
DROP INDEX IF EXISTS "PhoneModel_rebornParentProductId_idx";

ALTER TABLE "PhoneModel"
  DROP COLUMN IF EXISTS "rebornProductId",
  DROP COLUMN IF EXISTS "rebornParentProductId",
  DROP COLUMN IF EXISTS "rebornPriceEur",
  DROP COLUMN IF EXISTS "storageGb",
  ADD COLUMN  "source" TEXT NOT NULL DEFAULT 'reborn';

CREATE INDEX "PhoneModel_source_idx" ON "PhoneModel"("source");

-- 3. New match-state enum and columns on OperatorCatalogItem.
DO $$ BEGIN
  CREATE TYPE "MatchStatus" AS ENUM ('UNMATCHED', 'MATCHED_AUTO', 'MATCHED_MANUAL', 'NEEDS_REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "OperatorCatalogItem"
  ADD COLUMN "parsedBrand"     TEXT,
  ADD COLUMN "parsedSeries"    TEXT,
  ADD COLUMN "parsedSlug"      TEXT,
  ADD COLUMN "matchStatus"     "MatchStatus" NOT NULL DEFAULT 'UNMATCHED',
  ADD COLUMN "matchConfidence" DOUBLE PRECISION,
  ADD COLUMN "matchedAt"       TIMESTAMP(3),
  ADD COLUMN "matchedBy"       TEXT;

CREATE INDEX "OperatorCatalogItem_matchStatus_idx" ON "OperatorCatalogItem"("matchStatus");
CREATE INDEX "OperatorCatalogItem_parsedSlug_idx"  ON "OperatorCatalogItem"("parsedSlug");

-- 4. Relax canonical FKs on operator rows.
ALTER TABLE "OperatorCatalogItem" DROP CONSTRAINT IF EXISTS "OperatorCatalogItem_phoneModelId_fkey";
ALTER TABLE "OperatorCatalogItem" ALTER COLUMN "phoneModelId" DROP NOT NULL;
ALTER TABLE "OperatorCatalogItem"
  ADD CONSTRAINT "OperatorCatalogItem_phoneModelId_fkey"
  FOREIGN KEY ("phoneModelId") REFERENCES "PhoneModel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OperatorOffer" DROP CONSTRAINT IF EXISTS "OperatorOffer_phoneModelId_fkey";
ALTER TABLE "OperatorOffer" ALTER COLUMN "phoneModelId" DROP NOT NULL;
ALTER TABLE "OperatorOffer"
  ADD CONSTRAINT "OperatorOffer_phoneModelId_fkey"
  FOREIGN KEY ("phoneModelId") REFERENCES "PhoneModel"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Parsed metadata on RebornProduct.
ALTER TABLE "RebornProduct"
  ADD COLUMN "storageGb" INTEGER,
  ADD COLUMN "color"     TEXT,
  ADD COLUMN "grade"     TEXT;

COMMIT;
