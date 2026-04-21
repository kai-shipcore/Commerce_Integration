"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex items-center rounded-full border bg-background p-1">
        <div className="h-8 w-16 rounded-full bg-muted" />
        <div className="h-8 w-16 rounded-full bg-muted" />
      </div>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <div className="flex items-center rounded-full border bg-background p-1 shadow-xs">
      <Button
        type="button"
        variant={isDark ? "ghost" : "secondary"}
        size="sm"
        className="h-8 rounded-full px-3.5 text-xs"
        onClick={() => setTheme("light")}
      >
        <Sun className="size-4" />
        Light
      </Button>
      <Button
        type="button"
        variant={isDark ? "secondary" : "ghost"}
        size="sm"
        className="h-8 rounded-full px-3.5 text-xs"
        onClick={() => setTheme("dark")}
      >
        <Moon className="size-4" />
        Dark
      </Button>
    </div>
  );
}
