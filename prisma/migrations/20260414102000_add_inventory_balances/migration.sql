CREATE TABLE "InventoryLocation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "onHandQty" INTEGER NOT NULL DEFAULT 0,
    "reservedQty" INTEGER NOT NULL DEFAULT 0,
    "allocatedQty" INTEGER NOT NULL DEFAULT 0,
    "backorderQty" INTEGER NOT NULL DEFAULT 0,
    "inboundQty" INTEGER NOT NULL DEFAULT 0,
    "availableQty" INTEGER NOT NULL DEFAULT 0,
    "lastCountedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "transactionType" TEXT NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "notes" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryLocation_code_key" ON "InventoryLocation"("code");
CREATE INDEX "InventoryLocation_code_idx" ON "InventoryLocation"("code");
CREATE INDEX "InventoryLocation_isDefault_idx" ON "InventoryLocation"("isDefault");
CREATE INDEX "InventoryLocation_isActive_idx" ON "InventoryLocation"("isActive");

CREATE UNIQUE INDEX "InventoryBalance_skuId_locationId_key" ON "InventoryBalance"("skuId", "locationId");
CREATE INDEX "InventoryBalance_locationId_idx" ON "InventoryBalance"("locationId");
CREATE INDEX "InventoryBalance_availableQty_idx" ON "InventoryBalance"("availableQty");
CREATE INDEX "InventoryBalance_backorderQty_idx" ON "InventoryBalance"("backorderQty");

CREATE INDEX "InventoryTransaction_skuId_effectiveAt_idx" ON "InventoryTransaction"("skuId", "effectiveAt");
CREATE INDEX "InventoryTransaction_locationId_effectiveAt_idx" ON "InventoryTransaction"("locationId", "effectiveAt");
CREATE INDEX "InventoryTransaction_transactionType_idx" ON "InventoryTransaction"("transactionType");
CREATE INDEX "InventoryTransaction_referenceType_referenceId_idx" ON "InventoryTransaction"("referenceType", "referenceId");

ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_skuId_fkey"
    FOREIGN KEY ("skuId") REFERENCES "SKU"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_skuId_fkey"
    FOREIGN KEY ("skuId") REFERENCES "SKU"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "InventoryLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "InventoryLocation" ("id", "code", "name", "description", "isDefault", "isActive", "updatedAt")
VALUES (
    'default-location',
    'DEFAULT',
    'Default Warehouse',
    'Initial default inventory location created during inventory balance migration.',
    true,
    true,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "InventoryBalance" (
    "id",
    "skuId",
    "locationId",
    "onHandQty",
    "reservedQty",
    "allocatedQty",
    "backorderQty",
    "inboundQty",
    "availableQty",
    "createdAt",
    "updatedAt"
)
SELECT
    'bal_' || "id",
    "id",
    'default-location',
    "currentStock",
    0,
    0,
    0,
    0,
    "currentStock",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "SKU"
ON CONFLICT ("skuId", "locationId") DO NOTHING;
