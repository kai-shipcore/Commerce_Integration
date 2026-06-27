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

  useEffect(() => {
    if (mode === "add") {
      setFormData({});
    } else if (editData) {
      setFormData(rowToForm(editData));
    }
  }, [editData, mode, open]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const field = (label: string, name: string, readOnly = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Label htmlFor={name} style={{ fontSize: 11, color: "#7A766F" }}>{label}</Label>
      <Input
        id={name}
        name={name}
        value={formData[name] ?? ""}
        onChange={handleChange}
        readOnly={readOnly}
        style={{ fontSize: 13, height: 30, background: readOnly ? "#F5F4EF" : undefined }}
      />
    </div>
  );

  const partGroup = (label: string, partKey: string, detailKey: string, qtyKey: string) => (
    <>
      {field(label, partKey)}
      {field("D/P Detail", detailKey)}
      {field("Qty", qtyKey)}
    </>
  );

  const handleSave = async () => {
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
            {field("Size", "size", mode === "edit")}
            {field("Inventory", "inventory")}
            {field("Confirmed", "confirmed")}
            {field("Blueprint", "blueprint")}
            {field("Manual", "manual")}
            {field("YMM", "ymm")}
            {(tab === "front" || tab === "rear") && field("Fitting D/P Detail", "fitting_dp_detail")}
            {tab === "rear" && field("Added Date", "added_date")}
            {field("Package", "package")}

            <SectionHeader label="Headrest" />
            {partGroup("Headrest", "headrest", "headrest_dp_detail", "headrest_qty")}
            {partGroup("Headrest 2", "headrest2", "headrest2_dp_detail", "headrest2_qty")}

            <SectionHeader label="Top / Body" />
            {partGroup("Top / Body", "top_body", "top_body_dp_detail", "top_body_qty")}
            {partGroup("Top / Body 2", "top_body2", "top_body2_dp_detail", "top_body2_qty")}

            <SectionHeader label="Bottom" />
            {partGroup("Bottom", "bottom", "bottom_dp_detail", "bottom_qty")}
            {partGroup("Bottom 2", "bottom2", "bottom2_dp_detail", "bottom2_qty")}

            <SectionHeader label="Middle" />
            {partGroup("Mid. Headrest", "middle_headrest", "middle_headrest_detail", "middle_headrest_qty")}
            {partGroup("Mid. Top / Body", "middle_top_body", "middle_top_body_detail", "middle_top_body_qty")}
            {partGroup("Mid. Bottom", "middle_bottom", "middle_bottom_detail", "middle_bottom_qty")}

            {(tab === "rear" || tab === "third") && (
              <>
                <SectionHeader label="Console / Backrest" />
                {partGroup("Console", "console", "console_dp_detail", "console_qty")}
                {partGroup("Backrest Storage", "backrest_storage", "backrest_storage_dp_detail", "backrest_storage_qty")}
                {partGroup("Backrest Storage 2", "backrest_storage2", "backrest_storage2_dp_detail", "backrest_storage2_qty")}
              </>
            )}

            <SectionHeader label="Armrest" />
            {partGroup("Armrest", "armrest", "armrest_detail", "armrest_qty")}
            {partGroup("Armrest 2", "armrest2", "armrest2_detail", "armrest2_qty")}

            {(tab === "rear" || tab === "third") && (
              <>
                <SectionHeader label="Subpart" />
                {partGroup("Subpart", "subpart", "subpart_dp_detail", "subpart_qty")}
                {partGroup("Subpart 2", "subpart2", "subpart2_dp_detail", "subpart2_qty")}
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
