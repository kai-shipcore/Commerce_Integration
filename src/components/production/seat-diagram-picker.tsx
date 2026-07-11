"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/i18n-provider";
import type {
  SeatCoverPartCategory,
  SeatCoverPartPosition,
  SeatCoverPartRow,
} from "@/lib/seat-cover-part-catalog";

export type SeatZone = {
  id: string;
  seatRow: SeatCoverPartRow;
  position: SeatCoverPartPosition;
  category: SeatCoverPartCategory;
  label: { ko: string; en: string };
  // Overrides the category's shared diagram text for this zone only (e.g. Front Middle's
  // Top/Body zone also covers the console, unlike every other Top/Body zone).
  displayLabel?: { ko: string; en: string };
};

export const FRONT_SEAT_ZONES: SeatZone[] = [
  { id: "front-driver-headrest", seatRow: "Front", position: "Driver", category: "Headrest", label: { ko: "운전석 헤드레스트", en: "Driver Headrest" } },
  { id: "front-driver-top-body", seatRow: "Front", position: "Driver", category: "Top Body", label: { ko: "운전석 등받이", en: "Driver Top/Body" } },
  { id: "front-driver-bottom", seatRow: "Front", position: "Driver", category: "Bottom", label: { ko: "운전석 방석", en: "Driver Bottom" } },
  { id: "front-driver-arm", seatRow: "Front", position: "Driver", category: "Arm", label: { ko: "운전석 팔걸이", en: "Driver Arm" } },
  { id: "front-passenger-headrest", seatRow: "Front", position: "Passenger", category: "Headrest", label: { ko: "조수석 헤드레스트", en: "Passenger Headrest" } },
  { id: "front-passenger-top-body", seatRow: "Front", position: "Passenger", category: "Top Body", label: { ko: "조수석 등받이", en: "Passenger Top/Body" } },
  { id: "front-passenger-bottom", seatRow: "Front", position: "Passenger", category: "Bottom", label: { ko: "조수석 방석", en: "Passenger Bottom" } },
  { id: "front-passenger-arm", seatRow: "Front", position: "Passenger", category: "Arm", label: { ko: "조수석 팔걸이", en: "Passenger Arm" } },
  { id: "front-middle-headrest", seatRow: "Front", position: "Middle", category: "Headrest", label: { ko: "중앙석 헤드레스트", en: "Middle Headrest" } },
  { id: "front-middle-top-body", seatRow: "Front", position: "Middle", category: "Top Body", label: { ko: "중앙석 등받이 (콘솔/점프시트)", en: "Middle Top/Body (Console/Jump Seat)" }, displayLabel: { ko: "등받이/콘솔", en: "Top/Body/Console" } },
  { id: "front-middle-bottom", seatRow: "Front", position: "Middle", category: "Bottom", label: { ko: "중앙석 방석", en: "Middle Bottom" } },
  { id: "front-driver-leg-support", seatRow: "Front", position: "Driver", category: "Leg Support", label: { ko: "운전석 다리 지지대", en: "Driver Leg Support" } },
  { id: "front-passenger-leg-support", seatRow: "Front", position: "Passenger", category: "Leg Support", label: { ko: "조수석 다리 지지대", en: "Passenger Leg Support" } },
];

