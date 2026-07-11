/**
 * Code Guide:
 * Fixed catalog of standard seat-cover part names, mirroring the physical structure of a
 * car seat (row x position x category). This is structural domain vocabulary, not
 * operational data — it doesn't need a DB table / admin UI the way Code or Designer
 * Initial do.
 */

export type SeatCoverPartRow = "Front" | "Rear" | "Second Row" | "Third Row";
export type SeatCoverPartPosition = "Driver" | "Passenger" | "Middle" | "Universal";
export type SeatCoverPartCategory =
  | "Headrest"
  | "Top Body"
  | "Bottom"
  | "Arm"
  | "Console"
  | "Back Storage"
  | "Sub-part"
  | "Leg Support"
  | "Side Bolster";

export type SeatCoverPartOption = {
  name: string;
  seatRow: SeatCoverPartRow;
  position: SeatCoverPartPosition;
  category: SeatCoverPartCategory;
};

export const SEAT_COVER_PART_CATALOG: SeatCoverPartOption[] = [
  { name: "Front Arm", seatRow: "Front", position: "Universal", category: "Arm" },
  { name: "Front Bottom", seatRow: "Front", position: "Universal", category: "Bottom" },
  { name: "Front Headrest", seatRow: "Front", position: "Universal", category: "Headrest" },
  { name: "Front Middle Bottom", seatRow: "Front", position: "Middle", category: "Bottom" },
  { name: "Front Middle Headrest", seatRow: "Front", position: "Middle", category: "Headrest" },
  { name: "Front Middle Top Body", seatRow: "Front", position: "Middle", category: "Top Body" },
  { name: "Front Top Body", seatRow: "Front", position: "Universal", category: "Top Body" },
  { name: "Front Leg Support", seatRow: "Front", position: "Universal", category: "Leg Support" },

  { name: "Rear Arm", seatRow: "Rear", position: "Universal", category: "Arm" },
  { name: "Rear Back Storage", seatRow: "Rear", position: "Universal", category: "Back Storage" },
  { name: "Rear Bottom", seatRow: "Rear", position: "Universal", category: "Bottom" },
  { name: "Rear Console", seatRow: "Rear", position: "Middle", category: "Console" },
  { name: "Rear Headrest", seatRow: "Rear", position: "Universal", category: "Headrest" },
  { name: "Rear Middle Bottom", seatRow: "Rear", position: "Middle", category: "Bottom" },
  { name: "Rear Middle Headrest", seatRow: "Rear", position: "Middle", category: "Headrest" },
  { name: "Rear Middle Top Body", seatRow: "Rear", position: "Middle", category: "Top Body" },
  { name: "Rear Sub-part", seatRow: "Rear", position: "Universal", category: "Sub-part" },
  { name: "Rear Top Body", seatRow: "Rear", position: "Universal", category: "Top Body" },
  { name: "Rear Side Bolster", seatRow: "Rear", position: "Universal", category: "Side Bolster" },
  { name: "Rear Leg Support", seatRow: "Rear", position: "Universal", category: "Leg Support" },

  { name: "Second Row Arm", seatRow: "Second Row", position: "Universal", category: "Arm" },
  { name: "Second Row Back Storage", seatRow: "Second Row", position: "Universal", category: "Back Storage" },
  { name: "Second Row Bottom", seatRow: "Second Row", position: "Universal", category: "Bottom" },
  { name: "Second Row Console", seatRow: "Second Row", position: "Middle", category: "Console" },
  { name: "Second Row Headrest", seatRow: "Second Row", position: "Universal", category: "Headrest" },
  { name: "Second Row Middle Bottom", seatRow: "Second Row", position: "Middle", category: "Bottom" },
  { name: "Second Row Middle Headrest", seatRow: "Second Row", position: "Middle", category: "Headrest" },
  { name: "Second Row Middle Top Body", seatRow: "Second Row", position: "Middle", category: "Top Body" },
  { name: "Second Row Sub-part", seatRow: "Second Row", position: "Universal", category: "Sub-part" },
  { name: "Second Row Top Body", seatRow: "Second Row", position: "Universal", category: "Top Body" },
  { name: "Second Row Side Bolster", seatRow: "Second Row", position: "Universal", category: "Side Bolster" },
  { name: "Second Row Leg Support", seatRow: "Second Row", position: "Universal", category: "Leg Support" },

  { name: "Third Row Arm", seatRow: "Third Row", position: "Universal", category: "Arm" },
  { name: "Third Row Back Storage", seatRow: "Third Row", position: "Universal", category: "Back Storage" },
  { name: "Third Row Bottom", seatRow: "Third Row", position: "Universal", category: "Bottom" },
  { name: "Third Row Console", seatRow: "Third Row", position: "Middle", category: "Console" },
  { name: "Third Row Headrest", seatRow: "Third Row", position: "Universal", category: "Headrest" },
  { name: "Third Row Middle Bottom", seatRow: "Third Row", position: "Middle", category: "Bottom" },
  { name: "Third Row Middle Headrest", seatRow: "Third Row", position: "Middle", category: "Headrest" },
  { name: "Third Row Middle Top Body", seatRow: "Third Row", position: "Middle", category: "Top Body" },
  { name: "Third Row Sub-part", seatRow: "Third Row", position: "Universal", category: "Sub-part" },
  { name: "Third Row Top Body", seatRow: "Third Row", position: "Universal", category: "Top Body" },
  { name: "Third Row Leg Support", seatRow: "Third Row", position: "Universal", category: "Leg Support" },
];
