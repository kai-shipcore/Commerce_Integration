import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { VehicleGrid } from "@/components/production/vehicle-grid";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  return <VehicleGrid />;
}
