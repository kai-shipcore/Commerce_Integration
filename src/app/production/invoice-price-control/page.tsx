import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { canDo } from "@/lib/permissions";
import { InvoicePriceControlTabs } from "@/components/production/invoice-price-control-tabs";

export default async function Page() {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const allowed = await canDo(session.user.id, session.user.role as string, "invoice-price-control", "read");
  if (!allowed) redirect("/");

  return <InvoicePriceControlTabs />;
}

