// Code Guide: shared status vocabulary + pill styling for ProjectPart / ProjectChecklistItem
// status values, reused across the Product/Project list, detail, and row-detail pages.

export const PART_STATUS_OPTIONS = ["Pending", "Scheduled", "Scanned"] as const;
export const PART_STATUS_STYLES: Record<(typeof PART_STATUS_OPTIONS)[number], string> = {
  Pending: "border-[#e8c99a] bg-[#fbf1e0] text-[#8a5a10] dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-300",
  Scheduled: "border-[#bcd3f7] bg-[#eaf1fd] text-[#1a4db0] dark:border-blue-800 dark:bg-blue-950/70 dark:text-blue-300",
  Scanned: "border-[#bfe3d3] bg-[#e6f5f0] text-[#0a5e45] dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
};

export const CHECKLIST_STATUS_OPTIONS = ["Pending", "In Progress", "Done"] as const;
export const CHECKLIST_STATUS_STYLES: Record<(typeof CHECKLIST_STATUS_OPTIONS)[number], string> = {
  Pending: "border-[#cccac4] bg-[#f0eee9] text-muted-foreground",
  "In Progress": "border-[#bcd3f7] bg-[#eaf1fd] text-[#1a4db0] dark:border-blue-800 dark:bg-blue-950/70 dark:text-blue-300",
  Done: "border-[#bfe3d3] bg-[#e6f5f0] text-[#0a5e45] dark:border-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300",
};

export function partStatusClass(status: string): string {
  return PART_STATUS_STYLES[status as (typeof PART_STATUS_OPTIONS)[number]] ?? PART_STATUS_STYLES.Pending;
}

export function checklistStatusClass(status: string): string {
  return CHECKLIST_STATUS_STYLES[status as (typeof CHECKLIST_STATUS_OPTIONS)[number]] ?? CHECKLIST_STATUS_STYLES.Pending;
}

export function StatusPill({ label, className }: { label: string; className: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}
