import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { ProjectFormPage } from "@/components/production/project-form-page";

export default async function Page({ params }: { params: Promise<{ id: string; projectId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "project-list", "read");
  if (!allowed) redirect("/");

  const { id, projectId } = await params;
  return <ProjectFormPage mode="edit" productId={id} projectId={projectId} />;
}
