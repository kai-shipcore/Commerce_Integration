import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { ProductListPage } from "@/components/production/product-list-page";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "project-list", "read");
  if (!allowed) redirect("/");

  return <ProductListPage />;
}
