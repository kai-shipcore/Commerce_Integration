import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function refreshAccessToken() {
  const appId = process.env.EBAY_APP_ID?.trim();
  const certId = process.env.EBAY_CERT_ID?.trim();
  const refreshToken = process.env.EBAY_REFRESH_TOKEN?.trim();

  if (!appId || !certId || !refreshToken) {
    console.error("Missing credentials in .env");
    return;
  }

  const authHeader = Buffer.from(`${appId}:${certId}`).toString('base64');

  try {
    const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', 
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${authHeader}`
        }
      });

    console.log("✅ ACCESS TOKEN REFRESHED");
    console.log(response.data.access_token);
    console.log("\nUpdate your EBAY_ACCESS_TOKEN in .env with the string above.");
  } catch (error: any) {
    console.error("Refresh failed:", error.response?.data || error.message);
  }
}

refreshAccessToken();