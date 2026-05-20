"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  containerStatusLabels,
  mockPurchaseOrders,
  mockSkus,
  type ContainerStatus,
  type MockContainer,
  type ProductKey,
} from "@/features/planning/mock-data";

type ContainerItem = MockContainer["items"][number];

type ContainerFormState = {
  number: string;
  poNumbers: string;
  eta: string;
  status: ContainerStatus;
  cbmCapacity: string;
  factory: string;
  origin: string;
  destination: string;
};

const defaultFormState: ContainerFormState = {
  number: "",
  poNumbers: "",
  eta: "",
  status: "draft",
  cbmCapacity: "67.5",
  factory: "",
  origin: "China Guangzhou",
  destination: "",
};

const statusOptions: Array<{ value: ContainerStatus; label: string; shortLabel: string }> = [
  { value: "draft", label: "Container Draft (Pre-Plan)", shortLabel: "Container Draft" },
  { value: "final-list-sent", label: "Final List Sent to Factory", shortLabel: "Final" },
  { value: "packing-list-received", label: "Packing List Received / Shipped", shortLabel: "Packing" },
];

const statusColors: Record<ContainerStatus, string> = {
  draft: "#d4537e",
  "final-list-sent": "#ef9f27",
  "packing-list-received": "#378add",
};

const statusPillClasses: Record<ContainerStatus, string> = {
  draft: "bg-[#fce4ec] text-[#880e4f]",
  "final-list-sent": "bg-[#fef3e2] text-[#8a5300]",
  "packing-list-received": "bg-[#ebf0fd] text-[#1a4db0]",
};

type InlineSkuDraft = {
  sku: string;
  qty: string;
  cbm: string;
};

type InlineEditDraft = {
  sku: string;
  qty: string;
  cbm: string;
};

type SkuMasterLookup = {
  masterSku: string;
  cbmPerUnit: number;
};

type ApiContainer = {
  id: string;
  containerNumber: string;
  etaDate: string | null;
  status: string;
  cbmCapacity: number;
  factoryName: string | null;
  origin: string | null;
  destWarehouse: string | null;
  poNumbers?: string[];
  items?: Array<{ sku: string; qty: number; cbm: number }>;
};

type WarehouseOption = {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  isActive: boolean;
};

const productBadgeClasses: Record<ProductKey, string> = {
  sc: "bg-[#e6f5f0] text-[#0a5e45]",
  cc: "bg-[#ebf0fd] text-[#1a4db0]",
  fm: "bg-[#fef3e2] text-[#8a5300]",
};

function inferProductKey(sku: string): ProductKey {
  const matchedSku = mockSkus.find((item) => item.id === sku);
  if (matchedSku) return matchedSku.product;
  if (sku.startsWith("CC")) return "cc";
  if (sku.startsWith("CA-FM")) return "fm";
  return "sc";
}

