"use client";

/**
 * Code Guide:
 * Numbered section headings for the validation page.
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
 * section stays linkable from outside the page even now that nothing inside it
 * links to them.
 */


/** The page's sections, in the order they render, which is the order the
 *  argument is made in: the claim, its scope, the claim drawn over time, the
 *  out-of-sample record, where it is weakest, and what is deliberately not
 *  claimed yet.
 *
 *  This list is what assigns the numbers, so it has to match the order the page
 *  actually renders in. A heading numbered 03 sitting fourth is worse than no
 *  numbering at all. Adding a section means adding it here, in its place. */
export const VALIDATION_SECTIONS = [
  { id: "comparison", label: ["모델 대 스프레드시트", "Model versus spreadsheet"] },
  { id: "demand", label: ["수요 구조", "How demand is shaped"] },
  { id: "trajectory", label: ["주간 실판매와 예측", "Demand vs forecast"] },
  { id: "over-time", label: ["실제 운영 성적", "Forecasts actually served"] },
  { id: "outliers", label: ["SKU 단위 분석", "SKU-level breakdown"] },
  { id: "final-test", label: ["최종 테스트 구간", "Final test window"] },
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

/* The contents bar that used to live here was removed on 2026-08-05.
 *
 * Six sections listed one-for-one is navigation the scrollbar already provides,
 * which was the objection recorded against it in BACKLOG.md 13.2 before it was
 * built. What it was actually contributing was the numbering, and the numbering
 * belongs to the headings: it survives here, and the bar does not.
 *
 * `VALIDATION_SECTIONS` stays because it is still what assigns those numbers,
 * and keeping the order in one place is what stops a heading claiming to be
 * section three while sitting fourth on the page. */
