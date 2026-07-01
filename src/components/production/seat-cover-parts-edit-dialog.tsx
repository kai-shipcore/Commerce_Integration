"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiPath } from "@/lib/api-path";

type Tab = "front" | "rear" | "third";

type FormData = Record<string, string>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editData: Record<string, unknown> | null;
  tab: Tab;
  mode?: "add" | "edit";
}

function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function rowToForm(row: Record<string, unknown>): FormData {
  const result: FormData = {};
  for (const [k, v] of Object.entries(row)) {
    result[k] = toStr(v);
  }
  return result;
}

// Paired groups: [driverField, sharedDpField, passengerField]
const PAIRED_ALL: [string, string, string][] = [
  ["headrest",  "headrest_dp_detail",  "headrest2"],
  ["top_body",  "top_body_dp_detail",  "top_body2"],
  ["bottom",    "bottom_dp_detail",    "bottom2"],
  ["armrest",   "armrest_detail",      "armrest2"],
];
const PAIRED_REAR_THIRD: [string, string, string][] = [
  ["backrest_storage", "backrest_storage_dp_detail", "backrest_storage2"],
  ["subpart",          "subpart_dp_detail",           "subpart2"],
];
const UNPAIRED_ALL: [string, string][] = [
  ["middle_headrest", "middle_headrest_detail"],
  ["middle_top_body", "middle_top_body_detail"],
  ["middle_bottom",   "middle_bottom_detail"],
];
const UNPAIRED_REAR_THIRD: [string, string][] = [["console", "console_dp_detail"]];

function buildPackage(data: FormData, tab: Tab): string {
  const entries: string[] = [];
  const paired = tab === "rear" || tab === "third"
    ? [...PAIRED_ALL, ...PAIRED_REAR_THIRD]
    : PAIRED_ALL;

  for (const [f, df, f2] of paired) {
    const val  = data[f]  ?? "";
    const val2 = data[f2] ?? "";
    const det  = data[df] ?? "";
    if (!val && !val2) continue;
    const isDongil    = det === "동일";
    const isDriverRef = det === "Driver 기준 대칭" || det.endsWith("-p");
    const isPsgRef    = det === "Passenger 기준 대칭" || det.endsWith("-d");
    if (isDongil)           entries.push(`${val || val2} *2`);
    else if (isDriverRef)   entries.push(`${val || val2} (D&P / File = Driver)`);
    else if (isPsgRef)      entries.push(`${val || val2} (D&P / File = Passenger)`);
    else if (val === val2 && val) entries.push(`${val} *2`);
    else { if (val) entries.push(val); if (val2) entries.push(val2); }
  }

  const unpaired = tab === "rear" || tab === "third"
    ? [...UNPAIRED_ALL, ...UNPAIRED_REAR_THIRD]
    : UNPAIRED_ALL;
  for (const [f] of unpaired) {
    const val = data[f] ?? "";
    if (val) entries.push(val);
  }

  return entries.join(", ");
}

const SectionHeader = ({ label }: { label: string }) => (
  <div style={{ gridColumn: "1 / -1", marginTop: 8, marginBottom: 2 }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: "#9A9790", textTransform: "uppercase", letterSpacing: "0.06em" }}>
      {label}
    </span>
    <div style={{ borderBottom: "1px solid #E8E6E1", marginTop: 4 }} />
  </div>
);

