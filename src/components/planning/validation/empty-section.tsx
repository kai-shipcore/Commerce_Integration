"use client";

/**
 * Code Guide:
 * Placeholder for a section whose data does not exist yet.
 *
 * It states what will fill the space and what has to happen first, rather than
 * hiding the section or showing a spinner that never resolves. A reader who
 * finds an empty panel with no explanation assumes something is broken; a reader
 * who is told the evidence is still accumulating knows to come back.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";

export function EmptySection({
  title,
  waitingOn,
  detail,
}: {
  title: string;
  /** One line naming the event that will populate this section. */
  waitingOn: string;
  detail?: string;
}) {
  const { pick } = useI18n();
  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-6">
      <p className="text-[12.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {pick("데이터 대기 중", "Nothing to show yet")}
      </p>
      <p className="mt-1.5 text-sm font-medium">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{waitingOn}</p>
      {detail && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted-foreground">{detail}</p>
      )}
    </div>
  );
}
