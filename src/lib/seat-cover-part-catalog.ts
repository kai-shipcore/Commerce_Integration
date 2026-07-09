/**
 * Code Guide:
 * Fixed catalog of standard seat-cover part names, mirroring the physical structure of a
 * car seat (row x position x category). This is structural domain vocabulary, not
 * operational data — it doesn't need a DB table / admin UI the way Code or Designer
 * Initial do. Source list matches PART_OPTIONS in
 * src/components/planning/seat-cover/add-part-dialog.tsx.
 */

export type SeatCoverPartRow = "Front" | "Rear" | "Third Row";
export type SeatCoverPartPosition = "Driver" | "Passenger" | "Middle" | "Universal";
export type SeatCoverPartCategory =
  | "Headrest"
  | "Top Body"
  | "Bottom"
  | "Arm"
  | "Console"
  | "Back Storage"
  | "Sub-part";

export type SeatCoverPartOption = {
  name: string;
  seatRow: SeatCoverPartRow;
  position: SeatCoverPartPosition;
  category: SeatCoverPartCategory;
};

export const SEAT_COVER_PART_CATALOG: SeatCoverPartOption[] = [
  { name: "Front Headrest (Driver)", seatRow: "Front", position: "Driver", category: "Headrest" },
  { name: "Front Headrest (Passenger)", seatRow: "Front", position: "Passenger", category: "Headrest" },
  { name: "Front Headrest (Universal)", seatRow: "Front", position: "Universal", category: "Headrest" },
  { name: "Front Top Body (Driver)", seatRow: "Front", position: "Driver", category: "Top Body" },
  { name: "Front Top Body (Passenger)", seatRow: "Front", position: "Passenger", category: "Top Body" },
  { name: "Front Top Body (Universal)", seatRow: "Front", position: "Universal", category: "Top Body" },
  { name: "Front Bottom (Driver)", seatRow: "Front", position: "Driver", category: "Bottom" },
  { name: "Front Bottom (Passenger)", seatRow: "Front", position: "Passenger", category: "Bottom" },
  { name: "Front Bottom (Universal)", seatRow: "Front", position: "Universal", category: "Bottom" },
  { name: "Front Middle Headrest", seatRow: "Front", position: "Middle", category: "Headrest" },
  { name: "Front Middle Top Body", seatRow: "Front", position: "Middle", category: "Top Body" },
  { name: "Front Middle Bottom", seatRow: "Front", position: "Middle", category: "Bottom" },
  { name: "Front Arm (Driver)", seatRow: "Front", position: "Driver", category: "Arm" },
  { name: "Front Arm (Passenger)", seatRow: "Front", position: "Passenger", category: "Arm" },
  { name: "Front Arm (Universal)", seatRow: "Front", position: "Universal", category: "Arm" },

  { name: "Rear Headrest (Driver)", seatRow: "Rear", position: "Driver", category: "Headrest" },
  { name: "Rear Headrest (Passenger)", seatRow: "Rear", position: "Passenger", category: "Headrest" },
  { name: "Rear Headrest (Universal)", seatRow: "Rear", position: "Universal", category: "Headrest" },
  { name: "Rear Top Body (Driver)", seatRow: "Rear", position: "Driver", category: "Top Body" },
  { name: "Rear Top Body (Passenger)", seatRow: "Rear", position: "Passenger", category: "Top Body" },
  { name: "Rear Top Body (Universal)", seatRow: "Rear", position: "Universal", category: "Top Body" },
  { name: "Rear Bottom (Driver)", seatRow: "Rear", position: "Driver", category: "Bottom" },
  { name: "Rear Bottom (Passenger)", seatRow: "Rear", position: "Passenger", category: "Bottom" },
  { name: "Rear Bottom (Universal)", seatRow: "Rear", position: "Universal", category: "Bottom" },
  { name: "Rear Middle Headrest", seatRow: "Rear", position: "Middle", category: "Headrest" },
  { name: "Rear Middle Top Body", seatRow: "Rear", position: "Middle", category: "Top Body" },
  { name: "Rear Middle Bottom", seatRow: "Rear", position: "Middle", category: "Bottom" },
  { name: "Rear Console", seatRow: "Rear", position: "Middle", category: "Console" },
  { name: "Rear Back Storage (Driver)", seatRow: "Rear", position: "Driver", category: "Back Storage" },
  { name: "Rear Back Storage (Passenger)", seatRow: "Rear", position: "Passenger", category: "Back Storage" },
  { name: "Rear Back Storage (Universal)", seatRow: "Rear", position: "Universal", category: "Back Storage" },
  { name: "Rear Arm (Driver)", seatRow: "Rear", position: "Driver", category: "Arm" },
  { name: "Rear Arm (Passenger)", seatRow: "Rear", position: "Passenger", category: "Arm" },
  { name: "Rear Arm (Universal)", seatRow: "Rear", position: "Universal", category: "Arm" },
  { name: "Rear Sub-part (Driver)", seatRow: "Rear", position: "Driver", category: "Sub-part" },
  { name: "Rear Sub-part (Passenger)", seatRow: "Rear", position: "Passenger", category: "Sub-part" },
  { name: "Rear Sub-part (Universal)", seatRow: "Rear", position: "Universal", category: "Sub-part" },

  { name: "Third Row Headrest (Driver)", seatRow: "Third Row", position: "Driver", category: "Headrest" },
  { name: "Third Row Headrest (Passenger)", seatRow: "Third Row", position: "Passenger", category: "Headrest" },
  { name: "Third Row Headrest (Universal)", seatRow: "Third Row", position: "Universal", category: "Headrest" },
  { name: "Third Row Top Body (Driver)", seatRow: "Third Row", position: "Driver", category: "Top Body" },
  { name: "Third Row Top Body (Passenger)", seatRow: "Third Row", position: "Passenger", category: "Top Body" },
  { name: "Third Row Top Body (Universal)", seatRow: "Third Row", position: "Universal", category: "Top Body" },
  { name: "Third Row Bottom (Driver)", seatRow: "Third Row", position: "Driver", category: "Bottom" },
  { name: "Third Row Bottom (Passenger)", seatRow: "Third Row", position: "Passenger", category: "Bottom" },
  { name: "Third Row Bottom (Universal)", seatRow: "Third Row", position: "Universal", category: "Bottom" },
  { name: "Third Row Middle Headrest", seatRow: "Third Row", position: "Middle", category: "Headrest" },
  { name: "Third Row Middle Top Body", seatRow: "Third Row", position: "Middle", category: "Top Body" },
  { name: "Third Row Middle Bottom", seatRow: "Third Row", position: "Middle", category: "Bottom" },
  { name: "Third Row Console", seatRow: "Third Row", position: "Middle", category: "Console" },
  { name: "Third Row Back Storage (Driver)", seatRow: "Third Row", position: "Driver", category: "Back Storage" },
  { name: "Third Row Back Storage (Passenger)", seatRow: "Third Row", position: "Passenger", category: "Back Storage" },
  { name: "Third Row Back Storage (Universal)", seatRow: "Third Row", position: "Universal", category: "Back Storage" },
  { name: "Third Row Arm (Driver)", seatRow: "Third Row", position: "Driver", category: "Arm" },
  { name: "Third Row Arm (Passenger)", seatRow: "Third Row", position: "Passenger", category: "Arm" },
  { name: "Third Row Arm (Universal)", seatRow: "Third Row", position: "Universal", category: "Arm" },
  { name: "Third Row Sub-part (Driver)", seatRow: "Third Row", position: "Driver", category: "Sub-part" },
  { name: "Third Row Sub-part (Passenger)", seatRow: "Third Row", position: "Passenger", category: "Sub-part" },
  { name: "Third Row Sub-part (Universal)", seatRow: "Third Row", position: "Universal", category: "Sub-part" },
];