export function SeatCoverPartsEditDialog({ open, onOpenChange, onSuccess, editData, tab, mode = "edit" }: Props) {
  const [formData, setFormData] = useState<FormData>({});
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Set<string>>(new Set());

  useEffect(() => {
    setErrors(new Set());
    if (mode === "add") {
      setFormData({});
    } else if (editData) {
      setFormData(rowToForm(editData));
    }
  }, [editData, mode, open]);

  // Auto-fill Package whenever part/D/P fields change
  useEffect(() => {
    setFormData((prev) => ({ ...prev, package: buildPackage(prev, tab) }));
  }, [
    formData.headrest,  formData.headrest_dp_detail,  formData.headrest2,
    formData.top_body,  formData.top_body_dp_detail,  formData.top_body2,
    formData.bottom,    formData.bottom_dp_detail,    formData.bottom2,
    formData.armrest,   formData.armrest_detail,      formData.armrest2,
    formData.backrest_storage, formData.backrest_storage_dp_detail, formData.backrest_storage2,
    formData.subpart,   formData.subpart_dp_detail,   formData.subpart2,
    formData.middle_headrest, formData.middle_top_body, formData.middle_bottom,
    formData.console,
    tab,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors.has(name)) setErrors((prev) => { const s = new Set(prev); s.delete(name); return s; });
  };

  const field = (label: string, name: string, readOnly = false, required = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Label htmlFor={name} style={{ fontSize: 11, color: errors.has(name) ? "#dc2626" : "#7A766F" }}>
        {label}{required && <span style={{ color: "#dc2626", marginLeft: 2 }}>*</span>}
      </Label>
      <Input
        id={name}
        name={name}
        value={formData[name] ?? ""}
        onChange={handleChange}
        readOnly={readOnly}
        style={{
          fontSize: 13, height: 30,
          background: readOnly ? "#F5F4EF" : undefined,
          borderColor: errors.has(name) ? "#dc2626" : undefined,
        }}
      />
    </div>
  );

  const partGroup = (label: string, partKey: string) => field(label, partKey);

  const pairedSection = (dKey: string, dpKey: string, pKey: string) => {
    const dpVal = formData[dpKey] ?? "";
    const showDriver    = dpVal !== "Passenger 기준 대칭";
    const showPassenger = dpVal === "Passenger 기준 대칭" || dpVal === "";
    return (
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 16, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Label style={{ fontSize: 11, color: "#7A766F" }}>D/P</Label>
          <select
            name={dpKey}
            value={dpVal}
            onChange={(e) => setFormData((p) => ({ ...p, [dpKey]: e.target.value }))}
            style={{ height: 30, fontSize: 13, width: 180, border: "1px solid #D8D6CE", borderRadius: 6, padding: "0 8px", background: "#fff" }}
          >
            <option value="">—</option>
            <option value="동일">동일</option>
            <option value="Driver 기준 대칭">Driver 기준 대칭</option>
            <option value="Passenger 기준 대칭">Passenger 기준 대칭</option>
          </select>
        </div>
        {showDriver && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
            <Label style={{ fontSize: 11, color: "#1a5cdb" }}>Driver</Label>
            <Input name={dKey} value={formData[dKey] ?? ""} onChange={handleChange} style={{ fontSize: 13, height: 30 }} />
          </div>
        )}
        {showPassenger && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
            <Label style={{ fontSize: 11, color: "#b45309" }}>Passenger</Label>
            <Input name={pKey} value={formData[pKey] ?? ""} onChange={handleChange} style={{ fontSize: 13, height: 30 }} />
          </div>
        )}
      </div>
    );
  };

  const handleSave = async () => {
    if (mode === "add" && !formData["size"]?.trim()) {
      setErrors(new Set(["size"]));
      return;
    }
    setSaving(true);
    try {
      const url = mode === "add"
        ? apiPath(`/api/production/seat-cover-parts?tab=${tab}`)
        : apiPath(`/api/production/seat-cover-parts/${editData?.id}?tab=${tab}`);
      const method = mode === "add" ? "POST" : "PATCH";

      if (mode === "edit" && !editData?.id) return;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const json = await res.json() as { success: boolean };
      if (json.success) {
        onSuccess();
        onOpenChange(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 860, width: "95vw" }}>
        <DialogHeader>
          <DialogTitle style={{ fontSize: 15 }}>
            {mode === "add" ? "Add New Row" : `Edit — ${formData["size"] || ""}`}
          </DialogTitle>
        </DialogHeader>

        <div style={{ height: "68vh", overflowY: "auto", overflowX: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px 20px", padding: "4px 2px 8px" }}>

            <SectionHeader label="Basic Info" />
            {field("Size", "size", mode === "edit", mode === "add")}
            {field("Inventory", "inventory")}
            {field("Confirmed", "confirmed")}
            {field("Blueprint", "blueprint")}
            {field("Manual", "manual")}
            {field("YMM", "ymm")}
            {(tab === "front" || tab === "rear") && field("Fitting D/P Detail", "fitting_dp_detail")}
            {tab === "rear" && field("Added Date", "added_date")}
            <div style={{ gridColumn: "1 / -1" }}>{field("Package", "package")}</div>

            <SectionHeader label="Headrest" />
            {pairedSection("headrest", "headrest_dp_detail", "headrest2")}

            <SectionHeader label="Top / Body" />
            {pairedSection("top_body", "top_body_dp_detail", "top_body2")}

            <SectionHeader label="Bottom" />
            {pairedSection("bottom", "bottom_dp_detail", "bottom2")}

            <SectionHeader label="Middle" />
            {partGroup("Headrest", "middle_headrest")}
            {partGroup("Top / Body", "middle_top_body")}
            {partGroup("Bottom", "middle_bottom")}

            {(tab === "rear" || tab === "third") && (
              <>
                <SectionHeader label="Console / Backrest" />
                {partGroup("Console", "console")}
                <SectionHeader label="Backrest Storage" />
                {pairedSection("backrest_storage", "backrest_storage_dp_detail", "backrest_storage2")}
              </>
            )}

            <SectionHeader label="Armrest" />
            {pairedSection("armrest", "armrest_detail", "armrest2")}

            {(tab === "rear" || tab === "third") && (
              <>
                <SectionHeader label="Subpart" />
                {pairedSection("subpart", "subpart_dp_detail", "subpart2")}
              </>
            )}

            <SectionHeader label="Note" />
            <div style={{ gridColumn: "1 / -1" }}>
              {field("Note", "note")}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
