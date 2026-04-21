/**
 * Code Guide:
 * This API route owns the inngest backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { functions } from '@/lib/inngest/functions';

// Serve the Inngest API
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
