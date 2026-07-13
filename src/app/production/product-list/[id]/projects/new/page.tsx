import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { ProjectFormPage } from "@/components/production/project-form-page";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "project-list", "create");
  if (!allowed) redirect("/");

  const { id } = await params;
  return <ProjectFormPage mode="create" productId={id} />;
}
