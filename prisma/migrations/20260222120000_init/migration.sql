-- CreateTable
CREATE TABLE "PhoneModel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "brand" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "storageGb" INTEGER,
    "slug" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OperatorOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phoneModelId" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "retailPriceEur" REAL,
    "monthlyEur" REAL,
    "contractLabel" TEXT,
    "tradeInAvailable" BOOLEAN,
    "productUrl" TEXT,
    "raw" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperatorOffer_phoneModelId_fkey" FOREIGN KEY ("phoneModelId") REFERENCES "PhoneModel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneModel_slug_key" ON "PhoneModel"("slug");

-- CreateIndex
CREATE INDEX "PhoneModel_brand_series_idx" ON "PhoneModel"("brand", "series");

-- CreateIndex
CREATE INDEX "OperatorOffer_operator_idx" ON "OperatorOffer"("operator");

-- CreateIndex
CREATE UNIQUE INDEX "OperatorOffer_phoneModelId_operator_key" ON "OperatorOffer"("phoneModelId", "operator");
