"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  containerStatusLabels,
  mockSkus,
  type ContainerStatus,
  type MockContainer,
  type ProductKey,
} from "@/features/planning/mock-data";
import { isAdminLikeRole } from "@/components/layout/navigation-config";

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

type StockSourceType = "remaining" | "mistake";

type StockAllocation = {
  id: string;
  stockId: string;
  sourceType: StockSourceType;
  referenceNo: string;
  qty: number;
  cbm: number;
};

type AvailableStockRow = {
  id: string;
  sourceType: StockSourceType;
  referenceNo: string;
  masterSku: string;
  totalQty: number;
  availableQty: number;
  allocatedToContainer: number;
  cbm: number;
  note: string | null;
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
  items?: Array<{ sku: string; qty: number; cbm: number; allocations?: StockAllocation[] }>;
};

type WarehouseOption = {
  id: string;
  warehouseCode: string;
  warehouseName: string;
  isActive: boolean;
};

type PurchaseOrderOption = {
  id: string;
  number: string;
  eta: string | null;
  factory: string | null;
  destination: string | null;
  status: string;
  itemCount: number;
  items: ContainerItem[];
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
  if (normalized === "final-list-sent" || normalized === "final" || normalized === "sent" || normalized === "shipped") {
    return "final-list-sent";
  }
  if (
    normalized === "packing-list-received" ||
    normalized === "packing-list" ||
    normalized === "packing-received" ||
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
    origin: container.origin ?? "",
    destination: container.destWarehouse ?? "",
    items: (container.items ?? []).map((item) => ({
      sku: item.sku,
      qty: Number(item.qty ?? 0),
      cbm: Number(item.cbm ?? 0),
      allocations: (item.allocations ?? []).map((allocation) => ({
        ...allocation,
        qty: Number(allocation.qty ?? 0),
        cbm: Number(allocation.cbm ?? 0),
      })),
    })),
  };
}

function parseNumberCell(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function todayLabel() {
  return new Date().toISOString().slice(0, 10);
}

function safeFilePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_") || "container";
}

function itemsFromPurchaseOrders(orders: PurchaseOrderOption[]): ContainerItem[] {
  const itemsBySku = new Map<string, ContainerItem>();

  for (const order of orders) {
    for (const item of order.items) {
      const sku = item.sku.trim().toUpperCase();
      if (!sku || item.qty <= 0) continue;

      const existing = itemsBySku.get(sku);
      if (existing) {
        itemsBySku.set(sku, {
          sku,
          qty: existing.qty + item.qty,
          cbm: item.cbm > 0 ? item.cbm : existing.cbm,
        });
      } else {
        itemsBySku.set(sku, { sku, qty: item.qty, cbm: item.cbm });
      }
    }
  }

  return [...itemsBySku.values()];
}