export const REAR_SEAT_ZONES: SeatZone[] = [
  { id: "rear-driver-headrest", seatRow: "Rear", position: "Driver", category: "Headrest", label: { ko: "운전석 헤드레스트", en: "Driver Headrest" } },
  { id: "rear-driver-top-body", seatRow: "Rear", position: "Driver", category: "Top Body", label: { ko: "운전석 등받이", en: "Driver Top/Body" } },
  { id: "rear-driver-bottom", seatRow: "Rear", position: "Driver", category: "Bottom", label: { ko: "운전석 방석", en: "Driver Bottom" } },
  { id: "rear-driver-arm", seatRow: "Rear", position: "Driver", category: "Arm", label: { ko: "운전석 팔걸이", en: "Driver Arm" } },
  { id: "rear-driver-back-storage", seatRow: "Rear", position: "Driver", category: "Back Storage", label: { ko: "운전석 등받이 수납", en: "Driver Back Storage" } },
  { id: "rear-driver-sub-part", seatRow: "Rear", position: "Driver", category: "Sub-part", label: { ko: "운전석 기타 부품", en: "Driver Sub-part" } },
  { id: "rear-passenger-headrest", seatRow: "Rear", position: "Passenger", category: "Headrest", label: { ko: "조수석 헤드레스트", en: "Passenger Headrest" } },
  { id: "rear-passenger-top-body", seatRow: "Rear", position: "Passenger", category: "Top Body", label: { ko: "조수석 등받이", en: "Passenger Top/Body" } },
  { id: "rear-passenger-bottom", seatRow: "Rear", position: "Passenger", category: "Bottom", label: { ko: "조수석 방석", en: "Passenger Bottom" } },
  { id: "rear-passenger-arm", seatRow: "Rear", position: "Passenger", category: "Arm", label: { ko: "조수석 팔걸이", en: "Passenger Arm" } },
  { id: "rear-passenger-back-storage", seatRow: "Rear", position: "Passenger", category: "Back Storage", label: { ko: "조수석 등받이 수납", en: "Passenger Back Storage" } },
  { id: "rear-passenger-sub-part", seatRow: "Rear", position: "Passenger", category: "Sub-part", label: { ko: "조수석 기타 부품", en: "Passenger Sub-part" } },
  { id: "rear-middle-headrest", seatRow: "Rear", position: "Middle", category: "Headrest", label: { ko: "중앙석 헤드레스트", en: "Middle Headrest" } },
  { id: "rear-middle-top-body", seatRow: "Rear", position: "Middle", category: "Top Body", label: { ko: "중앙석 등받이", en: "Middle Top/Body" } },
  { id: "rear-middle-bottom", seatRow: "Rear", position: "Middle", category: "Bottom", label: { ko: "중앙석 방석", en: "Middle Bottom" } },
  { id: "rear-middle-console", seatRow: "Rear", position: "Middle", category: "Console", label: { ko: "중앙석 콘솔", en: "Middle Console" } },
  { id: "rear-driver-leg-support", seatRow: "Rear", position: "Driver", category: "Leg Support", label: { ko: "운전석 다리 지지대", en: "Driver Leg Support" } },
  { id: "rear-passenger-leg-support", seatRow: "Rear", position: "Passenger", category: "Leg Support", label: { ko: "조수석 다리 지지대", en: "Passenger Leg Support" } },
  { id: "rear-driver-side-bolster", seatRow: "Rear", position: "Driver", category: "Side Bolster", label: { ko: "운전석 사이드 볼스터", en: "Driver Side Bolster" } },
  { id: "rear-passenger-side-bolster", seatRow: "Rear", position: "Passenger", category: "Side Bolster", label: { ko: "조수석 사이드 볼스터", en: "Passenger Side Bolster" } },
];

