-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('UNKNOWN', 'IN_STOCK', 'OUT_OF_STOCK', 'PREORDER', 'DISCONTINUED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('RETAIL', 'CONTRACT', 'LOYALTY', 'OTHER');

-- CreateEnum
CREATE TYPE "ScrapeRunType" AS ENUM ('DISCOVER', 'SYNC');

-- CreateEnum
CREATE TYPE "ScrapeStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILURE');

-- AlterTable
ALTER TABLE "PhoneModel" ADD COLUMN     "marketingName" TEXT,
ADD COLUMN     "releaseYear" INTEGER;

-- DropTable
DROP TABLE "OperatorOffer";

-- CreateTable
CREATE TABLE "PhoneSpec" (
    "id" TEXT NOT NULL,
    "phoneModelId" TEXT NOT NULL,
    "market" TEXT,
    "releaseYear" INTEGER,
    "heightMm" DOUBLE PRECISION,
    "widthMm" DOUBLE PRECISION,
    "depthMm" DOUBLE PRECISION,
    "weightG" DOUBLE PRECISION,
    "displayDiagonalInch" DOUBLE PRECISION,
    "displayWidthPx" INTEGER,
    "displayHeightPx" INTEGER,
    "displayResolutionLabel" TEXT,
    "displayAspectRatio" TEXT,
    "displayPanelType" TEXT,
    "displayRefreshRateHz" INTEGER,
    "displayTouchSamplingHz" INTEGER,
    "displayPeakBrightnessNits" INTEGER,
    "displayHdr" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "displayProtection" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "displayAlwaysOn" BOOLEAN,
    "chipset" TEXT,
    "cpu" TEXT,
    "gpu" TEXT,
    "ramGb" INTEGER,
    "storageOptionsGb" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "storageType" TEXT,
    "simSlots" INTEGER,
    "esim" BOOLEAN,
    "usb" TEXT,
    "wifi" TEXT,
    "bluetooth" TEXT,
    "nfc" BOOLEAN,
    "uwb" BOOLEAN,
    "satellite" TEXT,
    "rearCameraSummary" TEXT,
    "frontCameraSummary" TEXT,
    "videoSummary" TEXT,
    "stereoSpeakers" BOOLEAN,
    "headphoneJack" BOOLEAN,
    "batteryCapacityMah" INTEGER,
    "wiredChargeW" INTEGER,
    "wirelessChargeW" INTEGER,
    "reverseWireless" BOOLEAN,
    "os" TEXT,
    "osVersionAtLaunch" TEXT,
    "updatePolicyYears" INTEGER,
    "cellular" TEXT,
    "fiveG" BOOLEAN,
    "fiveGBandsNote" TEXT,
    "frameMaterial" TEXT,
    "backMaterial" TEXT,
    "ipRating" TEXT,
    "colors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "faceBiometrics" BOOLEAN,
    "fingerprint" TEXT,
    "extras" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorCatalogItem" (
    "id" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "operatorItemKey" TEXT NOT NULL,
    "phoneModelId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "variantLabel" TEXT,
    "color" TEXT,
    "storageGb" INTEGER,
    "availability" "AvailabilityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatorOffer" (
    "id" TEXT NOT NULL,
    "phoneModelId" TEXT NOT NULL,
    "operatorCatalogItemId" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "offerKey" TEXT NOT NULL,
    "offerType" "OfferType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT,
    "retailPriceEur" DOUBLE PRECISION,
    "monthlyEur" DOUBLE PRECISION,
    "initialDepositEur" DOUBLE PRECISION,
    "contractMonths" INTEGER,
    "planLabel" TEXT,
    "tradeInAvailable" BOOLEAN,
    "availability" "AvailabilityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "productUrl" TEXT,
    "raw" JSONB,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "runType" "ScrapeRunType" NOT NULL,
    "status" "ScrapeStatus" NOT NULL DEFAULT 'RUNNING',
    "version" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "metadata" JSONB,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeArtifact" (
    "id" TEXT NOT NULL,
    "scrapeRunId" TEXT,
    "operator" TEXT NOT NULL,
    "phoneModelId" TEXT,
    "operatorCatalogItemId" TEXT,
    "artifactType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "contentType" TEXT,
    "contentText" TEXT,
    "checksum" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScrapeArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneSpec_phoneModelId_key" ON "PhoneSpec"("phoneModelId");

-- CreateIndex
CREATE INDEX "OperatorCatalogItem_operator_phoneModelId_idx" ON "OperatorCatalogItem"("operator", "phoneModelId");

-- CreateIndex
CREATE INDEX "OperatorCatalogItem_phoneModelId_idx" ON "OperatorCatalogItem"("phoneModelId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorCatalogItem_operator_operatorItemKey_key" ON "OperatorCatalogItem"("operator", "operatorItemKey");

-- CreateIndex
CREATE INDEX "ScrapeRun_operator_runType_startedAt_idx" ON "ScrapeRun"("operator", "runType", "startedAt");

-- CreateIndex
CREATE INDEX "ScrapeArtifact_operator_artifactType_createdAt_idx" ON "ScrapeArtifact"("operator", "artifactType", "createdAt");

-- CreateIndex
CREATE INDEX "ScrapeArtifact_phoneModelId_idx" ON "ScrapeArtifact"("phoneModelId");

-- CreateIndex
CREATE INDEX "ScrapeArtifact_operatorCatalogItemId_idx" ON "ScrapeArtifact"("operatorCatalogItemId");

-- CreateIndex
CREATE INDEX "OperatorOffer_phoneModelId_operator_idx" ON "OperatorOffer"("phoneModelId", "operator");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorOffer_operatorCatalogItemId_offerKey_key" ON "OperatorOffer"("operatorCatalogItemId", "offerKey");

-- AddForeignKey
ALTER TABLE "PhoneSpec" ADD CONSTRAINT "PhoneSpec_phoneModelId_fkey" FOREIGN KEY ("phoneModelId") REFERENCES "PhoneModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorCatalogItem" ADD CONSTRAINT "OperatorCatalogItem_phoneModelId_fkey" FOREIGN KEY ("phoneModelId") REFERENCES "PhoneModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorOffer" ADD CONSTRAINT "OperatorOffer_phoneModelId_fkey" FOREIGN KEY ("phoneModelId") REFERENCES "PhoneModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatorOffer" ADD CONSTRAINT "OperatorOffer_operatorCatalogItemId_fkey" FOREIGN KEY ("operatorCatalogItemId") REFERENCES "OperatorCatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeArtifact" ADD CONSTRAINT "ScrapeArtifact_scrapeRunId_fkey" FOREIGN KEY ("scrapeRunId") REFERENCES "ScrapeRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeArtifact" ADD CONSTRAINT "ScrapeArtifact_phoneModelId_fkey" FOREIGN KEY ("phoneModelId") REFERENCES "PhoneModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeArtifact" ADD CONSTRAINT "ScrapeArtifact_operatorCatalogItemId_fkey" FOREIGN KEY ("operatorCatalogItemId") REFERENCES "OperatorCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

