import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { PartSkuGeneratorPage } from "@/components/production/part-sku-generator-page";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "part-sku-generator", "read");
  if (!allowed) redirect("/");

  return <PartSkuGeneratorPage />;
}