export const THIRD_ROW_SEAT_ZONES: SeatZone[] = [
  { id: "third-row-driver-headrest", seatRow: "Third Row", position: "Driver", category: "Headrest", label: { ko: "운전석 헤드레스트", en: "Driver Headrest" } },
  { id: "third-row-driver-top-body", seatRow: "Third Row", position: "Driver", category: "Top Body", label: { ko: "운전석 등받이", en: "Driver Top/Body" } },
  { id: "third-row-driver-bottom", seatRow: "Third Row", position: "Driver", category: "Bottom", label: { ko: "운전석 방석", en: "Driver Bottom" } },
  { id: "third-row-driver-arm", seatRow: "Third Row", position: "Driver", category: "Arm", label: { ko: "운전석 팔걸이", en: "Driver Arm" } },
  { id: "third-row-driver-back-storage", seatRow: "Third Row", position: "Driver", category: "Back Storage", label: { ko: "운전석 등받이 수납", en: "Driver Back Storage" } },
  { id: "third-row-driver-sub-part", seatRow: "Third Row", position: "Driver", category: "Sub-part", label: { ko: "운전석 기타 부품", en: "Driver Sub-part" } },
  { id: "third-row-passenger-headrest", seatRow: "Third Row", position: "Passenger", category: "Headrest", label: { ko: "조수석 헤드레스트", en: "Passenger Headrest" } },
  { id: "third-row-passenger-top-body", seatRow: "Third Row", position: "Passenger", category: "Top Body", label: { ko: "조수석 등받이", en: "Passenger Top/Body" } },
  { id: "third-row-passenger-bottom", seatRow: "Third Row", position: "Passenger", category: "Bottom", label: { ko: "조수석 방석", en: "Passenger Bottom" } },
  { id: "third-row-passenger-arm", seatRow: "Third Row", position: "Passenger", category: "Arm", label: { ko: "조수석 팔걸이", en: "Passenger Arm" } },
  { id: "third-row-passenger-back-storage", seatRow: "Third Row", position: "Passenger", category: "Back Storage", label: { ko: "조수석 등받이 수납", en: "Passenger Back Storage" } },
  { id: "third-row-passenger-sub-part", seatRow: "Third Row", position: "Passenger", category: "Sub-part", label: { ko: "조수석 기타 부품", en: "Passenger Sub-part" } },
  { id: "third-row-middle-headrest", seatRow: "Third Row", position: "Middle", category: "Headrest", label: { ko: "중앙석 헤드레스트", en: "Middle Headrest" } },
  { id: "third-row-middle-top-body", seatRow: "Third Row", position: "Middle", category: "Top Body", label: { ko: "중앙석 등받이", en: "Middle Top/Body" } },
  { id: "third-row-middle-bottom", seatRow: "Third Row", position: "Middle", category: "Bottom", label: { ko: "중앙석 방석", en: "Middle Bottom" } },
  { id: "third-row-middle-console", seatRow: "Third Row", position: "Middle", category: "Console", label: { ko: "중앙석 콘솔", en: "Middle Console" } },
  { id: "third-row-driver-leg-support", seatRow: "Third Row", position: "Driver", category: "Leg Support", label: { ko: "운전석 다리 지지대", en: "Driver Leg Support" } },
  { id: "third-row-passenger-leg-support", seatRow: "Third Row", position: "Passenger", category: "Leg Support", label: { ko: "조수석 다리 지지대", en: "Passenger Leg Support" } },
];

export const ALL_SEAT_ZONES: SeatZone[] = [...FRONT_SEAT_ZONES, ...REAR_SEAT_ZONES, ...THIRD_ROW_SEAT_ZONES];

type RectGeo = { x: number; y: number; width: number; height: number; rx: number };

type SeatGeometry = {
  headrest: RectGeo;
  backrest: RectGeo;
  cushion: RectGeo;
  legSupport: RectGeo;
  shadow: { cx: number; cy: number; rx: number; ry: number };
  arm?: RectGeo;
  backStorage?: RectGeo;
  subPart?: RectGeo;
  console?: RectGeo;
  sideBolster?: RectGeo;
};

// One local template (seat centered at x=0, scale=1) is translated/scaled into place for
// Driver, Passenger, and the smaller Middle jump seat, so all three share identical
// proportions. Each piece slightly overlaps the next (headrest into backrest, backrest into
// cushion) and is drawn cushion-first so the wider piece underneath reads as a continuous
// silhouette instead of three separate floating blocks. armSide/includeConsole add the extra
// Rear-only zones (Back Storage + Sub-part stacked on the inner edge, toward the Middle seat;
// Side Bolster mirrored onto the opposite (outer/door-side) edge from Arm;
// a Console flap straddling the Middle seat's backrest/cushion seam) — harmless no-ops for
// Front, which never references these fields.
function buildSeatGeometry(
  centerX: number,
  scale: number,
  topOffset: number,
  armSide?: -1 | 1,
  includeConsole?: boolean
): SeatGeometry {
  const r = (localX: number, localY: number, w: number, h: number, rx: number): RectGeo => ({
    x: centerX + localX * scale,
    y: topOffset + localY * scale,
    width: w * scale,
    height: h * scale,
    rx: rx * scale,
  });
  const geometry: SeatGeometry = {
    headrest: r(-34, 0, 68, 48, 20),
    backrest: r(-45, 40, 90, 95, 16),
    cushion: r(-62, 118, 124, 62, 20),
    legSupport: r(-55, 180, 110, 24, 10),
    shadow: { cx: centerX, cy: topOffset + 213 * scale, rx: 78 * scale, ry: 9 * scale },
  };
  if (armSide) {
    const armX = armSide < 0 ? -71 : 45;
    const sideBolsterX = armSide < 0 ? 45 : -71;
    geometry.arm = r(armX, 57, 26, 60, 9);
    geometry.backStorage = r(armX, 18, 26, 32, 8);
    geometry.sideBolster = r(sideBolsterX, 57, 26, 60, 9);
    geometry.subPart = r(-20, 204, 40, 22, 10);
  }
  if (includeConsole) {
    geometry.console = r(-38, 112, 76, 30, 10);
  }
  return geometry;
}

