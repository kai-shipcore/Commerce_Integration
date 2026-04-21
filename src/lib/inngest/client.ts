/**
 * Code Guide:
 * Inngest configuration and background jobs.
 * These files define scheduled or event-driven tasks that run outside the request-response path.
 */

import { Inngest } from 'inngest';

// Create an Inngest client
export const inngest = new Inngest({
  id: "demand-pilot",
  name: "Demand Pilot",
});
