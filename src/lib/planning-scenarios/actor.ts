/**
 * Turns the session into the identity the scenario service reasons about:
 * who owns a tab, who holds its lock, and whose name lands in the container
 * audit log when a scenario is applied to Live.
 */

import { auth } from "@/lib/auth";
import { ForbiddenError } from "@/lib/errors";
import type { ScenarioActor } from "@/lib/planning-scenarios/service";

export async function requireScenarioActor(request: Request): Promise<ScenarioActor> {
  const session = await auth();
  // The route's permission guard runs first and already rejects an
  // unauthenticated request with a 401; this only narrows the type.
  if (!session?.user?.id) throw new ForbiddenError("Unauthorized");

  return {
    userId: session.user.id,
    role: (session.user.role as string) ?? "user",
    userName: session.user.name ?? null,
    userEmail: session.user.email ?? null,
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
  };
}
