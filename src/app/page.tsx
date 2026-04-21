/**
 * Code Guide:
 * Landing route for the application.
 * This file redirects or forwards users into the main product experience.
 */

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/prisma";
import { getDefaultLandingPath } from "@/components/layout/navigation-config";

export default async function HomePage() {
  const session = await auth();

  if (!session?.user?.id) {
    redirect("/auth/signin");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { menuVisibility: true },
  });

  redirect(getDefaultLandingPath(user?.menuVisibility, session.user.role));
}
