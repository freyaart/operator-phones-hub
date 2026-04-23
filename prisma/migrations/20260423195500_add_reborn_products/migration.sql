ALTER TABLE "PhoneModel"
ADD COLUMN "rebornProductId" INTEGER,
ADD COLUMN "rebornParentProductId" INTEGER,
ADD COLUMN "rebornPriceEur" DOUBLE PRECISION;

CREATE UNIQUE INDEX "PhoneModel_rebornProductId_key" ON "PhoneModel"("rebornProductId");
CREATE INDEX "PhoneModel_rebornParentProductId_idx" ON "PhoneModel"("rebornParentProductId");

CREATE TABLE "RebornProduct" (
    "id" TEXT NOT NULL,
    "phoneModelId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "parentProductId" INTEGER,
    "isParent" BOOLEAN NOT NULL DEFAULT false,
    "isMatched" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "optionText" TEXT,
    "sku" TEXT,
    "priceEur" DOUBLE PRECISION,
    "oldPriceEur" DOUBLE PRECISION,
    "conditionStatus" TEXT,
    "foxwayItemVariantId" TEXT,
    "purchaseStatus" BOOLEAN,
    "active" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RebornProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RebornProduct_productId_key" ON "RebornProduct"("productId");
CREATE INDEX "RebornProduct_phoneModelId_idx" ON "RebornProduct"("phoneModelId");
CREATE INDEX "RebornProduct_parentProductId_idx" ON "RebornProduct"("parentProductId");

ALTER TABLE "RebornProduct"
ADD CONSTRAINT "RebornProduct_phoneModelId_fkey"
FOREIGN KEY ("phoneModelId") REFERENCES "PhoneModel"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
