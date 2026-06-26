import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { PartsGrid } from "@/components/planning/seat-cover/parts-grid";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "parts", "read");
  if (!allowed) redirect("/");

  return <PartsGrid />;
}
