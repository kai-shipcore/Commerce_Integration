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

type FormData = Record<string, string>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  editData: Record<string, unknown> | null;
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

export function VehicleEditDialog({ open, onOpenChange, onSuccess, editData, mode = "edit" }: Props) {
  const [formData, setFormData] = useState<FormData>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode === "add") {
      setFormData({});
    } else if (editData) {
      setFormData(rowToForm(editData));
    }
    setError("");
  }, [editData, mode, open]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const field = (label: string, name: string, readOnly = false, required = false) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Label htmlFor={name} style={{ fontSize: 11, color: "#7A766F" }}>
        {label}{required && <span style={{ color: "#e05" }}> *</span>}
      </Label>
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

  const submodelPair = (n: number) => (
    <>
      {field(`SM${n} Label`, `submodel_${n}_label`)}
      {field(`Submodel ${n}`, `submodel_${n}`)}
    </>
  );

  const handleSave = async () => {
    setError("");
    if (!formData["f_number"]?.trim()) { setError("F Number is required"); return; }
    if (!formData["make"]?.trim()) { setError("Make is required"); return; }
    if (!formData["model"]?.trim()) { setError("Model is required"); return; }

    setSaving(true);
    try {
      const url = mode === "add"
        ? apiPath("/api/production/product-vehicles")
        : apiPath(`/api/production/product-vehicles/${editData?.id}`);
      const method = mode === "add" ? "POST" : "PATCH";

      if (mode === "edit" && !editData?.id) return;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const json = await res.json() as { success: boolean; error?: string };
      if (json.success) {
        onSuccess();
        onOpenChange(false);
      } else {
        setError(json.error ?? "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 700, width: "95vw" }}>
        <DialogHeader>
          <DialogTitle style={{ fontSize: 15 }}>
            {mode === "add" ? "Add Vehicle" : `Edit — ${formData["f_number"] || ""}`}
          </DialogTitle>
        </DialogHeader>

        <div style={{ height: "65vh", overflowY: "auto", overflowX: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px", padding: "4px 2px 8px" }}>

            <SectionHeader label="Basic Info" />
            {field("F Number", "f_number", mode === "edit", true)}
            {field("Vehicle Type", "vehicle_type")}
            {field("Year / Generation", "year_generation")}
            {field("Make", "make", false, true)}
            {field("Model", "model", false, true)}
            {field("Model 2", "model_2")}

            <SectionHeader label="Submodels" />
            {submodelPair(1)}
            {submodelPair(2)}
            {submodelPair(3)}
            {submodelPair(4)}
            {submodelPair(5)}
            {submodelPair(6)}
          </div>

          {error && (
            <p style={{ color: "#c0392b", fontSize: 13, marginTop: 8, padding: "0 2px" }}>{error}</p>
          )}
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
