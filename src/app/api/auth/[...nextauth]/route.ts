/**
 * Code Guide:
 * This API route owns the auth / [...nextauth] backend workflow.
 * It validates request data, reads or writes database records, and returns JSON to the UI.
 * Cache invalidation and service calls usually happen here because this layer coordinates side effects.
 */

import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
