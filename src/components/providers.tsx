"use client";

/**
 * Code Guide:
 * Top-level client-side provider wrapper.
 * Global React context providers are collected here so the root layout can mount them in one place.
 */
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { ThemeProvider } from "next-themes";

interface ProvidersProps {
  children: React.ReactNode;
  session?: Session | null;
}

export function Providers({ children, session }: ProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <SessionProvider session={session}>{children}</SessionProvider>
    </ThemeProvider>
  );
}
