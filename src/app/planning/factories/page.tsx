import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { FactoriesPage } from "@/components/planning/factories/factories-page";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "factory", "read");
  if (!allowed) redirect("/");

  return <FactoriesPage />;
}
