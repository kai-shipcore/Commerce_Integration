import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function getEbayInventoryItem(sku: string) {
  const token = process.env.EBAY_ACCESS_TOKEN;

  if (!token) {
    console.error("❌ No Access Token found. Run config.ts first!");
    return;
  }

  try {
    console.log(`🔍 Checking eBay for SKU: ${sku}...`);
    
    const response = await axios.get(
      `https://api.ebay.com/sell/inventory/v1/inventory_item/${sku}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Language': 'en-US',
          'Accept': 'application/json'
        }
      }
    );

    console.log("✅ SKU FOUND ON EBAY!");
    console.log("Current Quantity:", response.data.availability?.shipToLocationAvailability?.quantity);
    console.log("Product Title:", response.data.product?.title);

  } catch (error: any) {
    if (error.response?.status === 404) {
      console.warn(`⚠️ SKU "${sku}" does not exist on this eBay account yet.`);
      console.log("You may need to 'Create or Replace' the inventory item first.");
    } else {
      console.error("❌ API Error:", error.response?.data || error.message);
    }
  }
}

// Replace 'TEST-SKU-001' with a real SKU from your PostgreSQL ecommerce_data schema
getEbayInventoryItem('TEST-SKU-001');