import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { ProductFormPage } from "@/components/production/product-form-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "project-list", "read");
  if (!allowed) redirect("/");

  const { id } = await params;
  return <ProductFormPage mode="edit" productId={id} />;
}
