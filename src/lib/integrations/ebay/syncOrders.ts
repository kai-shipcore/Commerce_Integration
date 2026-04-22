import { EbayClient } from './ebayClient';
import dotenv from 'dotenv';

dotenv.config();

const ebay = new EbayClient();

async function fetchEbayOrders() {
  try {
    console.log("📦 Fetching recent paid orders from eBay...");

    /**
     * filter=orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS} 
     * This gets orders that haven't been shipped yet.
     */
    const response = await ebay.request('GET', '/order?filter=orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}');

    const orders = response.data.orders || [];

    if (orders.length === 0) {
      console.log("✅ No new orders to sync.");
      return;
    }

    console.log(`\n🚀 Found ${orders.length} orders:`);

    orders.forEach((order: any) => {
      console.log("-------------------------------------------");
      console.log(`Order ID: ${order.orderId}`);
      console.log(`Buyer:    ${order.buyer.username}`);
      console.log(`Total:    ${order.totalFeeBasisAmount.value} ${order.totalFeeBasisAmount.currency}`);
      
      // Pulling the SKUs from the order line items
      order.lineItems.forEach((item: any) => {
        console.log(`  - SKU: ${item.sku} | Qty: ${item.quantity}`);
      });
    });

    // NEXT STEP: Insert these into your shipcore.orders table
    // await saveToDatabase(orders);

  } catch (error: any) {
    console.error("❌ Failed to sync orders:", error.response?.data || error.message);
  }
}

fetchEbayOrders();