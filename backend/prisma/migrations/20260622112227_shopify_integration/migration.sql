-- AlterTable
ALTER TABLE "SalesChannel" ADD COLUMN     "externalRef" TEXT;

-- CreateTable
CREATE TABLE "ChannelSkuMapping" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "skuId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelSkuMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelSkuMapping_skuId_idx" ON "ChannelSkuMapping"("skuId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSkuMapping_channelId_skuId_key" ON "ChannelSkuMapping"("channelId", "skuId");

-- CreateIndex
CREATE INDEX "SalesChannel_externalRef_idx" ON "SalesChannel"("externalRef");

-- AddForeignKey
ALTER TABLE "ChannelSkuMapping" ADD CONSTRAINT "ChannelSkuMapping_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "SalesChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