export function ContainerPlanningPage() {
  const { data: session } = useSession();
  const isAdmin = isAdminLikeRole(session?.user?.role);
  const searchParams = useSearchParams();
  const targetContainerId = searchParams.get("containerId");

  const [containers, setContainers] = useState<MockContainer[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(targetContainerId);
  const [loadingContainers, setLoadingContainers] = useState(true);
  const [containersError, setContainersError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [loadingWarehouses, setLoadingWarehouses] = useState(true);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderOption[]>([]);
  const [loadingPurchaseOrders, setLoadingPurchaseOrders] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingContainerId, setEditingContainerId] = useState<string | null>(null);
  const [savingContainer, setSavingContainer] = useState(false);
  const [statusModalContainerId, setStatusModalContainerId] = useState<string | null>(null);
  const [availableStockContainerId, setAvailableStockContainerId] = useState<string | null>(null);
  const [form, setForm] = useState<ContainerFormState>(defaultFormState);
  const [selectedPoIds, setSelectedPoIds] = useState<string[]>([]);
  const [draftItems, setDraftItems] = useState<ContainerItem[]>([]);
  const [skuInput, setSkuInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [cbmInput, setCbmInput] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ContainerStatus | null>(null);
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
    return containers.filter((container) => {
      if (statusFilter && container.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return [
        container.number,
        container.destination,
        container.factory,
        container.eta,
        ...container.poNumbers,
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [containers, query, statusFilter]);
  const selectedContainer = containers.find((container) => container.id === expandedId) ?? null;
  const selectedPurchaseOrders = useMemo(
    () => purchaseOrders.filter((po) => selectedPoIds.includes(po.id)),
    [purchaseOrders, selectedPoIds]
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
        if (targetContainerId && nextContainers.some((container) => container.id === targetContainerId)) return targetContainerId;
        return nextContainers[0]?.id ?? null;
      });
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

  async function fetchPurchaseOrders() {
    setLoadingPurchaseOrders(true);
    try {
      const response = await fetch("/api/purchase-orders", { cache: "no-store" });
      const json = await response.json();

      if (json.success) {
        setPurchaseOrders((json.data as PurchaseOrderOption[]).map((po) => ({
          id: po.id,
          number: po.number,
          eta: po.eta,
          factory: po.factory,
          destination: po.destination,
          status: po.status,
          itemCount: po.itemCount,
          items: (po.items ?? []).map((item) => ({
            sku: item.sku,
            qty: Number(item.qty ?? 0),
            cbm: Number(item.cbm ?? 0),
          })),
        })));
      } else {
        setPurchaseOrders([]);
      }
    } catch {
      setPurchaseOrders([]);
    } finally {
      setLoadingPurchaseOrders(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchContainers();
    void fetchWarehouses();
    void fetchPurchaseOrders();
  }, []);

  useEffect(() => {
    if (!isFormOpen || form.destination || !warehouses[0]) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm((current) => ({ ...current, destination: warehouses[0].warehouseCode }));
  }, [form.destination, isFormOpen, warehouses]);

  function openForm() {
    setEditingContainerId(null);
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
    setEditingContainerId(null);
    setFormError(null);
  }

  function openEditForm(container: MockContainer) {
    setExpandedId(container.id);
    setEditingContainerId(container.id);
    setForm({
      number: container.number,
      poNumbers: container.poNumbers.join(", "),
      eta: container.eta,
      status: container.status,
      cbmCapacity: String(container.cbmCapacity || 67.5),
      factory: container.factory,
      origin: container.origin ?? "",
      destination: container.destination,
    });
    const linkedPoIds = purchaseOrders
      .filter((po) => container.poNumbers.includes(po.number))
      .map((po) => po.id);
    setSelectedPoIds(linkedPoIds);
    setDraftItems(container.items.map((item) => ({ ...item })));
    setSkuInput("");
    setQtyInput("");
    setCbmInput("");
    setFormError(null);
    setIsFormOpen(true);
  }

  function updateForm<K extends keyof ContainerFormState>(key: K, value: ContainerFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePurchaseOrder(poId: string) {
    setSelectedPoIds((current) => {
      const next = current.includes(poId)
        ? current.filter((id) => id !== poId)
        : [...current, poId];
      const selectedOrders = purchaseOrders.filter((po) => next.includes(po.id));
      const poNumbers = selectedOrders
        .map((po) => po.number)
        .join(", ");
      setForm((formState) => ({ ...formState, poNumbers }));
      setDraftItems(itemsFromPurchaseOrders(selectedOrders));
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
    if (editingContainerId && form.status !== "draft") {
      setFormError("SKU add/delete is available only while the container is Draft.");
      return;
    }

    const sku = skuInput.trim().toUpperCase();
    const qty = Number.parseInt(qtyInput, 10);

    if (!sku) {
      setFormError("Please enter a Master SKU.");
      return;
    }

    const found = await lookupSkuMaster(sku);
    if (!found) {
      setFormError(`SKU not found in SKU Master: ${sku}`);
      return;
    }

    const cbm = cbmInput ? Number.parseFloat(cbmInput) : found.cbmPerUnit;

    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError("Quantity must be at least 1.");
      return;
    }

    if (!Number.isFinite(cbm) || cbm <= 0) {
      setFormError("CBM must be greater than 0.");
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
    if (editingContainerId && form.status !== "draft") return;
    if (draftItems.find((item) => item.sku === sku)?.allocations?.length) {
      setFormError("Allocated Remaining / Mistake stock must be removed from the container detail view by source.");
      return;
    }
    setDraftItems((items) => items.filter((item) => item.sku !== sku));
  }

  async function saveContainer() {
    const number = form.number.trim();
    const eta = form.eta.trim();

    if (!number) {
      setFormError("Please enter a container number.");
      return;
    }

    if (!eta) {
      setFormError("Please select an ETA.");
      return;
    }

    if (!editingContainerId && draftItems.length === 0) {
      setFormError("Please add at least one SKU.");
      return;
    }

    const missingSkus = await validateContainerSkus(draftItems);
    if (missingSkus.length > 0) {
      setFormError(`Cannot save container. SKU not found in SKU Master: ${missingSkus.join(", ")}`);
      return;
    }

    const newContainer: MockContainer = {
      id: editingContainerId ?? "",
      number,
      poNumbers: splitPoNumbers(form.poNumbers),
      eta,
      status: form.status,
      cbmCapacity,
      factory: form.factory.trim() || "Unassigned Factory",
      origin: form.origin.trim(),
      destination: form.destination,
      items: draftItems,
    };

    if (editingContainerId) {
      setSavingContainer(true);
      try {
        const response = await fetch(`/api/containers?id=${encodeURIComponent(editingContainerId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            number: newContainer.number,
            poNumbers: newContainer.poNumbers,
            eta: newContainer.eta,
            status: newContainer.status,
            cbmCapacity: newContainer.cbmCapacity,
            factory: newContainer.factory,
            origin: newContainer.origin ?? "",
            destination: newContainer.destination,
            items: newContainer.items,
          }),
        });
        const json = await response.json();

        if (!response.ok || !json.success) {
          setFormError(json.error ?? "Failed to save container.");
          return;
        }

        await fetchContainers();
        setExpandedId(editingContainerId);
        closeForm();
      } finally {
        setSavingContainer(false);
      }
      return;
    }

    setSavingContainer(true);
    try {
      const response = await fetch("/api/containers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          number: newContainer.number,
          poNumbers: newContainer.poNumbers,
          eta: newContainer.eta,
          status: newContainer.status,
          cbmCapacity: newContainer.cbmCapacity,
          factory: newContainer.factory,
          origin: newContainer.origin ?? "",
          destination: newContainer.destination,
          items: newContainer.items,
        }),
      });
      const json = await response.json();

      if (!response.ok || !json.success) {
        setFormError(json.error ?? "Failed to create container.");
        return;
      }

      await fetchContainers();
      setExpandedId(String(json.data.id));
      closeForm();
    } catch {
      setFormError("Failed to create container.");
    } finally {
      setSavingContainer(false);
    }
  }

  function deleteContainerItem(containerId: string, sku: string) {
    const container = containers.find((item) => item.id === containerId);
    if (container?.status !== "draft") return;

    if (!window.confirm(`Delete ${sku}?`)) return;

    setContainers((current) =>
      current.map((item) =>
        item.id === containerId
          ? { ...item, items: item.items.filter((line) => line.sku !== sku) }
          : item
      )
    );
  }

  async function changeContainerStatus(containerId: string, newStatus: ContainerStatus) {
    const container = containers.find((entry) => entry.id === containerId);
    setStatusModalContainerId(null);

    if (!container || container.status === newStatus) return;

    if (!/^\d+$/.test(containerId)) {
      setContainers((current) =>
        current.map((entry) => entry.id === containerId ? { ...entry, status: newStatus } : entry)
      );
      return;
    }

    try {
      const response = await fetch(`/api/containers?id=${encodeURIComponent(containerId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = await response.json();

      if (!response.ok || !json.success) {
        window.alert(json.error ?? "Failed to update container status.");
        return;
      }

      await fetchContainers();
      setExpandedId(containerId);
    } catch {
      window.alert("Failed to update container status.");
    }
  }

  async function addAvailableStockToContainer(
    containerId: string,
    allocations: Array<{ stockId: string; qty: number }>
  ) {
    try {
      const response = await fetch("/api/container-available-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "allocate", containerId, allocations }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        window.alert(json.error ?? "Failed to allocate available stock.");
        return false;
      }

      await fetchContainers();
      setExpandedId(containerId);
      setAvailableStockContainerId(null);
      return true;
    } catch {
      window.alert("Failed to allocate available stock.");
      return false;
    }
  }

  async function removeAvailableStockAllocations(allocationIds: string[], containerId: string) {
    if (allocationIds.length === 0) return false;
    const prompt = allocationIds.length === 1
      ? "Remove this allocated available stock from the container?"
      : `Remove ${allocationIds.length} selected available stock items from the container?`;
    if (!window.confirm(prompt)) return false;
    try {
      const response = await fetch(
        `/api/container-available-stock?allocationIds=${encodeURIComponent(allocationIds.join(","))}`,
        { method: "DELETE" }
      );
      const json = await response.json();
      if (!response.ok || !json.success) {
        window.alert(json.error ?? "Failed to remove allocated stock.");
        return false;
      }
      await fetchContainers();
      setExpandedId(containerId);
      return true;
    } catch {
      window.alert("Failed to remove allocated stock.");
      return false;
    }
  }

  async function removeAvailableStockAllocation(allocationId: string, containerId: string) {
    return removeAvailableStockAllocations([allocationId], containerId);
  }

  function deleteContainer(containerId: string) {
    setContainers((current) => current.filter((c) => c.id !== containerId));
    if (expandedId === containerId) setExpandedId(null);
  }

  function editDraftKey(containerId: string, sku: string) {
    return `${containerId}::${sku}`;
  }

  function startInlineEdit(containerId: string, item: ContainerItem) {
    const container = containers.find((entry) => entry.id === containerId);
    if (container?.status === "packing-list-received") return;

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

    const container = containers.find((item) => item.id === containerId);
    const originalItem = container?.items.find((item) => item.sku === originalSku);
    const isQuantityOnly = container?.status === "final-list-sent";
    const isLocked = container?.status === "packing-list-received";
    if (isLocked) return;

    const nextSku = isQuantityOnly ? originalSku : draft.sku.trim().toUpperCase();
    const qty = Number.parseInt(draft.qty, 10);

    if (!nextSku) {
      window.alert("Please enter a Master SKU.");
      return;
    }

    const found = isQuantityOnly && originalItem
      ? { masterSku: originalItem.sku, cbmPerUnit: originalItem.cbm }
      : await lookupSkuMaster(nextSku);
    if (!found) {
      window.alert(`SKU not found in SKU Master: ${nextSku}`);
      return;
    }

    const cbm = isQuantityOnly && originalItem
      ? originalItem.cbm
      : draft.cbm ? Number.parseFloat(draft.cbm) : found.cbmPerUnit;

    if (!Number.isFinite(qty) || qty <= 0) {
      window.alert("Quantity must be at least 1.");
      return;
    }

    if (!Number.isFinite(cbm) || cbm <= 0) {
      window.alert("CBM must be greater than 0.");
      return;
    }

    if (!isQuantityOnly) {
      const cbmUpdateError = await updateSkuMasterCbm(found.masterSku, cbm);
      if (cbmUpdateError) {
        window.alert(cbmUpdateError);
        return;
      }
    }

    const updatedContainer = container
      ? {
          ...container,
          items: container.items.map((item) =>
            item.sku === originalSku ? { sku: found.masterSku, qty, cbm } : item
          ),
        }
      : null;

    if (updatedContainer && !(await persistContainer(updatedContainer))) return;
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

  function getMergedContainer(container: MockContainer, itemsToMerge: ContainerItem[]): MockContainer {
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
  }

  async function persistContainer(container: MockContainer): Promise<boolean> {
    if (!/^\d+$/.test(container.id)) {
      setContainers((current) => current.map((item) => (item.id === container.id ? container : item)));
      return true;
    }

    const response = await fetch(`/api/containers?id=${encodeURIComponent(container.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        number: container.number,
        poNumbers: container.poNumbers,
        eta: container.eta,
        status: container.status,
        cbmCapacity: container.cbmCapacity,
        factory: container.factory,
        origin: container.origin ?? "",
        destination: container.destination,
        items: container.items,
      }),
    });
    const json = await response.json();

    if (!response.ok || !json.success) {
      window.alert(json.error ?? "Failed to save container.");
      return false;
    }

    await fetchContainers();
    setExpandedId(container.id);
    return true;
  }

  function startInlineSkuAdd(containerId: string) {
    const container = containers.find((item) => item.id === containerId);
    if (container?.status !== "draft") return;

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
      window.alert("Please enter a Master SKU.");
      return;
    }

    const found = await lookupSkuMaster(sku);
    if (!found) {
      window.alert(`SKU not found in SKU Master: ${sku}`);
      return;
    }

    const cbm = draft.cbm ? Number.parseFloat(draft.cbm) : found.cbmPerUnit;

    if (!Number.isFinite(qty) || qty <= 0) {
      window.alert("Quantity must be at least 1.");
      return;
    }

    if (!Number.isFinite(cbm) || cbm <= 0) {
      window.alert("CBM must be greater than 0.");
      return;
    }

    const cbmUpdateError = await updateSkuMasterCbm(found.masterSku, cbm);
    if (cbmUpdateError) {
      window.alert(cbmUpdateError);
      return;
    }

    const container = containers.find((item) => item.id === containerId);
    if (!container) return;

    const updatedContainer = getMergedContainer(container, [{ sku: found.masterSku, qty, cbm }]);
    if (!(await persistContainer(updatedContainer))) return;

    cancelInlineSkuAdd(containerId);
  }

  async function importContainerItems(containerId: string, file: File) {
    const container = containers.find((item) => item.id === containerId);
    if (container?.status !== "draft") return;

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
      window.alert("No SKUs to import. Use the first row as a header and columns in SKU / Qty / CBM order.");
      return;
    }

    const updatedContainer = getMergedContainer(container, validImportedItems);
    if (!(await persistContainer(updatedContainer))) return;
    window.alert(`Imported ${validImportedItems.length} SKU(s).`);
  }

  async function exportContainerItems(containerId: string) {
    const container = containers.find((item) => item.id === containerId);
    if (!container) return;

    const destinationLabel = warehouseNameByCode.get(container.destination) ?? container.destination;
    const totalQty = container.items.reduce((sum, item) => sum + item.qty, 0);
    const totalCbm = container.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);
    const rows: Array<Array<string | number | null>> = [
      ["Container", container.number],
      ["PO", container.poNumbers.join(", ") || null],
      ["ETA", container.eta || null],
      ["Factory", container.factory || null],
      ["Destination", destinationLabel || null],
      ["Status", containerStatusLabels[container.status]],
      [],
      ["Master SKU", "Source", "Qty", "CBM / Unit", "Total CBM"],
      ...container.items.map((item) => [
        item.sku,
        (item.allocations ?? [])
          .map((allocation) =>
            `${allocation.sourceType === "remaining" ? "Remaining" : "Mistake"} ${allocation.referenceNo} (${allocation.qty})`
          )
          .join(", ") || "PO / Manual",
        item.qty,
        item.cbm,
        Number((item.qty * item.cbm).toFixed(4)),
      ]),
      [],
      ["Total", null, totalQty, null, Number(totalCbm.toFixed(4))],
    ];

    const XLSX = await import("xlsx");
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!cols"] = [{ wch: 28 }, { wch: 36 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Packing List");
    XLSX.writeFile(workbook, `container-${safeFilePart(container.number)}-${todayLabel()}.xlsx`);
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
              {statusFilter ? (
                <span className="ml-1 text-[11px] font-normal text-[#1a5cdb]">
                  (filtered)
                </span>
              ) : null}
            </span>
            <div className="hidden items-center gap-3 text-[11px] text-muted-foreground sm:flex">
              {statusOptions.map((status) => {
                const isActive = statusFilter === status.value;
                return (
                  <button
                    key={status.value}
                    type="button"
                    onClick={() => setStatusFilter(isActive ? null : status.value)}
                    className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-colors ${
                      isActive
                        ? "bg-[#f0eee9] font-semibold text-foreground ring-1 ring-inset ring-[#cccac4]"
                        : "hover:text-foreground"
                    }`}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColors[status.value] }} />
                    {status.shortLabel}
                  </button>
                );
              })}
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
                isEditing={Boolean(editingContainerId)}
                saving={savingContainer}
                selectedPoIds={selectedPoIds}
                purchaseOrders={purchaseOrders}
                loadingPurchaseOrders={loadingPurchaseOrders}
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
                onExportItems={exportContainerItems}
                onEditContainer={openEditForm}
                onAddAvailableStock={(id) => setAvailableStockContainerId(id)}
                onRemoveAvailableAllocation={removeAvailableStockAllocation}
                onRemoveAvailableAllocations={removeAvailableStockAllocations}
                isAdmin={isAdmin}
                onChangeStatus={(id) => setStatusModalContainerId(id)}
                onDeleteContainer={deleteContainer}
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
      {statusModalContainerId ? (
        <StatusChangeModal
          currentStatus={containers.find((c) => c.id === statusModalContainerId)?.status ?? "draft"}
          onConfirm={(newStatus) => changeContainerStatus(statusModalContainerId, newStatus)}
          onClose={() => setStatusModalContainerId(null)}
        />
      ) : null}
      {availableStockContainerId ? (
        <AvailableStockModal
          containerId={availableStockContainerId}
          onAdd={(allocations) => addAvailableStockToContainer(availableStockContainerId, allocations)}
          onClose={() => setAvailableStockContainerId(null)}
        />
      ) : null}
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
  isEditing,
  saving,
  selectedPoIds,
  purchaseOrders,
  loadingPurchaseOrders,
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
  isEditing: boolean;
  saving: boolean;
  selectedPoIds: string[];
  purchaseOrders: PurchaseOrderOption[];
  loadingPurchaseOrders: boolean;
  selectedPurchaseOrders: PurchaseOrderOption[];
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
  const canChangeSkuStructure = !isEditing || form.status === "draft";

  return (
    <div className="relative rounded-xl border-2 border-dashed border-[#cccac4] bg-white p-5">
      <div className="mb-5 flex items-start justify-between gap-4 border-b border-[#e2dfd8] pb-4 pr-10">
        <div>
          <div className="text-base font-semibold">{isEditing ? "Edit Container" : "New Container Registration"}</div>
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
        {loadingPurchaseOrders ? (
          <div className="mb-2 text-xs text-muted-foreground">Loading purchase orders from database...</div>
        ) : null}
        <div className="flex min-h-8 flex-wrap gap-2">
          {purchaseOrders.map((po) => (
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
                {po.number}: ETA {po.eta ?? "-"}, {po.destination ?? "-"}, {po.itemCount} SKU
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
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving}
          className="rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1650c4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
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
  onExportItems,
  onEditContainer,
  onAddAvailableStock,
  onRemoveAvailableAllocation,
  onRemoveAvailableAllocations,
  isAdmin = false,
  onChangeStatus,
  onDeleteContainer,
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
  onExportItems: (containerId: string) => void | Promise<void>;
  onEditContainer: (container: MockContainer) => void;
  onAddAvailableStock: (containerId: string) => void;
  onRemoveAvailableAllocation: (allocationId: string, containerId: string) => void | Promise<boolean>;
  onRemoveAvailableAllocations: (allocationIds: string[], containerId: string) => void | Promise<boolean>;
  isAdmin?: boolean;
  onChangeStatus: (containerId: string) => void;
  onDeleteContainer: (containerId: string) => void;
  warehouseNameByCode?: Map<string, string>;
  detailMode?: boolean;
}) {
  const totalQty = container.items.reduce((sum, item) => sum + item.qty, 0);
  const usedCbm = container.items.reduce((sum, item) => sum + item.qty * item.cbm, 0);
  const cbmUsage = container.cbmCapacity
    ? Math.min((usedCbm / container.cbmCapacity) * 100, 100)
    : 0;
  const cbmColor = cbmUsage > 95 ? "#c42b2b" : cbmUsage > 80 ? "#ef9f27" : "#1a5cdb";
  const isStructureLocked = container.status === "final-list-sent";
  const isFullyLocked = container.status === "packing-list-received";
  const canEditQuantity = !isFullyLocked;
  const canChangeStructure = !isStructureLocked && !isFullyLocked;
  const removableAllocationIds = container.items.flatMap((item) => (item.allocations ?? []).map((allocation) => allocation.id));
  const [selectedAllocationIds, setSelectedAllocationIds] = useState<string[]>([]);
  const activeSelectedAllocationIds = selectedAllocationIds.filter((id) => removableAllocationIds.includes(id));
  const getEditDraft = (sku: string) => inlineEditDrafts[`${container.id}::${sku}`];
  const destinationLabel = warehouseNameByCode?.get(container.destination) ?? container.destination;

  function toggleAllocationSelection(allocationIds: string[], checked: boolean) {
    setSelectedAllocationIds((current) => {
      const next = new Set(current);
      allocationIds.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return [...next];
    });
  }

  async function removeSelectedAllocations() {
    const deleted = await onRemoveAvailableAllocations(activeSelectedAllocationIds, container.id);
    if (deleted) setSelectedAllocationIds([]);
  }

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
          {isStructureLocked ? (
            <div className="flex items-center gap-2 border-b border-[#fde68a] bg-[#fffbeb] px-5 py-2 text-xs text-[#92400e]">
              <span>Final List Sent: SKU add/delete is locked. Qty can still be edited before packing list receipt.</span>
            </div>
          ) : null}
          {isFullyLocked ? (
            <div className="flex items-center gap-2 border-b border-[#bfdbfe] bg-[#eff6ff] px-5 py-2 text-xs text-[#1d4ed8]">
              <span>Packing List Received: all SKU edits are locked because physical quantities are confirmed.</span>
            </div>
          ) : null}
          <div className={`grid bg-[#f0eee9] px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground ${canEditQuantity ? "grid-cols-[2.2fr_0.8fr_0.8fr_110px]" : "grid-cols-[2.2fr_0.8fr_0.8fr]"}`}>
            <div>Master SKU</div>
            <div>Qty</div>
            <div>CBM</div>
            {canEditQuantity ? <div className="text-right">Actions</div> : null}
          </div>
          {canChangeStructure && removableAllocationIds.length > 0 ? (
            <div className="flex items-center justify-between border-t bg-[#fbfaf8] px-5 py-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={activeSelectedAllocationIds.length === removableAllocationIds.length}
                  onChange={(event) => setSelectedAllocationIds(event.target.checked ? removableAllocationIds : [])}
                />
                Select all Remaining / Mistake items
              </label>
              <button
                type="button"
                onClick={() => void removeSelectedAllocations()}
                disabled={activeSelectedAllocationIds.length === 0}
                className="rounded-md border border-[#f2b8b5] bg-[#fff5f5] px-3 py-1 text-xs font-medium text-[#c42b2b] hover:bg-[#fee2e2] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Delete Selected ({activeSelectedAllocationIds.length})
              </button>
            </div>
          ) : null}

          <div>
            {container.items.map((item) => (
              <SkuRow
                key={item.sku}
                containerId={container.id}
                item={item}
                editDraft={getEditDraft(item.sku)}
                readonly={!canEditQuantity}
                quantityOnly={isStructureLocked}
                onStartEdit={onStartEditItem}
                onUpdateDraft={onUpdateInlineEditDraft}
                onSaveDraft={onSaveInlineEditDraft}
                onFillCbm={onFillInlineEditCbm}
                onUpdateCbm={onUpdateInlineEditCbm}
                onCancelDraft={onCancelInlineEditDraft}
                onDelete={onDeleteItem}
                onRemoveAvailableAllocation={onRemoveAvailableAllocation}
                selectedAllocationIds={activeSelectedAllocationIds}
                onToggleAllocationSelection={toggleAllocationSelection}
              />
            ))}
            {inlineSkuDraft && canChangeStructure ? (
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
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => onCancelInlineSkuDraft(container.id)}
                    className="rounded-md border border-[#cccac4] px-2.5 py-1 text-xs text-muted-foreground hover:bg-[#f0eee9]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3 border-t px-5 py-3">
            <button
              type="button"
              onClick={() => onEditContainer(container)}
              className="rounded-lg border border-[#8fb8ff] bg-[#ebf0fd] px-4 py-2 text-sm font-medium text-[#1a5cdb] hover:bg-[#dfe9ff]"
            >
              Edit
            </button>
            {canChangeStructure ? (
              <button
                type="button"
                onClick={() => onStartAddItem(container.id)}
                disabled={Boolean(inlineSkuDraft)}
                className="rounded-lg border border-[#cccac4] bg-white px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-[#f8f7f4] disabled:cursor-not-allowed disabled:opacity-50"
              >
                + Add SKU
              </button>
            ) : null}
            {canChangeStructure ? (
              <button
                type="button"
                onClick={() => onAddAvailableStock(container.id)}
                className="rounded-lg border border-[#9ed8c8] bg-[#e6f5f0] px-4 py-2 text-sm font-medium text-[#0a5e45] hover:bg-[#d9f0e8]"
              >
                + Add Available Stock
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void onExportItems(container.id)}
              className="rounded-lg border border-[#9ed8c8] bg-[#e6f5f0] px-4 py-2 text-sm font-medium text-[#0a5e45] hover:bg-[#d9f0e8]"
            >
              CSV/Excel
            </button>
            {canChangeStructure ? (
              <label className="cursor-pointer rounded-lg border border-[#cccac4] bg-white px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-[#f8f7f4]">
                <span>Import</span>
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
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChangeStatus(container.id)}
                className="rounded-lg border border-[#e2dfd8] bg-white px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-[#f8f7f4]"
              >
                Change Status
              </button>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete container '${container.number}'?`)) {
                      onDeleteContainer(container.id);
                    }
                  }}
                  className="rounded-lg border border-[#fecaca] bg-[#fff5f5] px-4 py-2 text-sm font-medium text-[#c42b2b] hover:bg-[#fee2e2]"
                >
                  Delete
                </button>
              ) : null}
            </div>
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
  readonly = false,
  quantityOnly = false,
  onStartEdit,
  onUpdateDraft,
  onSaveDraft,
  onFillCbm,
  onUpdateCbm,
  onCancelDraft,
  onDelete,
  onRemoveAvailableAllocation,
  selectedAllocationIds,
  onToggleAllocationSelection,
}: {
  containerId: string;
  item: ContainerItem;
  editDraft?: InlineEditDraft;
  readonly?: boolean;
  quantityOnly?: boolean;
  onStartEdit: (containerId: string, item: ContainerItem) => void;
  onUpdateDraft: (containerId: string, sku: string, patch: Partial<InlineEditDraft>) => void;
  onSaveDraft: (containerId: string, sku: string) => void | Promise<void>;
  onFillCbm: (containerId: string, sku: string) => void | Promise<void>;
  onUpdateCbm: (containerId: string, sku: string) => void | Promise<void>;
  onCancelDraft: (containerId: string, sku: string) => void;
  onDelete: (containerId: string, sku: string) => void;
  onRemoveAvailableAllocation: (allocationId: string, containerId: string) => void | Promise<boolean>;
  selectedAllocationIds: string[];
  onToggleAllocationSelection: (allocationIds: string[], checked: boolean) => void;
}) {
  const allocations = item.allocations ?? [];
  const hasAllocatedStock = allocations.length > 0;

  if (editDraft) {
    return (
      <div className="grid grid-cols-[2.2fr_0.8fr_0.8fr_110px] items-end border-t bg-[#fbfaf8] px-5 py-3 text-sm">
        <div className="pr-3">
          <input
            className="form-input font-mono text-xs"
            value={editDraft.sku}
            onChange={(event) => onUpdateDraft(containerId, item.sku, { sku: event.target.value })}
            onBlur={() => void onFillCbm(containerId, item.sku)}
            disabled={quantityOnly}
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
            disabled={quantityOnly}
            placeholder="CBM"
          />
        </div>
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => void onSaveDraft(containerId, item.sku)}
            className="rounded-md border border-[#1a5cdb] px-2.5 py-1 text-xs font-medium text-[#1a5cdb] hover:bg-[#ebf0fd]"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => onCancelDraft(containerId, item.sku)}
            className="rounded-md border border-[#cccac4] px-2.5 py-1 text-xs text-muted-foreground hover:bg-[#f0eee9]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`grid items-center border-t px-5 py-2 text-sm hover:bg-[#f8f7f4] ${readonly ? "grid-cols-[2.2fr_0.8fr_0.8fr]" : "grid-cols-[2.2fr_0.8fr_0.8fr_110px]"}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {hasAllocatedStock && !readonly && !quantityOnly ? (
            <input
              type="checkbox"
              aria-label={`Select ${item.sku} available stock for removal`}
              checked={allocations.every((allocation) => selectedAllocationIds.includes(allocation.id))}
              onChange={(event) => onToggleAllocationSelection(allocations.map((allocation) => allocation.id), event.target.checked)}
            />
          ) : null}
          <ProductBadge product={inferProductKey(item.sku)} />
          <span className="truncate font-mono text-xs font-medium">{item.sku}</span>
        </div>
        {allocations.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {allocations.map((allocation) => (
              <span
                key={allocation.id}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  allocation.sourceType === "remaining"
                    ? "bg-[#e6f5f0] text-[#0a5e45]"
                    : "bg-[#fef3e2] text-[#8a5300]"
                }`}
              >
                {allocation.sourceType === "remaining" ? "Remaining" : "Mistake"} {allocation.referenceNo} / {allocation.qty}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="font-semibold">{formatNumber(item.qty)} units</div>
      <div className="text-xs text-muted-foreground">{(item.qty * item.cbm).toFixed(3)} m3</div>
      {readonly ? null : hasAllocatedStock ? (
        <div className="flex flex-col items-end gap-1">
          {allocations.map((allocation) => (
            <button
              key={allocation.id}
              type="button"
              onClick={() => void onRemoveAvailableAllocation(allocation.id, containerId)}
              title={`Delete ${allocation.sourceType === "remaining" ? "Remaining" : "Mistake"} ${allocation.referenceNo}`}
              className="rounded-md border border-[#f2b8b5] bg-[#fff5f5] px-2.5 py-1 text-xs font-medium text-[#c42b2b] hover:bg-[#fee2e2]"
            >
              Delete
            </button>
          ))}
        </div>
      ) : (
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={() => onStartEdit(containerId, item)}
            className="rounded-md border border-[#cccac4] px-2.5 py-1 text-xs text-muted-foreground hover:border-[#1a5cdb] hover:text-[#1a5cdb]"
          >
            {quantityOnly ? "Qty" : "Edit"}
          </button>
          {quantityOnly ? null : (
            <button
              type="button"
              onClick={() => onDelete(containerId, item.sku)}
              className="rounded-md border border-[#cccac4] px-2.5 py-1 text-xs text-muted-foreground hover:border-[#c42b2b] hover:text-[#c42b2b]"
            >
              Delete
            </button>
          )}
        </div>
      )}
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

const statusWorkflowLabels: Record<ContainerStatus, string> = {
  draft: "Container Draft (Pre-plan)",
  "final-list-sent": "Final List Sent (Factory)",
  "packing-list-received": "Packing List Received / Shipped",
};

function AvailableStockModal({
  containerId,
  onAdd,
  onClose,
}: {
  containerId: string;
  onAdd: (allocations: Array<{ stockId: string; qty: number }>) => Promise<boolean>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<AvailableStockRow[]>([]);
  const [sourceType, setSourceType] = useState<StockSourceType>("remaining");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedQty, setSelectedQty] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    referenceNo: "",
    masterSku: "",
    totalQty: "",
    cbm: "",
    note: "",
  });

  async function loadRows() {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/container-available-stock?containerId=${encodeURIComponent(containerId)}`,
        { cache: "no-store" }
      );
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? "Failed to load available stock.");
      setRows(json.data as AvailableStockRow[]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load available stock.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerId]);

  const visibleRows = rows.filter((row) => {
    if (row.sourceType !== sourceType) return false;
    if (!query.trim()) return true;
    const normalized = query.trim().toLowerCase();
    return `${row.referenceNo} ${row.masterSku} ${row.note ?? ""}`.toLowerCase().includes(normalized);
  });

  const selected = rows
    .map((row) => ({ stockId: row.id, qty: Number.parseInt(selectedQty[row.id] ?? "", 10), row }))
    .filter((entry) => Number.isFinite(entry.qty) && entry.qty > 0);
  const selectableVisibleRows = visibleRows.filter((row) => row.availableQty > 0);
  const allVisibleSelected = selectableVisibleRows.length > 0
    && selectableVisibleRows.every((row) => Boolean(selectedQty[row.id]));
  const selectedUnits = selected.reduce((sum, entry) => sum + entry.qty, 0);
  const selectedCbm = selected.reduce((sum, entry) => sum + entry.qty * entry.row.cbm, 0);

  function selectAllVisible() {
    setSelectedQty((current) => {
      const next = { ...current };
      selectableVisibleRows.forEach((row) => {
        next[row.id] = next[row.id] || "1";
      });
      return next;
    });
  }

  function clearVisibleSelection() {
    setSelectedQty((current) => {
      const next = { ...current };
      visibleRows.forEach((row) => {
        next[row.id] = "";
      });
      return next;
    });
  }

  async function registerStock() {
    const totalQty = Number.parseInt(form.totalQty, 10);
    const cbm = Number.parseFloat(form.cbm);
    if (!form.referenceNo.trim() || !form.masterSku.trim() || !Number.isFinite(totalQty) || !Number.isFinite(cbm)) {
      setMessage("Reference, Master SKU, quantity, and CBM are required.");
      return;
    }
    setCreating(true);
    setMessage("");
    try {
      const response = await fetch("/api/container-available-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType,
          referenceNo: form.referenceNo.trim(),
          masterSku: form.masterSku.trim().toUpperCase(),
          totalQty,
          cbm,
          note: form.note.trim(),
        }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error ?? "Failed to register stock.");
      setForm({ referenceNo: "", masterSku: "", totalQty: "", cbm: "", note: "" });
      setMessage("Available stock registered.");
      await loadRows();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to register stock.");
    } finally {
      setCreating(false);
    }
  }

  async function addSelected() {
    if (selected.length === 0) {
      setMessage("Enter a load quantity for at least one SKU.");
      return;
    }
    const invalid = selected.find((entry) => entry.qty > entry.row.availableQty);
    if (invalid) {
      setMessage(`Quantity exceeds availability for ${invalid.row.masterSku}.`);
      return;
    }
    setSubmitting(true);
    const saved = await onAdd(selected.map((entry) => ({ stockId: entry.stockId, qty: entry.qty })));
    if (!saved) setSubmitting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" onClick={onClose}>
      <div
        className="flex h-[94vh] max-h-[94vh] w-[min(96vw,1280px)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e2dfd8] px-6 py-3">
          <div>
            <h2 className="text-base font-semibold">Add Available Stock to Container</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Allocate already-produced items from Remaining or Mistake Order stock.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-xl text-muted-foreground">X</button>
        </div>

        <div className="flex border-b border-[#e2dfd8] px-6 pt-3">
          {(["remaining", "mistake"] as StockSourceType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setSourceType(type)}
              className={`mr-2 rounded-t-lg border px-4 py-2 text-sm font-semibold ${
                sourceType === type
                  ? "border-[#1a5cdb] border-b-white bg-white text-[#1a5cdb]"
                  : "border-[#e2dfd8] bg-[#f0eee9] text-muted-foreground"
              }`}
            >
              {type === "remaining" ? "Remaining List" : "Mistake Order List"}
            </button>
          ))}
        </div>

        <div className="border-b border-[#e2dfd8] bg-[#f8f7f4] px-4 py-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
            Register {sourceType === "remaining" ? "Remaining" : "Mistake Order"} Stock
          </div>
          <div className="grid gap-2 md:grid-cols-[130px_1fr_90px_100px_1fr_auto]">
            <input className="form-input bg-white text-xs" placeholder="Reference No." value={form.referenceNo} onChange={(e) => setForm((value) => ({ ...value, referenceNo: e.target.value }))} />
            <input className="form-input bg-white font-mono text-xs" placeholder="Master SKU" value={form.masterSku} onChange={(e) => setForm((value) => ({ ...value, masterSku: e.target.value }))} />
            <input className="form-input bg-white text-xs" type="number" placeholder="Qty" value={form.totalQty} onChange={(e) => setForm((value) => ({ ...value, totalQty: e.target.value }))} />
            <input className="form-input bg-white text-xs" type="number" step="0.000001" placeholder="CBM" value={form.cbm} onChange={(e) => setForm((value) => ({ ...value, cbm: e.target.value }))} />
            <input className="form-input bg-white text-xs" placeholder="Note (optional)" value={form.note} onChange={(e) => setForm((value) => ({ ...value, note: e.target.value }))} />
            <button type="button" disabled={creating} onClick={() => void registerStock()} className="rounded-md border border-[#1a5cdb] bg-white px-3 text-xs font-semibold text-[#1a5cdb] disabled:opacity-50">
              {creating ? "Saving..." : "Register"}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-2">
          <input className="form-input w-72 bg-white text-xs" placeholder="Search SKU / reference..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={selectAllVisible}
              disabled={selectableVisibleRows.length === 0 || allVisibleSelected}
              className="rounded-md border border-[#1a5cdb] bg-white px-3 py-1.5 text-xs font-semibold text-[#1a5cdb] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={clearVisibleSelection}
              disabled={!visibleRows.some((row) => Boolean(selectedQty[row.id]))}
              className="rounded-md border border-[#cccac4] bg-white px-3 py-1.5 text-xs font-semibold text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              Clear Selection
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 pb-3">
          <div className="grid grid-cols-[42px_120px_1fr_90px_100px_90px_100px] bg-[#f0eee9] px-3 py-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
            <input
              type="checkbox"
              aria-label="Select all visible available stock"
              checked={allVisibleSelected}
              disabled={selectableVisibleRows.length === 0}
              onChange={(event) => {
                if (event.target.checked) selectAllVisible();
                else clearVisibleSelection();
              }}
            />
            <span>Reference</span>
            <span>Master SKU</span>
            <span>Available</span>
            <span>Load Qty</span>
            <span>CBM</span>
            <span>Total CBM</span>
          </div>
          {loading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading available stock...</div>
          ) : visibleRows.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No available stock registered for this list.</div>
          ) : (
            visibleRows.map((row) => {
              const qty = Number.parseInt(selectedQty[row.id] ?? "", 10) || 0;
              return (
                <div key={row.id} className="grid grid-cols-[42px_120px_1fr_90px_100px_90px_100px] items-center border-b border-[#e2dfd8] px-3 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(selectedQty[row.id])}
                    disabled={row.availableQty <= 0}
                    onChange={(event) => setSelectedQty((current) => ({
                      ...current,
                      [row.id]: event.target.checked ? String(Math.min(row.availableQty, 1)) : "",
                    }))}
                  />
                  <span className="text-xs font-semibold">{row.referenceNo}</span>
                  <span className="font-mono text-xs">{row.masterSku}</span>
                  <span className="font-semibold">{row.availableQty}</span>
                  <input
                    type="number"
                    min={0}
                    max={row.availableQty}
                    value={selectedQty[row.id] ?? ""}
                    disabled={row.availableQty <= 0}
                    onChange={(event) => setSelectedQty((current) => ({ ...current, [row.id]: event.target.value }))}
                    className="h-7 w-20 rounded border border-[#cccac4] px-2 text-sm"
                  />
                  <span>{row.cbm.toFixed(4)}</span>
                  <span>{(qty * row.cbm).toFixed(2)}</span>
                </div>
              );
            })
          )}
        </div>

        {message ? <div className="border-t border-[#e2dfd8] px-6 py-2 text-xs text-[#8a5300]">{message}</div> : null}
        <div className="flex items-center justify-between border-t border-[#e2dfd8] px-6 py-3">
          <span className="text-sm text-muted-foreground">
            Selected: <strong className="text-foreground">{selectedUnits} units / {selectedCbm.toFixed(2)} CBM</strong>
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-[#cccac4] px-4 py-2 text-sm">Cancel</button>
            <button type="button" disabled={submitting} onClick={() => void addSelected()} className="rounded-md bg-[#1a5cdb] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {submitting ? "Adding..." : "Add Selected to Container"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusChangeModal({
  currentStatus,
  onConfirm,
  onClose,
}: {
  currentStatus: ContainerStatus;
  onConfirm: (newStatus: ContainerStatus) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<ContainerStatus>(currentStatus);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-[#e2dfd8] bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-base font-semibold">Change Status</h2>
        <div className="space-y-3">
          {statusOptions.map((option) => (
            <label
              key={option.value}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 transition-colors ${
                selected === option.value
                  ? "border-[#1a5cdb] bg-[#ebf0fd]"
                  : "border-[#e2dfd8] hover:bg-[#f8f7f4]"
              }`}
            >
              <input
                type="radio"
                name="containerStatus"
                value={option.value}
                checked={selected === option.value}
                onChange={() => setSelected(option.value)}
                className="sr-only"
              />
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-black/10"
                style={{
                  backgroundColor: statusColors[option.value],
                  boxShadow: `0 0 0 3px ${statusColors[option.value]}30`,
                }}
              />
              <span className="text-sm font-medium">{statusWorkflowLabels[option.value]}</span>
            </label>
          ))}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#cccac4] px-4 py-2 text-sm font-medium hover:bg-[#f0eee9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            className="rounded-lg bg-[#1a5cdb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1650c4]"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
