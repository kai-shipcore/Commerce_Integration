/**
 * Code Guide:
 * Database seed script for local development.
 * It creates sample users, SKUs, sales, and related records so the UI has realistic data to display.
 */

import 'dotenv/config';
import prisma from '../src/lib/prisma';

async function main() {
  console.log('🌱 Starting seed...');

  // Reset sample data first so repeated local seed runs stay predictable.
  // Clean existing data (optional - comment out if you want to keep existing data)
  console.log('🧹 Cleaning existing data...');
  await prisma.salesRecord.deleteMany();
  await prisma.inventorySnapshot.deleteMany();
  await prisma.trendData.deleteMany();
  await prisma.sKUCollectionMember.deleteMany();
  await prisma.sKUCollection.deleteMany();
  await prisma.pOItem.deleteMany();
  await prisma.container.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.sKU.deleteMany();

  // Create Master SKUs
  console.log('📦 Creating Master SKUs...');

  const masterSKUs = await Promise.all([
    prisma.sKU.create({
      data: {
        skuCode: 'WIDGET-001',
        name: 'Premium Widget',
        description: 'High-quality widget for professional use',
        category: 'Electronics',
        currentStock: 250,
        reorderPoint: 50,
        unitCost: 12.50,
        retailPrice: 29.99,
        imageUrl: 'https://placeholder.com/widget-001.jpg',
        tags: ['premium', 'bestseller', 'electronics'],
        shopifyProductId: 'gid://shopify/Product/1234567890',
      },
    }),
    prisma.sKU.create({
      data: {
        skuCode: 'GADGET-002',
        name: 'Smart Gadget',
        description: 'IoT-enabled smart gadget',
        category: 'Smart Home',
        currentStock: 180,
        reorderPoint: 40,
        unitCost: 25.00,
        retailPrice: 59.99,
        tags: ['smart', 'iot', 'tech'],
        amazonASIN: 'B08XYZ1234',
      },
    }),
    prisma.sKU.create({
      data: {
        skuCode: 'TOOL-003',
        name: 'Professional Tool Set',
        description: 'Complete tool set for professionals',
        category: 'Tools',
        currentStock: 120,
        reorderPoint: 30,
        unitCost: 45.00,
        retailPrice: 99.99,
        tags: ['tools', 'professional'],
      },
    }),
    prisma.sKU.create({
      data: {
        skuCode: 'ACCESSORY-004',
        name: 'Universal Accessory Pack',
        description: 'Compatible with multiple devices',
        category: 'Accessories',
        currentStock: 450,
        reorderPoint: 100,
        unitCost: 5.00,
        retailPrice: 14.99,
        tags: ['accessory', 'universal'],
      },
    }),
    prisma.sKU.create({
      data: {
        skuCode: 'CABLE-005',
        name: 'USB-C Cable 6ft',
        description: 'High-speed USB-C cable',
        category: 'Cables',
        currentStock: 800,
        reorderPoint: 200,
        unitCost: 3.00,
        retailPrice: 9.99,
        tags: ['cable', 'usb-c', 'fast-charge'],
      },
    }),
  ]);

  console.log(`✅ Created ${masterSKUs.length} Master SKUs`);

  // Create Custom Variants for first SKU
  console.log('🎨 Creating Custom Variants...');

  const customVariants = await Promise.all([
    prisma.sKU.create({
      data: {
        skuCode: 'WIDGET-001-RED',
        name: 'Premium Widget - Red Edition',
        description: 'Premium Widget in exclusive red color',
        category: 'Electronics',
        currentStock: 80,
        reorderPoint: 20,
        unitCost: 13.50,
        retailPrice: 34.99,
        isCustomVariant: true,
        parentSKUId: masterSKUs[0].id,
        tags: ['premium', 'red', 'limited-edition'],
      },
    }),
    prisma.sKU.create({
      data: {
        skuCode: 'WIDGET-001-BLUE',
        name: 'Premium Widget - Blue Edition',
        description: 'Premium Widget in exclusive blue color',
        category: 'Electronics',
        currentStock: 65,
        reorderPoint: 20,
        unitCost: 13.50,
        retailPrice: 34.99,
        isCustomVariant: true,
        parentSKUId: masterSKUs[0].id,
        tags: ['premium', 'blue', 'limited-edition'],
      },
    }),
  ]);

  console.log(`✅ Created ${customVariants.length} Custom Variants`);

  // Create SKU Collections
  console.log('📚 Creating SKU Collections...');

  const collection1 = await prisma.sKUCollection.create({
    data: {
      name: 'Best Sellers',
      description: 'Our top-selling products',
      colorCode: '#10b981',
      isPinned: true,
      sortOrder: 1,
    },
  });

  const collection2 = await prisma.sKUCollection.create({
    data: {
      name: 'Electronics Bundle',
      description: 'Popular electronics items',
      colorCode: '#3b82f6',
      isPinned: false,
      sortOrder: 2,
    },
  });

  // Add SKUs to collections
  await Promise.all([
    prisma.sKUCollectionMember.create({
      data: {
        collectionId: collection1.id,
        skuId: masterSKUs[0].id,
        sortOrder: 1,
      },
    }),
    prisma.sKUCollectionMember.create({
      data: {
        collectionId: collection1.id,
        skuId: masterSKUs[4].id,
        sortOrder: 2,
      },
    }),
    prisma.sKUCollectionMember.create({
      data: {
        collectionId: collection2.id,
        skuId: masterSKUs[0].id,
        sortOrder: 1,
      },
    }),
    prisma.sKUCollectionMember.create({
      data: {
        collectionId: collection2.id,
        skuId: masterSKUs[1].id,
        sortOrder: 2,
      },
    }),
  ]);

  console.log('✅ Created 2 Collections with members');

  // Generate enough fake history for dashboards to look useful
  // in a fresh local database.
  // Create Sales Records (last 90 days)
  console.log('💰 Creating Sales Records...');

  const salesRecords = [];
  const today = new Date();

  for (let i = 0; i < 90; i++) {
    const saleDate = new Date(today);
    saleDate.setDate(saleDate.getDate() - i);

    // Create 3-8 sales per day for each SKU
    for (const sku of masterSKUs) {
      const dailySales = Math.floor(Math.random() * 6) + 3;

      for (let j = 0; j < dailySales; j++) {
        const quantity = Math.floor(Math.random() * 3) + 1;
        const unitPrice = Number(sku.retailPrice);

        salesRecords.push({
          skuId: sku.id,
          platform: ['shopify', 'walmart', 'amazon', 'ebay'][Math.floor(Math.random() * 4)],
          orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          orderType: Math.random() > 0.9 ? 'pre_order' : 'actual_sale',
          saleDate: saleDate,
          quantity: quantity,
          unitPrice: unitPrice,
          totalAmount: unitPrice * quantity,
          fulfilled: Math.random() > 0.2,
          fulfilledDate: Math.random() > 0.2 ? new Date(saleDate.getTime() + 86400000) : null,
        });
      }
    }
  }

  // Insert sales in chunks to avoid building one oversized database write.
  const batchSize = 100;
  for (let i = 0; i < salesRecords.length; i += batchSize) {
    const batch = salesRecords.slice(i, i + batchSize);
    await prisma.salesRecord.createMany({ data: batch });
  }

  console.log(`✅ Created ${salesRecords.length} Sales Records`);

  // Create Inventory Snapshots (last 30 days)
  console.log('📊 Creating Inventory Snapshots...');

  const snapshots = [];
  for (let i = 0; i < 30; i++) {
    const snapshotDate = new Date(today);
    snapshotDate.setDate(snapshotDate.getDate() - i);

    for (const sku of [...masterSKUs, ...customVariants]) {
      const variance = Math.floor(Math.random() * 40) - 20;
      const quantity = Math.max(0, sku.currentStock + variance);

      snapshots.push({
        skuId: sku.id,
        snapshotDate: snapshotDate,
        quantity: quantity,
        isStockout: quantity === 0,
      });
    }
  }

  await prisma.inventorySnapshot.createMany({ data: snapshots });
  console.log(`✅ Created ${snapshots.length} Inventory Snapshots`);

  // Create Purchase Order
  console.log('📋 Creating Purchase Orders...');

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: 'PO-2024-001',
      supplier: 'Global Widgets Inc.',
      orderDate: new Date('2024-11-01'),
      expectedDeliveryDate: new Date('2024-12-15'),
      status: 'in_transit',
      totalAmount: 15000.00,
      notes: 'Holiday season inventory',
    },
  });

  // Create PO Items
  await Promise.all([
    prisma.pOItem.create({
      data: {
        poId: po.id,
        skuId: masterSKUs[0].id,
        quantity: 500,
        unitCost: 12.50,
        totalCost: 6250.00,
      },
    }),
    prisma.pOItem.create({
      data: {
        poId: po.id,
        skuId: masterSKUs[1].id,
        quantity: 300,
        unitCost: 25.00,
        totalCost: 7500.00,
      },
    }),
  ]);

  console.log('✅ Created Purchase Order with items');

  // Create Container
  console.log('🚢 Creating Container...');

  await prisma.container.create({
    data: {
      containerNumber: 'CONT-2024-ABC123',
      poId: po.id,
      bookingDate: new Date('2024-11-01'),
      departureDate: new Date('2024-11-10'),
      estimatedArrivalDate: new Date('2024-12-15'),
      carrier: 'Pacific Shipping Lines',
      vesselName: 'MV Ocean Voyager',
      portOfLoading: 'Shanghai, China',
      portOfDischarge: 'Los Angeles, USA',
      status: 'in_transit',
      trackingUrl: 'https://tracking.example.com/CONT-2024-ABC123',
    },
  });

  console.log('✅ Created Container');

  // Create Sample Trend Data
  console.log('📈 Creating Trend Data...');

  const trendDate = new Date();
  const validUntil = new Date(trendDate);
  validUntil.setDate(validUntil.getDate() + 7);

  await prisma.trendData.create({
    data: {
      skuId: masterSKUs[0].id,
      researchDate: trendDate,
      validUntil: validUntil,
      googleTrendsChange: 15.5,
      googleTrendsConfidence: 85.0,
      competitorStockChange: -5.0,
      competitorConfidence: 70.0,
      amazonBSRChange: 12.0,
      amazonConfidence: 80.0,
      socialMentionsChange: 25.0,
      socialConfidence: 65.0,
      aiTrendDirection: 'up',
      aiConfidence: 78.0,
      aiSuggestedAdjustment: 10.0,
      aiReasoning: 'Strong upward trend in social media mentions and improving Amazon BSR. Competitor stock levels decreasing suggests high demand.',
      combinedSignal: 12.5,
      combinedConfidence: 77.0,
    },
  });

  console.log('✅ Created Trend Data');

  // Create Default Trend Weight Config
  console.log('⚙️  Creating Trend Weight Config...');

  await prisma.trendWeightConfig.create({
    data: {
      name: 'Default',
      isDefault: true,
      historicalDataWeight: 65,
      googleTrendsWeight: 15,
      competitorWeight: 10,
      aiSynthesisWeight: 10,
      minimumConfidence: 50.0,
    },
  });

  console.log('✅ Created Default Trend Weight Config');

  console.log('\n🎉 Seed completed successfully!');
  console.log('\n📊 Summary:');
  console.log(`   - ${masterSKUs.length} Master SKUs`);
  console.log(`   - ${customVariants.length} Custom Variants`);
  console.log(`   - 2 Collections`);
  console.log(`   - ${salesRecords.length} Sales Records (90 days)`);
  console.log(`   - ${snapshots.length} Inventory Snapshots (30 days)`);
  console.log(`   - 1 Purchase Order with items`);
  console.log(`   - 1 Container`);
  console.log(`   - 1 Trend Data record`);
  console.log(`   - 1 Trend Weight Config`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
