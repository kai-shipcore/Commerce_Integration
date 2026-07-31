import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { VehicleGrid } from "@/components/production/vehicle-grid";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "production-vehicles", "read");
  if (!allowed) redirect("/");

  return <VehicleGrid />;
}