const DRIVER_GEOMETRY = buildSeatGeometry(384, 1, 10, -1);
const PASSENGER_GEOMETRY = buildSeatGeometry(96, 1, 10, 1);
const MIDDLE_GEOMETRY = buildSeatGeometry(240, 1, 10, undefined, true);

const SEAT_GEOMETRY_BY_POSITION: Record<"Driver" | "Passenger" | "Middle", SeatGeometry> = {
  Driver: DRIVER_GEOMETRY,
  Passenger: PASSENGER_GEOMETRY,
  Middle: MIDDLE_GEOMETRY,
};

function zoneRect(zone: SeatZone): RectGeo | undefined {
  const geometry = SEAT_GEOMETRY_BY_POSITION[zone.position as "Driver" | "Passenger" | "Middle"];
  if (!geometry) return undefined;
  if (zone.category === "Headrest") return geometry.headrest;
  if (zone.category === "Top Body") return geometry.backrest;
  if (zone.category === "Bottom") return geometry.cushion;
  if (zone.category === "Arm") return geometry.arm;
  if (zone.category === "Back Storage") return geometry.backStorage;
  if (zone.category === "Sub-part") return geometry.subPart;
  if (zone.category === "Console") return geometry.console;
  if (zone.category === "Leg Support") return geometry.legSupport;
  if (zone.category === "Side Bolster") return geometry.sideBolster;
  return undefined;
}

function categorySlug(category: SeatCoverPartCategory): string {
  return category.toLowerCase().replace(/[^a-z]+/g, "-");
}

const CATEGORY_GRADIENT: Record<SeatCoverPartCategory, { from: string; to: string }> = {
  Headrest: { from: "#d9f1ea", to: "#a9dbcb" },
  "Top Body": { from: "#dceafb", to: "#a9c5ec" },
  Bottom: { from: "#f9eecb", to: "#e6cf8f" },
  Arm: { from: "#f1e5d4", to: "#d2b98f" },
  Console: { from: "#f9dad2", to: "#e0a89a" },
  "Back Storage": { from: "#ede7d9", to: "#c9bfa4" },
  "Sub-part": { from: "#e3eee8", to: "#b9cdc0" },
  // Not yet drawn on the diagram (no SeatZone uses these categories) — placeholder values
  // kept only so this Record stays exhaustive over SeatCoverPartCategory.
  "Leg Support": { from: "#e6ece3", to: "#c3d0b8" },
  "Side Bolster": { from: "#eee0f0", to: "#cfa9d6" },
};

const CATEGORY_STROKE: Record<SeatCoverPartCategory, string> = {
  Headrest: "#3f8a73",
  "Top Body": "#2f5a94",
  Bottom: "#a17a1e",
  Arm: "#7a5a34",
  Console: "#a1402e",
  "Back Storage": "#6b5d3e",
  "Sub-part": "#47614f",
  "Leg Support": "#5b7248",
  "Side Bolster": "#7a3f82",
};

const CATEGORY_LABEL: Record<SeatCoverPartCategory, { ko: string; en: string }> = {
  Headrest: { ko: "헤드", en: "Head" },
  "Top Body": { ko: "등받이", en: "Top/Body" },
  Bottom: { ko: "방석", en: "Bottom" },
  Arm: { ko: "팔걸이", en: "Arm" },
  Console: { ko: "콘솔", en: "Console" },
  "Back Storage": { ko: "수납", en: "Storage" },
  "Sub-part": { ko: "서브", en: "Sub" },
  "Leg Support": { ko: "다리 지지대", en: "Leg Support" },
  "Side Bolster": { ko: "사이드 볼스터", en: "Side Bolster" },
};

