/**
 * Code Guide:
 * Inngest configuration and background jobs.
 * These files define scheduled or event-driven tasks that run outside the request-response path.
 */

import { inngest } from './client';
import { identifyHotSKUs } from '../analytics/hot-skus';
import { CacheManager, CacheKeys, CacheTTL } from '../redis';
import {
  getPlatformIntegrationById,
  listActivePlatformIntegrations,
  updatePlatformIntegration,
} from '../db/platform-integrations';

/**
 * Sync sales data from all active platform integrations
 * Runs every hour
 */
export const syncSalesData = inngest.createFunction(
  {
    id: 'sync-sales-data',
    name: 'Sync Sales Data',
  },
  { cron: '0 * * * *' }, // Every hour
  async ({ event, step }) => {
    const { syncShopifyOrders } = await import('@/lib/integrations/shopify');

    // Step 1: Get all active integrations
    const integrations = await step.run('get-active-integrations', async () => {
      return await listActivePlatformIntegrations();
    });

    if (integrations.length === 0) {
      return {
        success: true,
        message: 'No active integrations configured',
        integrations: 0,
      };
    }

    console.log(`Syncing ${integrations.length} active integrations`);

    // Each integration is handled independently so one storefront failure does
    // not hide the result for the others.
    const results: {
      integrationId: string;
      platform: string;
      name: string;
      success: boolean;
      ordersProcessed: number;
      recordsCreated: number;
      skusCreated: number;
      error?: string;
    }[] = [];

    for (const integration of integrations) {
      const result = await step.run(
        `sync-${integration.platform}-${integration.id}`,
        async () => {
          try {
            if (integration.platform === 'shopify') {
              const syncResult = await syncShopifyOrders(integration.id);

              // Update integration stats
              if (syncResult.success) {
                await updatePlatformIntegration(integration.id, {
                  lastSyncStatus: 'success',
                  lastSyncError: null,
                  incrementTotalOrdersSynced: syncResult.ordersProcessed,
                  incrementTotalRecordsSynced: syncResult.salesRecordsCreated,
                });
              } else {
                await updatePlatformIntegration(integration.id, {
                  lastSyncStatus: 'failed',
                  lastSyncError: syncResult.errors.join('; '),
                });
              }

              return {
                integrationId: integration.id,
                platform: integration.platform,
                name: integration.name,
                success: syncResult.success,
                ordersProcessed: syncResult.ordersProcessed,
                recordsCreated: syncResult.salesRecordsCreated,
                skusCreated: syncResult.skusCreated,
                error: syncResult.errors.length > 0 ? syncResult.errors[0] : undefined,
              };
            }

            // Placeholder for other platforms
            return {
              integrationId: integration.id,
              platform: integration.platform,
              name: integration.name,
              success: false,
              ordersProcessed: 0,
              recordsCreated: 0,
              skusCreated: 0,
              error: `Platform ${integration.platform} sync not implemented`,
            };
          } catch (error: any) {
            console.error(`Error syncing ${integration.platform}:`, error);

            await updatePlatformIntegration(integration.id, {
              lastSyncStatus: 'failed',
              lastSyncError: error.message,
            });

            return {
              integrationId: integration.id,
              platform: integration.platform,
              name: integration.name,
              success: false,
              ordersProcessed: 0,
              recordsCreated: 0,
              skusCreated: 0,
              error: error.message,
            };
          }
        }
      );

      results.push(result);
    }

    // Invalidate dashboard cache after sync
    await step.run('invalidate-cache', async () => {
      await CacheManager.delete('dashboard:analytics');
    });

    const successCount = results.filter((r) => r.success).length;
    const totalOrders = results.reduce((sum, r) => sum + r.ordersProcessed, 0);
    const totalRecords = results.reduce((sum, r) => sum + r.recordsCreated, 0);

    return {
      success: successCount === results.length,
      integrations: results.length,
      successfulSyncs: successCount,
      totalOrdersProcessed: totalOrders,
      totalRecordsCreated: totalRecords,
      results,
    };
  }
);

/**
 * Refresh cache for frequently accessed SKUs
 * Runs every 6 hours
 */
export const refreshHotSKUCache = inngest.createFunction(
  {
    id: 'refresh-hot-sku-cache',
    name: 'Refresh Hot SKU Cache',
  },
  { cron: '0 */6 * * *' }, // Every 6 hours
  async ({ event, step }) => {
    const hotSKUs = await step.run('identify-and-cache-hot-skus', async () => {
      const skus = await identifyHotSKUs(100);

      // Cache the hot SKUs list
      await CacheManager.set(CacheKeys.hotSKUs(), skus, CacheTTL.HOT_SKUS);

      return skus;
    });

    return {
      success: true,
      cachedSKUs: hotSKUs.length,
    };
  }
);

/**
 * Manual trigger to sync a specific integration
 */
export const manualSyncTrigger = inngest.createFunction(
  {
    id: 'manual-sync-trigger',
    name: 'Manual Sync Trigger',
  },
  { event: 'app/sync.trigger' },
  async ({ event, step }) => {
    const { integrationId, fullSync = false } = event.data;

    if (!integrationId) {
      throw new Error('No integration ID provided');
    }

    const { syncShopifyOrders } = await import('@/lib/integrations/shopify');

    // Get integration details
    const integration = await step.run('get-integration', async () => {
      return await getPlatformIntegrationById(integrationId);
    });

    if (!integration) {
      throw new Error('Integration not found');
    }

    console.log(`Manual sync triggered for ${integration.platform}: ${integration.name}`);

    // Perform sync
    const result = await step.run('sync-integration', async () => {
      if (integration.platform === 'shopify') {
        return await syncShopifyOrders(integrationId, { fullSync });
      }
      throw new Error(`Platform ${integration.platform} sync not implemented`);
    });

    // Update integration stats
    await step.run('update-stats', async () => {
      if (result.success) {
        await updatePlatformIntegration(integrationId, {
          lastSyncStatus: 'success',
          lastSyncError: null,
          incrementTotalOrdersSynced: result.ordersProcessed,
          incrementTotalRecordsSynced: result.salesRecordsCreated,
        });
      } else {
        await updatePlatformIntegration(integrationId, {
          lastSyncStatus: 'failed',
          lastSyncError: result.errors.join('; '),
        });
      }
    });

    // Invalidate cache
    await step.run('invalidate-cache', async () => {
      await CacheManager.delete('dashboard:analytics');
    });

    return {
      success: result.success,
      integrationId,
      platform: integration.platform,
      name: integration.name,
      ordersProcessed: result.ordersProcessed,
      recordsCreated: result.salesRecordsCreated,
      skusCreated: result.skusCreated,
      errors: result.errors,
    };
  }
);

// Export all functions
export const functions = [
  syncSalesData,
  refreshHotSKUCache,
  manualSyncTrigger,
];
