-- CreateTable
CREATE TABLE "SKU" (
    "id" TEXT NOT NULL,
    "skuCode" TEXT NOT NULL,
    "masterSkuCode" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "currentStock" INTEGER NOT NULL DEFAULT 0,
    "reorderPoint" INTEGER,
    "isCustomVariant" BOOLEAN NOT NULL DEFAULT false,
    "parentSKUId" TEXT,
    "imageUrl" TEXT,
    "tags" TEXT[],
    "unitCost" DECIMAL(10,2),
    "retailPrice" DECIMAL(10,2),
    "shopifyProductId" TEXT,
    "amazonASIN" TEXT,
    "walmartItemId" TEXT,
    "ebayItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SKU_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SKUCollection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "colorCode" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SKUCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SKUCollectionMember" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SKUCollectionMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesRecord" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderType" TEXT NOT NULL DEFAULT 'actual_sale',
    "saleDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "masterSkuCode" TEXT,
    "fulfilled" BOOLEAN NOT NULL DEFAULT false,
    "fulfilledDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventorySnapshot" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "isStockout" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Forecast" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "forecastDate" TIMESTAMP(3) NOT NULL,
    "periodType" TEXT NOT NULL,
    "predictedQuantity" INTEGER NOT NULL,
    "confidenceLow" INTEGER,
    "confidenceHigh" INTEGER,
    "calculationMode" TEXT NOT NULL,
    "dateRangeStart" TIMESTAMP(3),
    "dateRangeEnd" TIMESTAMP(3),
    "adjustmentPercentage" DECIMAL(5,2),
    "isManualOverride" BOOLEAN NOT NULL DEFAULT false,
    "modelVersion" TEXT,
    "modelAccuracy" DECIMAL(5,4),
    "baseForecast" INTEGER,
    "trendAdjustment" DECIMAL(5,2),
    "trendConfidence" DECIMAL(5,2),
    "aiReasoning" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "Forecast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendData" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "researchDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "googleTrendsChange" DECIMAL(5,2),
    "googleTrendsConfidence" DECIMAL(5,2),
    "googleTrendsRaw" JSONB,
    "competitorStockChange" DECIMAL(5,2),
    "competitorPriceChange" DECIMAL(5,2),
    "competitorConfidence" DECIMAL(5,2),
    "competitorRaw" JSONB,
    "amazonBSRChange" DECIMAL(5,2),
    "amazonReviewVelocity" DECIMAL(5,2),
    "amazonConfidence" DECIMAL(5,2),
    "amazonRaw" JSONB,
    "socialMentionsChange" DECIMAL(5,2),
    "socialConfidence" DECIMAL(5,2),
    "socialRaw" JSONB,
    "aiTrendDirection" TEXT,
    "aiConfidence" DECIMAL(5,2),
    "aiSuggestedAdjustment" DECIMAL(5,2),
    "aiReasoning" TEXT,
    "aiAnalysisRaw" JSONB,
    "combinedSignal" DECIMAL(5,2),
    "combinedConfidence" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrendData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrendWeightConfig" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "skuId" TEXT,
    "historicalDataWeight" INTEGER NOT NULL DEFAULT 65,
    "googleTrendsWeight" INTEGER NOT NULL DEFAULT 15,
    "competitorWeight" INTEGER NOT NULL DEFAULT 10,
    "aiSynthesisWeight" INTEGER NOT NULL DEFAULT 10,
    "minimumConfidence" DECIMAL(5,2) NOT NULL DEFAULT 50.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrendWeightConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "supplier" TEXT,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "expectedDeliveryDate" TIMESTAMP(3),
    "actualDeliveryDate" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "POItem" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(10,2),
    "totalCost" DECIMAL(12,2),

    CONSTRAINT "POItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Container" (
    "id" TEXT NOT NULL,
    "containerNumber" TEXT NOT NULL,
    "poId" TEXT,
    "bookingDate" TIMESTAMP(3),
    "departureDate" TIMESTAMP(3),
    "estimatedArrivalDate" TIMESTAMP(3),
    "actualArrivalDate" TIMESTAMP(3),
    "estimatedReleaseDate" TIMESTAMP(3),
    "actualReleaseDate" TIMESTAMP(3),
    "carrier" TEXT,
    "vesselName" TEXT,
    "portOfLoading" TEXT,
    "portOfDischarge" TEXT,
    "status" TEXT NOT NULL,
    "trackingUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Container_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "PlatformIntegration" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL,
    "syncCursor" JSONB,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "totalOrdersSynced" INTEGER NOT NULL DEFAULT 0,
    "totalRecordsSynced" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SKU_skuCode_key" ON "SKU"("skuCode");

-- CreateIndex
CREATE INDEX "SKU_skuCode_idx" ON "SKU"("skuCode");

-- CreateIndex
CREATE INDEX "SKU_masterSkuCode_idx" ON "SKU"("masterSkuCode");

-- CreateIndex
CREATE INDEX "SKU_parentSKUId_idx" ON "SKU"("parentSKUId");

-- CreateIndex
CREATE INDEX "SKU_category_idx" ON "SKU"("category");

-- CreateIndex
CREATE INDEX "SKU_isCustomVariant_idx" ON "SKU"("isCustomVariant");

-- CreateIndex
CREATE INDEX "SKUCollection_name_idx" ON "SKUCollection"("name");

-- CreateIndex
CREATE INDEX "SKUCollectionMember_collectionId_idx" ON "SKUCollectionMember"("collectionId");

-- CreateIndex
CREATE INDEX "SKUCollectionMember_skuId_idx" ON "SKUCollectionMember"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "SKUCollectionMember_collectionId_skuId_key" ON "SKUCollectionMember"("collectionId", "skuId");

-- CreateIndex
CREATE INDEX "SalesRecord_skuId_saleDate_idx" ON "SalesRecord"("skuId", "saleDate");

-- CreateIndex
CREATE INDEX "SalesRecord_saleDate_idx" ON "SalesRecord"("saleDate");

-- CreateIndex
CREATE INDEX "SalesRecord_platform_idx" ON "SalesRecord"("platform");

-- CreateIndex
CREATE INDEX "SalesRecord_orderType_idx" ON "SalesRecord"("orderType");

-- CreateIndex
CREATE INDEX "SalesRecord_masterSkuCode_idx" ON "SalesRecord"("masterSkuCode");

-- CreateIndex
CREATE INDEX "InventorySnapshot_skuId_snapshotDate_idx" ON "InventorySnapshot"("skuId", "snapshotDate");

-- CreateIndex
CREATE INDEX "InventorySnapshot_isStockout_idx" ON "InventorySnapshot"("isStockout");

-- CreateIndex
CREATE UNIQUE INDEX "InventorySnapshot_skuId_snapshotDate_key" ON "InventorySnapshot"("skuId", "snapshotDate");

-- CreateIndex
CREATE INDEX "Forecast_skuId_forecastDate_idx" ON "Forecast"("skuId", "forecastDate");

-- CreateIndex
CREATE INDEX "Forecast_createdAt_idx" ON "Forecast"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Forecast_skuId_forecastDate_periodType_key" ON "Forecast"("skuId", "forecastDate", "periodType");

-- CreateIndex
CREATE INDEX "TrendData_skuId_validUntil_idx" ON "TrendData"("skuId", "validUntil");

-- CreateIndex
CREATE INDEX "TrendData_researchDate_idx" ON "TrendData"("researchDate");

-- CreateIndex
CREATE UNIQUE INDEX "TrendData_skuId_researchDate_key" ON "TrendData"("skuId", "researchDate");

-- CreateIndex
CREATE INDEX "TrendWeightConfig_skuId_idx" ON "TrendWeightConfig"("skuId");

-- CreateIndex
CREATE INDEX "TrendWeightConfig_isDefault_idx" ON "TrendWeightConfig"("isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_poNumber_key" ON "PurchaseOrder"("poNumber");

-- CreateIndex
CREATE INDEX "PurchaseOrder_status_idx" ON "PurchaseOrder"("status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_orderDate_idx" ON "PurchaseOrder"("orderDate");

-- CreateIndex
CREATE INDEX "POItem_poId_idx" ON "POItem"("poId");

-- CreateIndex
CREATE INDEX "POItem_skuId_idx" ON "POItem"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "Container_containerNumber_key" ON "Container"("containerNumber");

-- CreateIndex
CREATE INDEX "Container_status_idx" ON "Container"("status");

-- CreateIndex
CREATE INDEX "Container_poId_idx" ON "Container"("poId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "PlatformIntegration_platform_idx" ON "PlatformIntegration"("platform");

-- CreateIndex
CREATE INDEX "PlatformIntegration_isActive_idx" ON "PlatformIntegration"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformIntegration_platform_name_key" ON "PlatformIntegration"("platform", "name");

-- AddForeignKey
ALTER TABLE "SKU" ADD CONSTRAINT "SKU_parentSKUId_fkey" FOREIGN KEY ("parentSKUId") REFERENCES "SKU"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SKUCollectionMember" ADD CONSTRAINT "SKUCollectionMember_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "SKUCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SKUCollectionMember" ADD CONSTRAINT "SKUCollectionMember_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SKU"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesRecord" ADD CONSTRAINT "SalesRecord_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SKU"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventorySnapshot" ADD CONSTRAINT "InventorySnapshot_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SKU"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Forecast" ADD CONSTRAINT "Forecast_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SKU"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrendData" ADD CONSTRAINT "TrendData_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SKU"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POItem" ADD CONSTRAINT "POItem_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "POItem" ADD CONSTRAINT "POItem_skuId_fkey" FOREIGN KEY ("skuId") REFERENCES "SKU"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Container" ADD CONSTRAINT "Container_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