const ROW_TABS: { key: SeatCoverPartRow; labelKo: string; labelEn: string }[] = [
  { key: "Front", labelKo: "1열 (Front)", labelEn: "Row 1 (Front)" },
  { key: "Rear", labelKo: "2열 (Rear)", labelEn: "Row 2 (Rear)" },
  { key: "Third Row", labelKo: "3열 (Third Row)", labelEn: "Row 3 (Third Row)" },
];

const ACCENT = "#1a5cdb";

const HEADREST_POSITION_LETTER: Partial<Record<SeatCoverPartPosition, string>> = {
  Driver: "D",
  Passenger: "P",
};

// Draw order matters: cushion first, then backrest, then console (straddles that seam), then
// the outer-edge extras, then headrest last — each later piece's rounded edge overlaps the
// previous piece's seam so the pieces read as one continuous seat instead of stacked blocks.
const DRAW_ORDER: SeatCoverPartCategory[] = ["Bottom", "Leg Support", "Top Body", "Console", "Back Storage", "Side Bolster", "Sub-part", "Arm", "Headrest"];

type SeatDiagramPickerProps = {
  row: SeatCoverPartRow;
  onRowChange: (row: SeatCoverPartRow) => void;
  selectedZoneId: string | null;
  onZoneSelect: (zoneId: string) => void;
  zoneCounts: Record<string, number>;
};

function SeatShadow({ geometry }: { geometry: SeatGeometry }) {
  return (
    <ellipse
      cx={geometry.shadow.cx}
      cy={geometry.shadow.cy}
      rx={geometry.shadow.rx}
      ry={geometry.shadow.ry}
      fill="black"
      opacity={0.14}
      filter="url(#seat-shadow-blur)"
      pointerEvents="none"
    />
  );
}

type SeatRowDiagramProps = {
  zones: SeatZone[];
  selectedZoneId: string | null;
  hoveredZoneId: string | null;
  onHover: (zoneId: string | null) => void;
  onZoneSelect: (zoneId: string) => void;
  zoneCounts: Record<string, number>;
  pick: (ko: string, en: string) => string;
};

function SeatRowDiagram({ zones, selectedZoneId, hoveredZoneId, onHover, onZoneSelect, zoneCounts, pick }: SeatRowDiagramProps) {
  return (
    <svg viewBox="0 0 480 250" className="mx-auto h-auto w-full max-h-[480px]">
      <defs>
        <filter id="seat-shadow-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <filter id="zone-selected-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor={ACCENT} floodOpacity="0.55" />
        </filter>
        {(Object.keys(CATEGORY_GRADIENT) as SeatCoverPartCategory[]).map((category) => (
          <linearGradient key={category} id={`seat-grad-${categorySlug(category)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CATEGORY_GRADIENT[category].from} />
            <stop offset="100%" stopColor={CATEGORY_GRADIENT[category].to} />
          </linearGradient>
        ))}
      </defs>

      <SeatShadow geometry={DRIVER_GEOMETRY} />
      <SeatShadow geometry={PASSENGER_GEOMETRY} />
      <SeatShadow geometry={MIDDLE_GEOMETRY} />

      {DRAW_ORDER.flatMap((category) =>
        zones
          .filter((zone) => zone.category === category)
          .map((zone) => {
            const geometry = zoneRect(zone);
            if (!geometry) return null;
            const isSelected = selectedZoneId === zone.id;
            const isHovered = hoveredZoneId === zone.id;
            const count = zoneCounts[zone.id] ?? 0;
            const isVertical = zone.category === "Arm" || zone.category === "Back Storage" || zone.category === "Side Bolster";
            const centerX = geometry.x + geometry.width / 2;
            const centerY = geometry.y + geometry.height / 2;
            const headrestLetter = zone.category === "Headrest" ? HEADREST_POSITION_LETTER[zone.position] : undefined;
            const categoryLabel = zone.displayLabel ?? CATEGORY_LABEL[zone.category];
            const stroke = CATEGORY_STROKE[zone.category];
            const textTransform = isVertical ? `rotate(-90 ${centerX} ${centerY})` : undefined;

            return (
              <g
                key={zone.id}
                role="button"
                tabIndex={0}
                aria-label={pick(zone.label.ko, zone.label.en)}
                className="cursor-pointer outline-none"
                filter={isSelected ? "url(#zone-selected-glow)" : undefined}
                onClick={() => onZoneSelect(zone.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onZoneSelect(zone.id);
                  }
                }}
                onMouseEnter={() => onHover(zone.id)}
                onMouseLeave={() => onHover(null)}
              >
                <rect
                  x={geometry.x}
                  y={geometry.y}
                  width={geometry.width}
                  height={geometry.height}
                  rx={geometry.rx}
                  fill={`url(#seat-grad-${categorySlug(zone.category)})`}
                  fillOpacity={count === 0 ? 0.55 : 1}
                  stroke={isSelected ? ACCENT : stroke}
                  strokeWidth={isSelected ? 2.2 : isHovered ? 1.8 : 1.1}
                />
                <title>{pick(zone.label.ko, zone.label.en)}</title>
                {headrestLetter ? (
                  <>
                    <text x={centerX} y={centerY - 3} textAnchor="middle" fontSize={22} fontWeight={800} fill={stroke}>
                      {headrestLetter}
                    </text>
                    <text x={centerX} y={centerY + 15} textAnchor="middle" fontSize={9} fontWeight={600} fill={stroke} opacity={0.85}>
                      {pick(categoryLabel.ko, categoryLabel.en)}
                    </text>
                  </>
                ) : (
                  <text
                    x={centerX}
                    y={centerY + 4}
                    textAnchor="middle"
                    fontSize={
                      zone.category === "Arm" || zone.category === "Side Bolster"
                        ? 10
                        : zone.category === "Back Storage" || zone.category === "Sub-part" || zone.category === "Leg Support"
                          ? 8
                          : zone.displayLabel
                            ? 8
                            : 12
                    }
                    fontWeight={700}
                    fill={stroke}
                    transform={textTransform}
                  >
                    {pick(categoryLabel.ko, categoryLabel.en)}
                  </text>
                )}
              </g>
            );
          })
      )}
    </svg>
  );
}

