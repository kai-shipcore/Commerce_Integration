/**
 * Code Guide:
 * Shared layout component used across app screens.
 * Navigation, shell structure, and session-aware controls are kept here so individual pages stay focused on their own content.
 */

"use client";

import Link from "next/link";
import { MainNav } from "./main-nav";
import { UserMenu } from "./user-menu";
import Image from "next/image";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-[#c2d0db] bg-[#dde6ee] dark:border-[#4e6473] dark:bg-[#607786]">
        <div className="container flex h-14 items-center bg-[#dde6ee] dark:bg-[#607786]">
          <div className="mr-4 flex">
            <Link className="mr-6 flex items-center" href="/">
              <Image
                src="/DemandPilot_Logo_NSlogan_S_transparent.png"
                alt="Demand Pilot"
                width={140}
                height={32}
                className="h-8 w-auto"
                priority
              />
            </Link>
          </div>
          <MainNav />
          <div className="ml-auto flex items-center space-x-4">
            <UserMenu />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto py-6">{children}</main>
    </div>
  );
}
