import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { ProductFormPage } from "@/components/production/product-form-page";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "project-list", "create");
  if (!allowed) redirect("/");

  return <ProductFormPage mode="create" />;
}
