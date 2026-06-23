"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export interface QuickLink {
  href: string;
  label: string;
  labelKo?: string;
  labelEn?: string;
}

export function QuickLinks({
  links,
  onNavigate,
}: {
  links: QuickLink[];
  onNavigate?: (href: string) => boolean;
}) {
  const router = useRouter();

  return (
    <div className="grid w-full gap-3 sm:grid-cols-2">
      {links.map((link) => (
        <Button
          key={link.href}
          variant="outline"
          className="h-12"
          onClick={() => {
            if (onNavigate && !onNavigate(link.href)) return;
            router.push(link.href);
          }}
        >
          {link.label}
        </Button>
      ))}
    </div>
  );
}
