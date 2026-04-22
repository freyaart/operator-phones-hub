-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "PhoneModel" (
    "id" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "storageGb" INTEGER,
    "slug" TEXT NOT NULL,
    "specs" JSONB,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorOffer" (
    "id" TEXT NOT NULL,
    "phoneModelId" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "retailPriceEur" DOUBLE PRECISION,
    "monthlyEur" DOUBLE PRECISION,
    "contractLabel" TEXT,
    "tradeInAvailable" BOOLEAN,
    "productUrl" TEXT,
    "raw" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneModel_slug_key" ON "PhoneModel"("slug");

-- CreateIndex
CREATE INDEX "PhoneModel_brand_series_idx" ON "PhoneModel"("brand", "series");

-- CreateIndex
CREATE INDEX "OperatorOffer_operator_idx" ON "OperatorOffer"("operator");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorOffer_phoneModelId_operator_key" ON "OperatorOffer"("phoneModelId", "operator");

-- AddForeignKey
ALTER TABLE "OperatorOffer" ADD CONSTRAINT "OperatorOffer_phoneModelId_fkey" FOREIGN KEY ("phoneModelId") REFERENCES "PhoneModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

