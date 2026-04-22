import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * ShipCore - eBay API Client Service
 * Handles automatic token refreshing so you don't have to manually update .env
 */
export class EbayClient {
  private appId = (process.env.EBAY_APP_ID || '').trim();
  private certId = (process.env.EBAY_CERT_ID || '').trim();
  private refreshToken = (process.env.EBAY_REFRESH_TOKEN || '').trim();
  private accessToken = (process.env.EBAY_ACCESS_TOKEN || '').trim();

  /**
   * Refreshes the Access Token using the 18-month Refresh Token
   */
  private async refresh() {
    const authHeader = Buffer.from(`${this.appId}:${this.certId}`).toString('base64');

    try {
      const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', 
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.refreshToken
        }), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${authHeader}`
          }
        });

      this.accessToken = response.data.access_token;
      // Optional: Log this so you can update .env for other tools if needed
      console.log("🔄 eBay Access Token auto-refreshed.");
      return this.accessToken;
    } catch (error: any) {
      console.error("❌ Critical: Could not refresh eBay token", error.response?.data || error.message);
      throw new Error("eBay Auth Failure");
    }
  }

  /**
   * Generic Request Wrapper
   * Automatically handles 401 Unauthorized by refreshing the token once
   */
  public async request(method: 'GET' | 'POST' | 'PUT', endpoint: string, data?: any) {
    const execute = async (token: string) => {
      // Change the base URL to 'fulfillment' instead of 'inventory'
      const baseUrl = `https://api.ebay.com/sell/fulfillment/v1`; 
      return axios({
        method,
        url: `${baseUrl}${endpoint}`,
        data,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
    };

    try {
      return await execute(this.accessToken);
    } catch (error: any) {
      // If 401 (Expired), refresh and try one more time
      if (error.response?.status === 401) {
        const newToken = await this.refresh();
        return await execute(newToken);
      }
      throw error;
    }
  }
}

// --- Example Usage for ShipCore ---

const ebay = new EbayClient();

async function testConnection() {
  try {
    // Example: Fetching a real SKU from your snapshot
    const sku = "YOUR_REAL_SKU_HERE"; 
    const response = await ebay.request('GET', `/inventory_item/${sku}`);
    console.log("✅ Success! Inventory data:", response.data);
  } catch (err: any) {
    if (err.response?.status === 404) {
      console.log("⚠️ Connection works, but SKU was not found on eBay.");
    } else {
      console.error("❌ Request failed:", err.message);
    }
  }
}
