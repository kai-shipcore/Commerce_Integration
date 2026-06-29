"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { ShipHeroCredentialsForm } from "@/components/admin/shiphero-credentials-form";

export default function ShipHeroCredentialsPage() {
  return (
    <AppLayout>
      <ShipHeroCredentialsForm />
    </AppLayout>
  );
}
