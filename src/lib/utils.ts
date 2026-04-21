/**
 * Code Guide:
 * Small shared utility helpers.
 * This file usually contains generic helpers that are reused across many UI components.
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
