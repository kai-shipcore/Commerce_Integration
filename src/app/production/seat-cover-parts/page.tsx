import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { SeatCoverPartsGrid } from "@/components/production/seat-cover-parts-grid";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  return <SeatCoverPartsGrid />;
}