function splitPoNumbers(value: string) {
  return value
    .split(",")
    .map((po) => po.trim())
    .filter(Boolean);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function normalizeContainerStatus(status: string): ContainerStatus {
  const normalized = status.toLowerCase().replace(/_/g, "-");
  if (normalized === "final-list-sent" || normalized === "final" || normalized === "sent") {
    return "final-list-sent";
  }
  if (
    normalized === "packing-list-received" ||
    normalized === "packing-list" ||
    normalized === "shipped" ||
    normalized === "received"
  ) {
    return "packing-list-received";
  }
  return "draft";
}

function mapApiContainer(container: ApiContainer): MockContainer {
  return {
    id: container.id,
    number: container.containerNumber,
    poNumbers: container.poNumbers ?? [],
    eta: container.etaDate ?? "",
    status: normalizeContainerStatus(container.status),
    cbmCapacity: container.cbmCapacity || 67.5,
    factory: container.factoryName ?? "",
    destination: container.destWarehouse ?? "",
    items: (container.items ?? []).map((item) => ({
      sku: item.sku,
      qty: Number(item.qty ?? 0),
      cbm: Number(item.cbm ?? 0),
    })),
  };
}

function parseNumberCell(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function ContainerPlanningPage() {
  const [containers, setContainers] = useState<MockContainer[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingContainers, setLoadingContainers] = useState(true);
  const [containersError, setContainersError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<ContainerFormState>(defaultFormState);
  const [selectedPoIds, setSelectedPoIds] = useState<string[]>([]);
  const [draftItems, setDraftItems] = useState<ContainerItem[]>([]);
  const [skuInput, setSkuInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [cbmInput, setCbmInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [nextContainerSeq, setNextContainerSeq] = useState(1);
  const [query, setQuery] = useState("");
  const [inlineSkuDrafts, setInlineSkuDrafts] = useState<Record<string, InlineSkuDraft | undefined>>({});
  const [inlineEditDrafts, setInlineEditDrafts] = useState<Record<string, InlineEditDraft | undefined>>({});

  const totalUnits = containers.reduce(
    (sum, container) => sum + container.items.reduce((inner, item) => inner + item.qty, 0),
    0
  );
  const totalCbm = containers.reduce(
    (sum, container) =>
      sum + container.items.reduce((inner, item) => inner + item.qty * item.cbm, 0),
    0
  );
  const activeContainers = containers.filter((container) => container.status !== "packing-list-received").length;
  const filteredContainers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return containers;

    return containers.filter((container) =>
      [
        container.number,
        container.destination,
        container.factory,
        container.eta,
        ...container.poNumbers,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [containers, query]);
  const selectedContainer = containers.find((container) => container.id === expandedId) ?? null;
  const selectedPurchaseOrders = useMemo(
    () => mockPurchaseOrders.filter((po) => selectedPoIds.includes(po.id)),
    [selectedPoIds]
  );
  const warehouseNameByCode = useMemo(
    () => new Map(warehouses.map((warehouse) => [warehouse.warehouseCode, warehouse.warehouseName])),
    [warehouses]
  );
  const draftCbm = draftItems.reduce((sum, item) => sum + item.qty * item.cbm, 0);
  const draftQty = draftItems.reduce((sum, item) => sum + item.qty, 0);
  const cbmCapacity = Number.parseFloat(form.cbmCapacity) || 67.5;

  async function fetchContainers() {
    setLoadingContainers(true);
    setContainersError(null);
    try {
      const response = await fetch("/api/containers?includeReceived=true&includeDetails=true", {
        cache: "no-store",
      });
      const json = await response.json();

      if (!json.success) {
        throw new Error(json.error ?? "Failed to fetch containers");
      }

      const nextContainers = (json.data as ApiContainer[]).map(mapApiContainer);
      setContainers(nextContainers);
      setExpandedId((current) => {
        if (current && nextContainers.some((container) => container.id === current)) return current;
        return nextContainers[0]?.id ?? null;
      });
      setNextContainerSeq(nextContainers.length + 1);
    } catch (error) {
      setContainersError(error instanceof Error ? error.message : "Failed to fetch containers");
      setContainers([]);
      setExpandedId(null);
    } finally {
      setLoadingContainers(false);
    }
  }

  async function fetchWarehouses() {
    setLoadingWarehouses(true);
    try {
      const response = await fetch("/api/warehouses?active=true", { cache: "no-store" });
      const json = await response.json();

      if (json.success) {
        setWarehouses((json.data as WarehouseOption[]).filter((warehouse) => warehouse.isActive));
      } else {
        setWarehouses([]);
      }
    } catch {
      setWarehouses([]);
    } finally {
      setLoadingWarehouses(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchContainers();
    void fetchWarehouses();
  }, []);

  useEffect(() => {
    if (!isFormOpen || form.destination || !warehouses[0]) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((current) => ({ ...current, destination: warehouses[0].warehouseCode }));
  }, [form.destination, isFormOpen, warehouses]);

  function openForm() {
    setForm({
      ...defaultFormState,
      destination: warehouses[0]?.warehouseCode ?? "",
    });
    setSelectedPoIds([]);
    setDraftItems([]);
    setSkuInput("");
    setQtyInput("");
    setCbmInput("");
    setFormError(null);
    setIsFormOpen(true);
  }

  function closeForm() {
    setIsFormOpen(false);
    setFormError(null);
  }

  function updateForm<K extends keyof ContainerFormState>(key: K, value: ContainerFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePurchaseOrder(poId: string) {
    setSelectedPoIds((current) => {
      const next = current.includes(poId)
        ? current.filter((id) => id !== poId)
        : [...current, poId];
      const poNumbers = mockPurchaseOrders
        .filter((po) => next.includes(po.id))
        .map((po) => po.number)
        .join(", ");
      setForm((formState) => ({ ...formState, poNumbers }));
      return next;
    });
  }

  async function lookupSkuMaster(masterSku: string): Promise<SkuMasterLookup | null> {
    const sku = masterSku.trim().toUpperCase();
    if (!sku) return null;

    try {
      const response = await fetch(`/api/planning/sku-master?masterSku=${encodeURIComponent(sku)}`, {
        cache: "no-store",
      });
      const json = await response.json();
      return response.ok && json.success ? (json.data as SkuMasterLookup) : null;
    } catch {
      return null;
    }
  }

  async function updateSkuMasterCbm(masterSku: string, cbm: number): Promise<string | null> {
    const sku = masterSku.trim().toUpperCase();
    if (!sku) return "Master SKU is required.";
    if (!Number.isFinite(cbm) || cbm <= 0) return "CBM must be greater than 0.";

    try {
      const response = await fetch("/api/planning/sku-master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          masterSku: sku,
          cbmPerUnit: cbm,
        }),
      });
      const json = await response.json();

      if (!response.ok || !json.success) {
        return json.error ?? `Failed to update SKU master CBM for ${sku}`;
      }

      return null;
    } catch {
      return `Failed to update SKU master CBM for ${sku}`;
    }
  }

  async function validateContainerSkus(items: Array<{ sku: string }>) {
    const distinctSkus = [...new Set(items.map((item) => item.sku.trim().toUpperCase()).filter(Boolean))];
    const results = await Promise.all(
      distinctSkus.map(async (sku) => ((await lookupSkuMaster(sku)) ? null : sku))
    );
    return results.filter((sku): sku is string => Boolean(sku));
  }

  async function fillCreateSkuCbm() {
    const sku = skuInput.trim().toUpperCase();
    if (!sku) return;

    const found = await lookupSkuMaster(sku);
    if (!found) {
      setSkuInput(sku);
      setCbmInput("");
      setFormError(`SKU not found in SKU Master: ${sku}`);
      return;
    }

    setSkuInput(found.masterSku);
    setCbmInput(found.cbmPerUnit ? String(found.cbmPerUnit) : "");
    setFormError(null);
  }

  async function updateCreateSkuCbm() {
    const sku = skuInput.trim().toUpperCase();
    const cbm = Number.parseFloat(cbmInput);
    if (!sku || !cbmInput) return;

    const error = await updateSkuMasterCbm(sku, cbm);
    setFormError(error);
  }

  async function addSkuToDraft() {
    const sku = skuInput.trim().toUpperCase();
    const qty = Number.parseInt(qtyInput, 10);

    if (!sku) {
      setFormError("Master SKU를 입력하세요.");
      return;
    }

    const found = await lookupSkuMaster(sku);
    if (!found) {
      setFormError(`SKU not found in SKU Master: ${sku}`);
      return;
    }

    const cbm = cbmInput ? Number.parseFloat(cbmInput) : found.cbmPerUnit;

    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError("수량은 1개 이상이어야 합니다.");
      return;
    }

    if (!Number.isFinite(cbm) || cbm <= 0) {
      setFormError("CBM은 0보다 큰 값이어야 합니다.");
      return;
    }

    const cbmUpdateError = await updateSkuMasterCbm(found.masterSku, cbm);
    if (cbmUpdateError) {
      setFormError(cbmUpdateError);
      return;
    }

    setDraftItems((items) => {
      const existing = items.find((item) => item.sku === found.masterSku);
      if (existing) {
        return items.map((item) =>
          item.sku === found.masterSku ? { ...item, qty: item.qty + qty, cbm } : item
        );
      }
      return [...items, { sku: found.masterSku, qty, cbm }];
    });
    setSkuInput("");
    setQtyInput("");
    setCbmInput("");
    setFormError(null);
  }

  function removeDraftItem(sku: string) {
    setDraftItems((items) => items.filter((item) => item.sku !== sku));
  }

  async function saveContainer() {
    const number = form.number.trim();
    const eta = form.eta.trim();

    if (!number) {
      setFormError("컨테이너 번호를 입력하세요.");
      return;
    }

    if (!eta) {
      setFormError("ETA를 선택하세요.");
      return;
    }

    if (draftItems.length === 0) {
      setFormError("SKU를 하나 이상 추가하세요.");
      return;
    }

    const missingSkus = await validateContainerSkus(draftItems);
    if (missingSkus.length > 0) {
      setFormError(`Cannot save container. SKU not found in SKU Master: ${missingSkus.join(", ")}`);
      return;
    }

    const newContainer: MockContainer = {
      id: `container-new-${nextContainerSeq}`,
      number,
      poNumbers: splitPoNumbers(form.poNumbers),
      eta,
      status: form.status,
      cbmCapacity,
      factory: form.factory.trim() || "Unassigned Factory",
      destination: form.destination,
      items: draftItems,
    };

    setContainers((current) => [newContainer, ...current]);
    setNextContainerSeq((current) => current + 1);
    setExpandedId(newContainer.id);
    closeForm();
  }

  function deleteContainerItem(containerId: string, sku: string) {
    if (!window.confirm(`${sku}를 삭제하시겠습니까?`)) return;

    setContainers((current) =>
      current.map((item) =>
        item.id === containerId
          ? { ...item, items: item.items.filter((line) => line.sku !== sku) }
          : item
      )
    );
  }

  function editDraftKey(containerId: string, sku: string) {
    return `${containerId}::${sku}`;
  }

  function startInlineEdit(containerId: string, item: ContainerItem) {
    setInlineEditDrafts((current) => ({
      ...current,
      [editDraftKey(containerId, item.sku)]: {
        sku: item.sku,
        qty: String(item.qty),
        cbm: String(item.cbm),
      },
    }));
  }

  function updateInlineEditDraft(containerId: string, sku: string, patch: Partial<InlineEditDraft>) {
    const key = editDraftKey(containerId, sku);
    setInlineEditDrafts((current) => ({
      ...current,
      [key]: { sku, qty: "", cbm: "", ...current[key], ...patch },
    }));
  }

  function cancelInlineEdit(containerId: string, sku: string) {
    const key = editDraftKey(containerId, sku);
    setInlineEditDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function saveInlineEdit(containerId: string, originalSku: string) {
    const key = editDraftKey(containerId, originalSku);
    const draft = inlineEditDrafts[key];
    if (!draft) return;

    const nextSku = draft.sku.trim().toUpperCase();
    const qty = Number.parseInt(draft.qty, 10);

    if (!nextSku) {
      window.alert("Master SKU를 입력하세요.");
      return;
    }

    const found = await lookupSkuMaster(nextSku);
    if (!found) {
      window.alert(`SKU not found in SKU Master: ${nextSku}`);
      return;
    }

    const cbm = draft.cbm ? Number.parseFloat(draft.cbm) : found.cbmPerUnit;

    if (!Number.isFinite(qty) || qty <= 0) {
      window.alert("수량은 1개 이상이어야 합니다.");
      return;
    }

    if (!Number.isFinite(cbm) || cbm <= 0) {
      window.alert("CBM은 0보다 큰 값이어야 합니다.");
      return;
    }

    const cbmUpdateError = await updateSkuMasterCbm(found.masterSku, cbm);
    if (cbmUpdateError) {
      window.alert(cbmUpdateError);
      return;
    }

    setContainers((current) =>
      current.map((container) =>
        container.id === containerId
          ? {
              ...container,
              items: container.items.map((item) =>
                item.sku === originalSku ? { sku: found.masterSku, qty, cbm } : item
              ),
            }
          : container
      )
    );
    cancelInlineEdit(containerId, originalSku);
  }

  function mergeContainerItems(containerId: string, itemsToMerge: ContainerItem[]) {
    setContainers((current) =>
      current.map((container) => {
        if (container.id !== containerId) return container;

        const mergedItems = [...container.items];
        for (const nextItem of itemsToMerge) {
          const existingIndex = mergedItems.findIndex((item) => item.sku === nextItem.sku);
          if (existingIndex >= 0) {
            mergedItems[existingIndex] = {
              ...mergedItems[existingIndex],
              qty: mergedItems[existingIndex].qty + nextItem.qty,
              cbm: nextItem.cbm,
            };
          } else {
            mergedItems.push(nextItem);
          }
        }

        return { ...container, items: mergedItems };
      })
    );
  }

  function startInlineSkuAdd(containerId: string) {
    setInlineSkuDrafts((current) => ({
      ...current,
      [containerId]: current[containerId] ?? { sku: "", qty: "", cbm: "" },
    }));
  }

  function updateInlineSkuDraft(containerId: string, patch: Partial<InlineSkuDraft>) {
    setInlineSkuDrafts((current) => ({
      ...current,
      [containerId]: { sku: "", qty: "", cbm: "", ...current[containerId], ...patch },
    }));
  }

  async function fillInlineSkuCbm(containerId: string) {
    const draft = inlineSkuDrafts[containerId];
    const sku = draft?.sku.trim().toUpperCase();
    if (!sku) return;

    const found = await lookupSkuMaster(sku);
    if (!found) {
      window.alert(`SKU not found in SKU Master: ${sku}`);
      updateInlineSkuDraft(containerId, { sku, cbm: "" });
      return;
    }

    updateInlineSkuDraft(containerId, {
      sku: found.masterSku,
      cbm: found.cbmPerUnit ? String(found.cbmPerUnit) : "",
    });
  }

  async function updateInlineSkuCbm(containerId: string) {
    const draft = inlineSkuDrafts[containerId];
    const sku = draft?.sku.trim().toUpperCase();
    const cbm = Number.parseFloat(draft?.cbm ?? "");
    if (!sku || !draft?.cbm) return;

    const error = await updateSkuMasterCbm(sku, cbm);
    if (error) window.alert(error);
  }

  async function fillInlineEditCbm(containerId: string, originalSku: string) {
    const key = editDraftKey(containerId, originalSku);
    const draft = inlineEditDrafts[key];
    const sku = draft?.sku.trim().toUpperCase();
    if (!sku) return;

    const found = await lookupSkuMaster(sku);
    if (!found) {
      window.alert(`SKU not found in SKU Master: ${sku}`);
      updateInlineEditDraft(containerId, originalSku, { sku, cbm: "" });
      return;
    }

    updateInlineEditDraft(containerId, originalSku, {
      sku: found.masterSku,
      cbm: found.cbmPerUnit ? String(found.cbmPerUnit) : "",
    });
  }

  async function updateInlineEditCbm(containerId: string, originalSku: string) {
    const key = editDraftKey(containerId, originalSku);
    const draft = inlineEditDrafts[key];
    const sku = draft?.sku.trim().toUpperCase();
    const cbm = Number.parseFloat(draft?.cbm ?? "");
    if (!sku || !draft?.cbm) return;

    const error = await updateSkuMasterCbm(sku, cbm);
    if (error) window.alert(error);
  }

  function cancelInlineSkuAdd(containerId: string) {
    setInlineSkuDrafts((current) => {
      const next = { ...current };
      delete next[containerId];
      return next;
    });
  }

  async function saveInlineSkuAdd(containerId: string) {
    const draft = inlineSkuDrafts[containerId];
    if (!draft) return;

    const sku = draft.sku.trim().toUpperCase();
    const qty = Number.parseInt(draft.qty, 10);

    if (!sku) {
      window.alert("Master SKU를 입력하세요.");
      return;
    }

    const found = await lookupSkuMaster(sku);
    if (!found) {
      window.alert(`SKU not found in SKU Master: ${sku}`);
      return;
    }

    const cbm = draft.cbm ? Number.parseFloat(draft.cbm) : found.cbmPerUnit;

    if (!Number.isFinite(qty) || qty <= 0) {
      window.alert("수량은 1개 이상이어야 합니다.");
      return;
    }

    if (!Number.isFinite(cbm) || cbm <= 0) {
      window.alert("CBM은 0보다 큰 값이어야 합니다.");
      return;
    }

    const cbmUpdateError = await updateSkuMasterCbm(found.masterSku, cbm);
    if (cbmUpdateError) {
      window.alert(cbmUpdateError);
      return;
    }

    mergeContainerItems(containerId, [{ sku: found.masterSku, qty, cbm }]);
    cancelInlineSkuAdd(containerId);
  }

  async function importContainerItems(containerId: string, file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    let rows: unknown[][] = [];

    if (extension === "csv") {
      const text = await file.text();
      rows = text
        .split(/\r?\n/)
        .map((line) => line.split(",").map((cell) => cell.trim()))
        .filter((row) => row.some(Boolean));
    } else {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][];
    }

    const parsedItems = rows
      .slice(1)
      .map((row) => {
        const sku = String(row[0] ?? "").trim().toUpperCase();
        const qty = Math.trunc(parseNumberCell(row[1]));
        const cbm = parseNumberCell(row[2]);
        return { sku, qty, cbm };
      })
      .filter((item) => Boolean(item.sku) && item.qty > 0);

    const importedItems = await Promise.all(
      parsedItems.map(async (item) => {
        const found = await lookupSkuMaster(item.sku);
        if (!found) return null;
        const cbm = item.cbm > 0 ? item.cbm : found.cbmPerUnit;
        return cbm > 0 ? { sku: found.masterSku, qty: item.qty, cbm } : null;
      })
    );
    const validImportedItems = importedItems.filter((item): item is ContainerItem => Boolean(item));
    const missingSkus = parsedItems
      .filter((item) => !validImportedItems.some((validItem) => validItem.sku === item.sku))
      .map((item) => item.sku);

    if (missingSkus.length > 0) {
      window.alert(`Cannot import. SKU not found in SKU Master: ${[...new Set(missingSkus)].join(", ")}`);
      return;
    }

    if (validImportedItems.length === 0) {
      window.alert("가져올 SKU가 없습니다. 첫 행은 헤더, 컬럼은 SKU / Qty / CBM 순서로 넣어주세요.");
      return;
    }

    mergeContainerItems(containerId, validImportedItems);
    window.alert(`${validImportedItems.length}개 SKU를 가져왔습니다.`);
  }

  return (
    <section className="container-planning-fullbleed flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">Container Planning</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Register inbound containers, assign PO/SKU quantities, and monitor packing-list status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="form-input h-9 w-72 bg-white"
            placeholder="Search container / PO / warehouse..."
          />
          <button
            type="button"
            onClick={openForm}
            className="rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
          >
            + Add Container
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 border-b border-[#e2dfd8] bg-[#f0eee9] md:grid-cols-4">
        <ContainerStat label="Total Containers" value={containers.length} sub="Registered plans" />
        <ContainerStat label="Inbound Units" value={formatNumber(totalUnits)} sub="Across all SKUs" />
        <ContainerStat label="Total CBM" value={totalCbm.toFixed(2)} sub="Current usage" />
        <ContainerStat label="Active Containers" value={activeContainers} sub="Draft / in progress" />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 bg-white lg:grid-cols-[420px_1fr]">
        <aside className="border-r border-[#e2dfd8] bg-white">
          <div className="flex items-center justify-between border-b border-[#e2dfd8] px-4 py-3">
            <span className="text-sm font-semibold text-muted-foreground">
              {filteredContainers.length} containers
            </span>
            <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
              {statusOptions.map((status) => (
                <span key={status.value} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColors[status.value] }} />
                  {status.shortLabel}
                </span>
              ))}
            </div>
          </div>

          <div className="h-full overflow-y-auto">
            {loadingContainers ? (
              <div className="p-5 text-center text-xs text-muted-foreground">Loading containers from database...</div>
            ) : containersError ? (
              <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
                {containersError}
              </div>
            ) : filteredContainers.length > 0 ? (
              filteredContainers.map((container) => {
                const totalQtyForContainer = container.items.reduce((sum, item) => sum + item.qty, 0);
                const usedCbmForContainer = container.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);
                const destinationLabel = warehouseNameByCode.get(container.destination) ?? container.destination;
                return (
                  <button
                    key={container.id}
                    type="button"
                    onClick={() => {
                      setExpandedId(container.id);
                      setIsFormOpen(false);
                    }}
                    className={`flex w-full items-start gap-3 border-b border-[#e2dfd8] px-4 py-3 text-left transition-colors hover:bg-[#f0eee9] ${
                      selectedContainer?.id === container.id && !isFormOpen ? "border-l-4 border-l-[#1a5cdb] bg-[#ebf0fd]" : ""
                    }`}
                  >
                    <span
                      className="mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-black/10"
                      style={{
                        backgroundColor: statusColors[container.status],
                        boxShadow: `0 0 0 3px ${statusColors[container.status]}30`,
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold">{container.number}</span>
                        <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusPillClasses[container.status]}`}>
                          {containerStatusLabels[container.status]}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {container.poNumbers.length > 0 ? container.poNumbers.join(" / ") : "No PO"} / {destinationLabel}
                      </span>
                      <span className="mt-1 block text-[10px] text-muted-foreground">
                        ETA {container.eta} / {container.items.length} SKUs / {formatNumber(totalQtyForContainer)} units / {usedCbmForContainer.toFixed(1)} CBM
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="p-5">
                <button
                  type="button"
                  onClick={openForm}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#cccac4] bg-[#f0eee9] p-10 text-center text-muted-foreground transition-colors hover:border-[#1a5cdb] hover:bg-[#ebf0fd] hover:text-[#1a4db0]"
                >
                  <span className="text-3xl">+</span>
                  <span className="text-sm font-semibold">No containers found in Database</span>
                  <span className="text-xs">Click + Add Container, or insert records into the database</span>
                </button>
              </div>
            )}
          </div>
        </aside>

        <main className="min-w-0 bg-white">
          {isFormOpen ? (
            <div className="h-full overflow-y-auto px-7 py-6">
              <ContainerCreateForm
                form={form}
                formError={formError}
                selectedPoIds={selectedPoIds}
                selectedPurchaseOrders={selectedPurchaseOrders}
                draftItems={draftItems}
                skuInput={skuInput}
                qtyInput={qtyInput}
                cbmInput={cbmInput}
                draftQty={draftQty}
                draftCbm={draftCbm}
                cbmCapacity={cbmCapacity}
                warehouses={warehouses}
                loadingWarehouses={loadingWarehouses}
                onClose={closeForm}
                onSave={saveContainer}
                onTogglePurchaseOrder={togglePurchaseOrder}
                onUpdateForm={updateForm}
                onRemoveDraftItem={removeDraftItem}
                onSkuInputChange={setSkuInput}
                onSkuInputBlur={fillCreateSkuCbm}
                onQtyInputChange={setQtyInput}
                onCbmInputChange={setCbmInput}
                onCbmInputBlur={updateCreateSkuCbm}
                onAddSkuToDraft={addSkuToDraft}
              />
            </div>
          ) : loadingContainers ? (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="text-sm font-medium">Loading container details...</div>
              <div className="text-xs">Reading fc_containers, fc_container_items, and fc_container_po_links</div>
            </div>
          ) : selectedContainer ? (
            <div className="h-full overflow-y-auto px-7 py-6">
              <ContainerCard
                container={selectedContainer}
                expanded
                onToggle={() => undefined}
                inlineEditDrafts={inlineEditDrafts}
                onStartEditItem={startInlineEdit}
                onUpdateInlineEditDraft={updateInlineEditDraft}
                onSaveInlineEditDraft={saveInlineEdit}
                onFillInlineEditCbm={fillInlineEditCbm}
                onUpdateInlineEditCbm={updateInlineEditCbm}
                onCancelInlineEditDraft={cancelInlineEdit}
                onDeleteItem={deleteContainerItem}
                inlineSkuDraft={inlineSkuDrafts[selectedContainer.id]}
                onStartAddItem={startInlineSkuAdd}
                onUpdateInlineSkuDraft={updateInlineSkuDraft}
                onSaveInlineSkuDraft={saveInlineSkuAdd}
                onFillInlineSkuCbm={fillInlineSkuCbm}
                onUpdateInlineSkuCbm={updateInlineSkuCbm}
                onCancelInlineSkuDraft={cancelInlineSkuAdd}
                onImportItems={importContainerItems}
                warehouseNameByCode={warehouseNameByCode}
                detailMode
              />
            </div>
          ) : (
            <div className="flex h-full min-h-[520px] flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="text-5xl opacity-50">▦</div>
              <div className="text-sm font-medium">Select a container or add a new one</div>
              <div className="text-xs">Click a container in the left list to view SKU details</div>
              <button
                type="button"
                onClick={openForm}
                className="mt-2 rounded-md bg-[#1a5cdb] px-3 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
              >
                + Add Container
              </button>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}


function ContainerStat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function ContainerCreateForm({
  form,
  formError,
  selectedPoIds,
  selectedPurchaseOrders,
  draftItems,
  skuInput,
  qtyInput,
  cbmInput,
  draftQty,
  draftCbm,
  cbmCapacity,
  warehouses,
  loadingWarehouses,
  onClose,
  onSave,
  onTogglePurchaseOrder,
  onUpdateForm,
  onRemoveDraftItem,
  onSkuInputChange,
  onSkuInputBlur,
  onQtyInputChange,
  onCbmInputChange,
  onCbmInputBlur,
  onAddSkuToDraft,
}: {
  form: ContainerFormState;
  formError: string | null;
  selectedPoIds: string[];
  selectedPurchaseOrders: typeof mockPurchaseOrders;
  draftItems: ContainerItem[];
  skuInput: string;
  qtyInput: string;
  cbmInput: string;
  draftQty: number;
  draftCbm: number;
  cbmCapacity: number;
  warehouses: WarehouseOption[];
  loadingWarehouses: boolean;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onTogglePurchaseOrder: (poId: string) => void;
  onUpdateForm: <K extends keyof ContainerFormState>(key: K, value: ContainerFormState[K]) => void;
  onRemoveDraftItem: (sku: string) => void;
  onSkuInputChange: (value: string) => void;
  onSkuInputBlur: () => void | Promise<void>;
  onQtyInputChange: (value: string) => void;
  onCbmInputChange: (value: string) => void;
  onCbmInputBlur: () => void | Promise<void>;
  onAddSkuToDraft: () => void | Promise<void>;
}) {
  return (
    <div className="relative rounded-xl border-2 border-dashed border-[#cccac4] bg-white p-5">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e2dfd8] pb-4 pr-10">
        <div>
          <div className="text-base font-semibold">New Container Registration</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Enter the packing-list quantity directly. It may differ from PO quantity.
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close container form"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-[#cccac4] bg-white text-lg leading-none text-muted-foreground transition-colors hover:bg-[#f0eee9] hover:text-foreground"
        >
          ×
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-[#cccac4] bg-[#f0eee9] p-3">
        <div className="mb-2 text-sm font-semibold text-muted-foreground">
          Related Purchase Orders (multiple selection available)
        </div>
        <div className="flex min-h-8 flex-wrap gap-2">
          {mockPurchaseOrders.map((po) => (
            <button
              key={po.id}
              type="button"
              onClick={() => onTogglePurchaseOrder(po.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                selectedPoIds.includes(po.id)
                  ? "border-[#1a5cdb] bg-[#ebf0fd] text-[#1a4db0]"
                  : "border-[#cccac4] bg-white text-muted-foreground"
              }`}
            >
              {po.number} · {po.factory}
            </button>
          ))}
        </div>
        {selectedPurchaseOrders.length > 0 ? (
          <div className="mt-3 rounded-md bg-white p-3 text-xs text-muted-foreground">
            {selectedPurchaseOrders.map((po) => (
              <div key={po.id}>
                {po.number}: ETA {po.eta}, {po.destination}, {po.items.length} SKU
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Container No.">
          <input className="form-input bg-white" value={form.number} onChange={(event) => onUpdateForm("number", event.target.value)} placeholder="#165" />
        </Field>
        <Field label="PO No. (comma separated)">
          <input className="form-input bg-white" value={form.poNumbers} onChange={(event) => onUpdateForm("poNumbers", event.target.value)} placeholder="PO-2026-041, PO-2026-042" />
        </Field>
        <Field label="ETA">
          <input className="form-input bg-white" type="date" value={form.eta} onChange={(event) => onUpdateForm("eta", event.target.value)} />
        </Field>
        <Field label="Status">
          <select className="form-input bg-white" value={form.status} onChange={(event) => onUpdateForm("status", event.target.value as ContainerStatus)}>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Field>
        <Field label="CBM Capacity">
          <input className="form-input bg-white" type="number" step="0.1" value={form.cbmCapacity} onChange={(event) => onUpdateForm("cbmCapacity", event.target.value)} placeholder="67.5" />
        </Field>
        <Field label="Factory">
          <input className="form-input bg-white" value={form.factory} onChange={(event) => onUpdateForm("factory", event.target.value)} placeholder="Guangzhou A Factory" />
        </Field>
        <Field label="Origin">
          <input className="form-input bg-white" value={form.origin} onChange={(event) => onUpdateForm("origin", event.target.value)} placeholder="China Guangzhou" />
        </Field>
        <Field label="Destination Warehouse">
          <select className="form-input bg-white" value={form.destination} onChange={(event) => onUpdateForm("destination", event.target.value)}>
            {loadingWarehouses ? (
              <option value="">Loading warehouses...</option>
            ) : warehouses.length > 0 ? (
              warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.warehouseCode}>
                  {warehouse.warehouseName}
                </option>
              ))
            ) : (
              <option value="">No active warehouses</option>
            )}
          </select>
        </Field>
      </div>

      <div className="mt-4 border-t border-[#e2dfd8] pt-4">
        <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-semibold text-muted-foreground">SKU Quantity Entry</div>
          <div className="text-xs text-muted-foreground">PackingList CSV/Excel import will be connected in the next step.</div>
        </div>

        {draftItems.length > 0 ? (
          <div className="mb-3 space-y-2">
            {draftItems.map((item) => (
              <div key={item.sku} className="grid grid-cols-[2fr_0.8fr_0.8fr_1fr_auto] items-center gap-2 rounded-lg bg-[#f0eee9] px-3 py-2 text-sm">
                <span className="font-mono text-xs font-medium">{item.sku}</span>
                <span>{item.qty} units</span>
                <span>{item.cbm.toFixed(4)} CBM/unit</span>
                <span>{(item.qty * item.cbm).toFixed(2)} CBM</span>
                <button type="button" onClick={() => onRemoveDraftItem(item.sku)} className="text-sm font-semibold text-[#c42b2b]">×</button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid items-end gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
          <Field label="Master SKU">
            <input
              className="form-input bg-white font-mono"
              value={skuInput}
              onChange={(event) => {
                const nextSku = event.target.value;
                onSkuInputChange(nextSku);
              }}
              onBlur={() => void onSkuInputBlur()}
              placeholder="CA-SC-10-F-10-BK-1TO"
            />
          </Field>
          <Field label="Quantity">
            <input className="form-input bg-white" type="number" value={qtyInput} onChange={(event) => onQtyInputChange(event.target.value)} placeholder="50" />
          </Field>
          <Field label="CBM (auto-detect)">
            <input className="form-input bg-white" type="number" step="0.001" value={cbmInput} onChange={(event) => onCbmInputChange(event.target.value)} onBlur={() => void onCbmInputBlur()} placeholder="Auto" />
          </Field>
          <button type="button" onClick={() => void onAddSkuToDraft()} className="rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1650c4]">
            + Add
          </button>
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          Current input: {formatNumber(draftQty)} units · {draftCbm.toFixed(2)} / {cbmCapacity.toFixed(1)} CBM
        </div>
      </div>

      {formError ? <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div> : null}

      <div className="mt-4 flex gap-2 border-t border-[#e2dfd8] pt-4">
        <button type="button" onClick={onClose} className="rounded-md border border-[#cccac4] bg-white px-4 py-2 text-sm font-medium hover:bg-[#f0eee9]">
          Cancel
        </button>
        <button type="button" onClick={() => void onSave()} className="rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1650c4]">
          Save
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function ContainerCard({
  container,
  expanded,
  onToggle,
  inlineEditDrafts,
  onStartEditItem,
  onUpdateInlineEditDraft,
  onSaveInlineEditDraft,
  onFillInlineEditCbm,
  onUpdateInlineEditCbm,
  onCancelInlineEditDraft,
  onDeleteItem,
  inlineSkuDraft,
  onStartAddItem,
  onUpdateInlineSkuDraft,
  onSaveInlineSkuDraft,
  onFillInlineSkuCbm,
  onUpdateInlineSkuCbm,
  onCancelInlineSkuDraft,
  onImportItems,
  warehouseNameByCode,
  detailMode = false,
}: {
  container: MockContainer;
  expanded: boolean;
  onToggle: () => void;
  inlineEditDrafts: Record<string, InlineEditDraft | undefined>;
  onStartEditItem: (containerId: string, item: ContainerItem) => void;
  onUpdateInlineEditDraft: (containerId: string, sku: string, patch: Partial<InlineEditDraft>) => void;
  onSaveInlineEditDraft: (containerId: string, sku: string) => void | Promise<void>;
  onFillInlineEditCbm: (containerId: string, sku: string) => void | Promise<void>;
  onUpdateInlineEditCbm: (containerId: string, sku: string) => void | Promise<void>;
  onCancelInlineEditDraft: (containerId: string, sku: string) => void;
  onDeleteItem: (containerId: string, sku: string) => void;
  inlineSkuDraft?: InlineSkuDraft;
  onStartAddItem: (containerId: string) => void;
  onUpdateInlineSkuDraft: (containerId: string, patch: Partial<InlineSkuDraft>) => void;
  onSaveInlineSkuDraft: (containerId: string) => void | Promise<void>;
  onFillInlineSkuCbm: (containerId: string) => void | Promise<void>;
  onUpdateInlineSkuCbm: (containerId: string) => void | Promise<void>;
  onCancelInlineSkuDraft: (containerId: string) => void;
  onImportItems: (containerId: string, file: File) => void | Promise<void>;
  warehouseNameByCode?: Map<string, string>;
  detailMode?: boolean;
}) {
  const totalQty = container.items.reduce((sum, item) => sum + item.qty, 0);
  const usedCbm = container.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);
  const cbmUsage = container.cbmCapacity
    ? Math.min((usedCbm / container.cbmCapacity) * 100, 100)
    : 0;
  const cbmColor = cbmUsage > 95 ? "#c42b2b" : cbmUsage > 80 ? "#ef9f27" : "#1a5cdb";
  const getEditDraft = (sku: string) => inlineEditDrafts[`${container.id}::${sku}`];
  const destinationLabel = warehouseNameByCode?.get(container.destination) ?? container.destination;

  return (
    <article className="overflow-hidden rounded-xl border border-[#e2dfd8] bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-4 px-5 py-4 text-left transition-colors ${
          detailMode ? "cursor-default bg-white" : "hover:bg-[#f8f7f4]"
        }`}
      >
        <span
          className="h-3.5 w-3.5 flex-shrink-0 rounded-full border-2 border-black/10"
          style={{
            backgroundColor: statusColors[container.status],
            boxShadow: `0 0 0 3px ${statusColors[container.status]}30`,
          }}
        />

        <div className="min-w-[60px] font-mono text-sm font-semibold">{container.number}</div>

        <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 md:grid-cols-4">
          <ContainerMeta label="PO">
            {container.poNumbers.length > 0 ? (
              <span className="text-[#1a5cdb]">{container.poNumbers.join(" · ")}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </ContainerMeta>
          <ContainerMeta label="Destination">{destinationLabel}</ContainerMeta>
          <ContainerMeta label="SKU">
            {container.items.length} kinds / {formatNumber(totalQty)} units
          </ContainerMeta>
          <ContainerMeta label="CBM">
            {usedCbm.toFixed(1)} / {container.cbmCapacity} m3
          </ContainerMeta>
        </div>

        <div className="hidden font-mono text-sm font-semibold text-[#1a5cdb] lg:block">
          ETA {container.eta}
        </div>

        <span className={`hidden rounded-full px-3 py-1 text-xs font-semibold xl:inline-flex ${statusPillClasses[container.status]}`}>
          {containerStatusLabels[container.status]}
        </span>

        {detailMode ? null : (
          <span
            aria-hidden="true"
            className={`h-0 w-0 flex-shrink-0 border-x-[6px] border-x-transparent ${
              expanded
                ? "border-b-[7px] border-b-muted-foreground"
                : "border-t-[7px] border-t-muted-foreground"
            }`}
          />
        )}
      </button>

      {expanded ? (
        <div className="border-t">
          <div className="grid grid-cols-[2.2fr_0.8fr_0.8fr_110px] bg-[#f0eee9] px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            <div>Master SKU</div>
            <div>Qty</div>
            <div>CBM</div>
            <div className="text-right">Actions</div>
          </div>

          <div>
            {container.items.map((item) => (
              <SkuRow
                key={item.sku}
                containerId={container.id}
                item={item}
                editDraft={getEditDraft(item.sku)}
                onStartEdit={onStartEditItem}
                onUpdateDraft={onUpdateInlineEditDraft}
                onSaveDraft={onSaveInlineEditDraft}
                onFillCbm={onFillInlineEditCbm}
                onUpdateCbm={onUpdateInlineEditCbm}
                onCancelDraft={onCancelInlineEditDraft}
                onDelete={onDeleteItem}
              />
            ))}
            {inlineSkuDraft ? (
              <div className="grid grid-cols-[2.2fr_0.8fr_0.8fr_110px] items-end border-t bg-[#fbfaf8] px-5 py-3 text-sm">
                <div className="pr-3">
                  <input
                    className="form-input font-mono text-xs"
                    value={inlineSkuDraft.sku}
                    onChange={(event) => {
                      const sku = event.target.value;
                      onUpdateInlineSkuDraft(container.id, {
                        sku,
                      });
                    }}
                    onBlur={() => void onFillInlineSkuCbm(container.id)}
                    placeholder="Master SKU"
                  />
                  {inlineSkuDraft.sku ? (
                    <div className="mt-1 flex items-center gap-2">
                      <ProductBadge product={inferProductKey(inlineSkuDraft.sku)} />
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {inlineSkuDraft.sku}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div className="pr-3">
                  <input
                    className="form-input"
                    type="number"
                    value={inlineSkuDraft.qty}
                    onChange={(event) => onUpdateInlineSkuDraft(container.id, { qty: event.target.value })}
                    placeholder="Qty"
                  />
                </div>
                <div className="pr-3">
                  <input
                    className="form-input"
                    type="number"
                    step="0.001"
                    value={inlineSkuDraft.cbm}
                    onChange={(event) => onUpdateInlineSkuDraft(container.id, { cbm: event.target.value })}
                    onBlur={() => void onUpdateInlineSkuCbm(container.id)}
                    placeholder="CBM"
                  />
                </div>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => void onSaveInlineSkuDraft(container.id)}
                    className="rounded-md border border-[#1a5cdb] px-2.5 py-1 text-xs font-medium text-[#1a5cdb] hover:bg-[#ebf0fd]"
                  >
                    저장
                  </button>
                  <button
                    type="button"
                    onClick={() => onCancelInlineSkuDraft(container.id)}
                    className="rounded-md border border-[#cccac4] px-2.5 py-1 text-xs text-muted-foreground hover:bg-[#f0eee9]"
                  >
                    취소
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-t px-5 py-3">
            <button
              type="button"
              onClick={() => onStartAddItem(container.id)}
              disabled={Boolean(inlineSkuDraft)}
              className="rounded-lg border border-[#cccac4] bg-white px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-[#f8f7f4] disabled:cursor-not-allowed disabled:opacity-50"
            >
              + SKU 추가
            </button>
            <label className="cursor-pointer rounded-lg border border-[#9ed8c8] bg-[#e6f5f0] px-4 py-2 text-sm font-medium text-[#0a5e45] hover:bg-[#d9f0e8]">
              CSV/엑셀
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void onImportItems(container.id, file);
                }}
              />
            </label>
          </div>

          <div className="flex flex-col gap-3 border-t bg-[#f0eee9] px-5 py-3 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
            <div className="flex gap-5">
              <span>
                Total Qty: <strong className="text-foreground">{formatNumber(totalQty)} units</strong>
              </span>
              <span>
                CBM: <strong className="text-foreground">{usedCbm.toFixed(2)} m3</strong>
              </span>
            </div>
            <div className="text-xs">
              {container.factory} · ETA {container.eta}
            </div>
          </div>

          <div className="px-5 pb-4 pt-3">
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>CBM usage</span>
              <span>
                {cbmUsage.toFixed(0)}% ({usedCbm.toFixed(2)} / {container.cbmCapacity} m3)
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded border border-[#e2dfd8] bg-[#f0eee9]">
              <div
                className="h-full rounded"
                style={{ width: `${cbmUsage}%`, backgroundColor: cbmColor }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ProductBadge({ product }: { product: ProductKey }) {
  return (
    <span className={`inline-flex shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${productBadgeClasses[product]}`}>
      {product.toUpperCase()}
    </span>
  );
}

function SkuRow({
  containerId,
  item,
  editDraft,
  onStartEdit,
  onUpdateDraft,
  onSaveDraft,
  onFillCbm,
  onUpdateCbm,
  onCancelDraft,
  onDelete,
}: {
  containerId: string;
  item: ContainerItem;
  editDraft?: InlineEditDraft;
  onStartEdit: (containerId: string, item: ContainerItem) => void;
  onUpdateDraft: (containerId: string, sku: string, patch: Partial<InlineEditDraft>) => void;
  onSaveDraft: (containerId: string, sku: string) => void | Promise<void>;
  onFillCbm: (containerId: string, sku: string) => void | Promise<void>;
  onUpdateCbm: (containerId: string, sku: string) => void | Promise<void>;
  onCancelDraft: (containerId: string, sku: string) => void;
  onDelete: (containerId: string, sku: string) => void;
}) {
  if (editDraft) {
    return (
      <div className="grid grid-cols-[2.2fr_0.8fr_0.8fr_110px] items-end border-t bg-[#fbfaf8] px-5 py-3 text-sm">
        <div className="pr-3">
          <input
            className="form-input font-mono text-xs"
            value={editDraft.sku}
            onChange={(event) => onUpdateDraft(containerId, item.sku, { sku: event.target.value })}
            onBlur={() => void onFillCbm(containerId, item.sku)}
            placeholder="Master SKU"
          />
          <div className="mt-1 flex items-center gap-2">
            <ProductBadge product={inferProductKey(editDraft.sku)} />
            <span className="truncate font-mono text-[11px] text-muted-foreground">{editDraft.sku}</span>
          </div>
        </div>
        <div className="pr-3">
          <input
            className="form-input"
            type="number"
            value={editDraft.qty}
            onChange={(event) => onUpdateDraft(containerId, item.sku, { qty: event.target.value })}
            placeholder="Qty"
          />
        </div>
        <div className="pr-3">
          <input
            className="form-input"
            type="number"
            step="0.001"
            value={editDraft.cbm}
            onChange={(event) => onUpdateDraft(containerId, item.sku, { cbm: event.target.value })}
            onBlur={() => void onUpdateCbm(containerId, item.sku)}
            placeholder="CBM"
          />
        </div>
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => void onSaveDraft(containerId, item.sku)}
            className="rounded-md border border-[#1a5cdb] px-2.5 py-1 text-xs font-medium text-[#1a5cdb] hover:bg-[#ebf0fd]"
          >
            저장
          </button>
          <button
            type="button"
            onClick={() => onCancelDraft(containerId, item.sku)}
            className="rounded-md border border-[#cccac4] px-2.5 py-1 text-xs text-muted-foreground hover:bg-[#f0eee9]"
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[2.2fr_0.8fr_0.8fr_110px] items-center border-t px-5 py-2 text-sm hover:bg-[#f8f7f4]">
      <div className="flex min-w-0 items-center gap-2">
        <ProductBadge product={inferProductKey(item.sku)} />
        <span className="truncate font-mono text-xs font-medium">{item.sku}</span>
      </div>
      <div className="font-semibold">{formatNumber(item.qty)} units</div>
      <div className="text-xs text-muted-foreground">{(item.qty * item.cbm).toFixed(3)} m3</div>
      <div className="flex justify-end gap-1">
        <button
          type="button"
          onClick={() => onStartEdit(containerId, item)}
          className="rounded-md border border-[#cccac4] px-2.5 py-1 text-xs text-muted-foreground hover:border-[#1a5cdb] hover:text-[#1a5cdb]"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={() => onDelete(containerId, item.sku)}
          className="rounded-md border border-[#cccac4] px-2.5 py-1 text-xs text-muted-foreground hover:border-[#c42b2b] hover:text-[#c42b2b]"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function ContainerMeta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-xs">
      <div className="text-[10px] uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="truncate font-medium text-foreground">{children}</div>
    </div>
  );
}
