import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { WarehousePage as WarehouseContent } from "@/components/warehouse/warehouse-page";

export default async function WarehousePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "warehouse", "read");
  if (!allowed) redirect("/");

  return <WarehouseContent />;
}
