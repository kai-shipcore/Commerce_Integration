"use client";

/**
 * Code Guide:
 * Top-level client-side provider wrapper.
 * Global React context providers are collected here so the root layout can mount them in one place.
 */
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { apiPath } from "@/lib/api-path";

interface ProvidersProps {
  children: React.ReactNode;
  session?: Session | null;
}

export function Providers({ children, session }: ProvidersProps) {
  return (
    <ThemeProvider>
      <SessionProvider session={session} basePath={apiPath("/api/auth")}>
        {children}
        <Toaster />
      </SessionProvider>
    </ThemeProvider>
  );
}
