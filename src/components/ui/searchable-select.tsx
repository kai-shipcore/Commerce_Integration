/**
 * Code Guide:
 * Single-select combobox with a type-to-filter search box (Command + Popover),
 * for plain string option lists that are too long to scan in a native <select>.
 */

"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder,
  emptyText = "No results found.",
  disabled = false,
  className,
}: {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "form-input flex h-9 items-center justify-between gap-2 bg-white text-xs disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || placeholder}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder ?? placeholder} className="text-xs" />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option}
                  value={option}
                  onSelect={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className="text-xs"
                >
                  <Check className={cn("h-3.5 w-3.5", value === option ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{option}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
