import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { PartsCodesPage } from "@/components/production/parts-codes-page";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "parts-codes", "read");
  if (!allowed) redirect("/");

  return <PartsCodesPage />;
}