export function SeatDiagramPicker({ row, onRowChange, selectedZoneId, onZoneSelect, zoneCounts }: SeatDiagramPickerProps) {
  const { pick } = useI18n();
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);

  const activeZones =
    row === "Front" ? FRONT_SEAT_ZONES : row === "Rear" ? REAR_SEAT_ZONES : row === "Third Row" ? THIRD_ROW_SEAT_ZONES : [];
  const selectedZone = activeZones.find((z) => z.id === selectedZoneId) ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {pick("부위 선택 (다이어그램)", "Select Part by Diagram")}
        </span>
        <div className="flex gap-1">
          {ROW_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onRowChange(tab.key)}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                row === tab.key
                  ? "bg-[#1a5cdb] text-white"
                  : "border border-[#cccac4] bg-white text-muted-foreground hover:bg-[#f0eee9]"
              }`}
            >
              {pick(tab.labelKo, tab.labelEn)}
            </button>
          ))}
        </div>
      </div>

      {activeZones.length > 0 ? (
        <SeatRowDiagram
          zones={activeZones}
          selectedZoneId={selectedZoneId}
          hoveredZoneId={hoveredZoneId}
          onHover={setHoveredZoneId}
          onZoneSelect={onZoneSelect}
          zoneCounts={zoneCounts}
          pick={pick}
        />
      ) : (
        <div className="flex h-60 items-center justify-center rounded-lg border border-dashed border-[#cccac4] bg-[#f5f4f0] text-xs text-muted-foreground">
          {pick("해당 열의 다이어그램은 추후 추가 예정입니다.", "The diagram for this row is coming soon.")}
        </div>
      )}

      {selectedZone ? (
        <div className="mt-2 flex items-center justify-center gap-2 text-base text-muted-foreground">
          <span>
            {pick("선택된 부위: ", "Selected zone: ")}
            <strong className="text-foreground">{pick(selectedZone.label.ko, selectedZone.label.en)}</strong>
          </span>
          <button type="button" onClick={() => onZoneSelect(selectedZone.id)} className="text-[#1a5cdb] underline hover:text-[#1650c4]">
            {pick("필터 해제", "Clear filter")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
