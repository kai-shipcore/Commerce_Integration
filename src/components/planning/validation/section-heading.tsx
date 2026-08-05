"use client";

/**
 * Code Guide:
 * Shared heading and contents bar for the validation page.
 *
 * This page is six sections of evidence read top to bottom, and it had no way
 * to see its own shape: every heading was the same size as the sub-headings
 * inside the sections beneath it, so scrolling gave no sense of where one
 * argument ended and the next began, and there was no way to get back to a
 * section without scrolling past the others.
 *
 * The number is the point of the numbering. These sections are an argument in
 * order — how the model scores, the same evidence drawn, where it breaks down,
 * how it does on forecasts actually served, what is being held back, and the
 * demand the whole thing sits on. A reader presenting this to someone else
 * needs to be able to say "section three", and a reader returning to it needs
 * to know whether they have seen all of it.
 *
 * Headings own their anchor id rather than the page wrapping them in one, so a
 * section cannot be linked in the contents bar without also being labelled
 * where it lands.
 */

import { useI18n } from "@/lib/i18n/i18n-provider";

/** The page's sections, in the order they render.
 *
 *  Held here rather than in the page so the contents bar and the headings
 *  cannot disagree about what exists or what it is called. Adding a section
 *  means adding it here, which is the reminder to give it a number and a name
 *  that reads as part of the sequence. */
export const VALIDATION_SECTIONS = [
  { id: "comparison", label: ["모델 대 스프레드시트", "Model versus spreadsheet"] },
  { id: "trajectory", label: ["주간 실판매와 예측", "Demand vs forecast"] },
  { id: "outliers", label: ["SKU 단위 편차", "Where it breaks down"] },
  { id: "over-time", label: ["실제 운영 성적", "Forecasts actually served"] },
  { id: "final-test", label: ["최종 테스트 구간", "Final test window"] },
  { id: "demand", label: ["수요 구조", "How demand is shaped"] },
] as const;

export type ValidationSectionId = (typeof VALIDATION_SECTIONS)[number]["id"];

function indexOf(id: ValidationSectionId): number {
  return VALIDATION_SECTIONS.findIndex((s) => s.id === id) + 1;
}

/**
 * Numbered heading for one section.
 *
 * `scroll-mt` is not decoration: without it an anchor jump puts the heading
 * flush against the top of the viewport, or underneath the app header, and the
 * reader lands on the section's contents with no title above them.
 */
export function SectionHeading({
  id,
  title,
  description,
  aside,
}: {
  id: ValidationSectionId;
  title: string;
  description?: string;
  /** Controls belonging to this section, laid out opposite the title. Passed in
   *  rather than left in the section body so the picker sits on the heading
   *  line instead of forming a third row above the content. */
  aside?: React.ReactNode;
}) {
  return (
    <div
      id={id}
      className="flex scroll-mt-24 flex-wrap items-start justify-between gap-x-6 gap-y-2 border-t pt-5"
    >
      <div className="flex min-w-0 items-baseline gap-3">
        <span
          aria-hidden
          className="shrink-0 text-[14px] font-semibold tabular-nums text-muted-foreground/60"
        >
          {String(indexOf(id)).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          {description && (
            // Capped rather than full width. These run to two or three lines of
            // explanation and a heading description set across a wide monitor
            // is a single long line the eye loses its place in.
            <p className="mt-1 max-w-[68ch] text-[13.5px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

/**
 * Contents bar. Sticky, so it stays available in a page that is several
 * screens tall.
 *
 * Sections that failed to load or have no data are dimmed and unclickable
 * rather than hidden. A contents list that silently shortens itself tells the
 * reader the page has five parts when it has six, which on an evidence page is
 * the wrong lie to tell: a section that is missing is itself information.
 */
export function ValidationContents({ ready }: { ready: Record<string, boolean> }) {
  const { pick } = useI18n();
  return (
    <nav
      aria-label={pick("페이지 목차", "Page contents")}
      className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center gap-x-1 gap-y-1 border-b bg-background/95 px-1 py-2 backdrop-blur"
    >
      <span className="mr-1 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {pick("목차", "Contents")}
      </span>
      {VALIDATION_SECTIONS.map((s, i) => {
        const label = pick(s.label[0], s.label[1]);
        const isReady = ready[s.id] !== false;
        if (!isReady) {
          return (
            <span
              key={s.id}
              className="cursor-default rounded px-2 py-1 text-[12.5px] text-muted-foreground/40"
              title={pick("아직 불러오지 않았습니다.", "Not loaded.")}
            >
              <span className="mr-1 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              {label}
            </span>
          );
        }
        return (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <span className="mr-1 tabular-nums opacity-60">
              {String(i + 1).padStart(2, "0")}
            </span>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
