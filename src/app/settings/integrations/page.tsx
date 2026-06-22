"use client";

/**
 * Code Guide:
 * This page renders the settings / integrations screen in the Next.js App Router.
 * Most business logic lives in child components or API routes, so this file mainly wires layout and data views together.
 */
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { AppLayout } from "@/components/layout/app-layout";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Pencil,
  Plug,
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  ShoppingBag,
} from "lucide-react";
import { MarketplaceIcon } from "@/components/marketplaces/marketplace-icon";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

type TokenStatus = "valid" | "expiring_soon" | "expired" | "none";

interface Integration {
  id: string;
  platform: string;
  name: string;
  isActive: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  totalOrdersSynced: number;
  totalRecordsSynced: number;
  createdAt: string;
  tokenStatus?: TokenStatus;
}

interface ConnectionCheckResult {
  tone: "success" | "warning" | "error";
  message: string;
}

type IntegrationPlatform = "shopify" | "amazon" | "ebay" | "walmart";

interface IntegrationDetail extends Integration {
  config: Partial<Record<keyof IntegrationFormState, string>>;
}

interface IntegrationFormState {
  platform: IntegrationPlatform;
  name: string;
  shopDomain: string;
  accessToken: string;
  sellerId: string;
  marketplaceId: string;
  lwaClientId: string;
  lwaClientSecret: string;
  lwaRefreshToken: string;
  clientId: string;
  clientSecret: string;
  ruName: string;
  consumerId: string;
  privateKey: string;
  channelType: string;
  environment: "sandbox" | "production";
}

const initialFormState: IntegrationFormState = {
  platform: "shopify",
  name: "",
  shopDomain: "",
  accessToken: "",
  sellerId: "",
  marketplaceId: "",
  lwaClientId: "",
  lwaClientSecret: "",
  lwaRefreshToken: "",
  clientId: "",
  clientSecret: "",
  ruName: "",
  consumerId: "",
  privateKey: "",
  channelType: "",
  environment: "production",
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export default function IntegrationsPage() {
  const { pick } = useI18n();
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const [reauthBanner, setReauthBanner] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<string | null>(null);
  const [formData, setFormData] =
    useState<IntegrationFormState>(initialFormState);
  const [editFormData, setEditFormData] =
    useState<IntegrationFormState>(initialFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [editFormError, setEditFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [editingIntegrationId, setEditingIntegrationId] = useState<
    string | null
  >(null);
  const [checkingConnectionId, setCheckingConnectionId] = useState<
    string | null
  >(null);
  const [connectionResults, setConnectionResults] = useState<
    Record<string, ConnectionCheckResult | undefined>
  >({});

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch(apiPath("/api/integrations"));
      const data = await res.json();
      if (data.success) {
        setIntegrations(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch integrations:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  useEffect(() => {
    const reauth = searchParams.get("ebay_reauth");
    const ebayError = searchParams.get("ebay_error");
    if (reauth === "success") {
      setReauthBanner({
        type: "success",
        message:
          "eBay re-authentication successful. Your new refresh token has been saved.",
      });
      window.history.replaceState(null, "", window.location.pathname);
    } else if (ebayError) {
      setReauthBanner({
        type: "error",
        message: `eBay re-authentication failed: ${ebayError}`,
      });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [searchParams]);

  const handleAddIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await fetch(apiPath("/api/integrations"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildIntegrationPayload(formData)),
      });

      const data = await res.json();

      if (!data.success) {
        setFormError(data.error);
        return;
      }

      setAddDialogOpen(false);
      setFormData(initialFormState);
      fetchIntegrations();
    } catch (error: unknown) {
      setFormError(getErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const openEditDialog = async (integrationId: string) => {
    setLoadingEditId(integrationId);
    setEditFormError(null);

    try {
      const res = await fetch(apiPath(`/api/integrations/${integrationId}`));
      const data = await res.json();

      if (!data.success) {
        setEditFormError(data.error);
        return;
      }

      const integration = data.data as IntegrationDetail;
      setEditingIntegrationId(integrationId);
      setEditFormData(buildFormStateFromIntegration(integration));
      setEditDialogOpen(true);
    } catch (error: unknown) {
      setEditFormError(getErrorMessage(error));
    } finally {
      setLoadingEditId(null);
    }
  };

  const handleUpdateIntegration = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingIntegrationId) {
      return;
    }

    setEditFormError(null);
    setUpdating(true);

    try {
      const res = await fetch(apiPath(`/api/integrations/${editingIntegrationId}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildIntegrationPayload(editFormData, { omitEmptySecrets: true }),
        ),
      });

      const data = await res.json();

      if (!data.success) {
        setEditFormError(data.error);
        return;
      }

      setEditDialogOpen(false);
      setEditingIntegrationId(null);
      setEditFormData(initialFormState);
      fetchIntegrations();
    } catch (error: unknown) {
      setEditFormError(getErrorMessage(error));
    } finally {
      setUpdating(false);
    }
  };

  const handleSync = async (
    integrationId: string,
    fullSync: boolean = false,
  ) => {
    setSyncing(integrationId);

    try {
      const res = await fetch(apiPath(`/api/integrations/${integrationId}/sync`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullSync }),
      });

      await res.json();
    } catch (error) {
      console.error("Sync failed:", error);
      fetchIntegrations();
    } finally {
      setSyncing(null);
      fetchIntegrations();
    }
  };

  const handleDelete = async (integrationId: string) => {
    try {
      const res = await fetch(apiPath(`/api/integrations/${integrationId}`), {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        setDeleteDialogOpen(null);
        fetchIntegrations();
      }
    } catch (error) {
      console.error("Delete failed:", error);
    }
  };

  const handleCheckConnection = async (integrationId: string) => {
    setCheckingConnectionId(integrationId);

    try {
      const res = await fetch(apiPath(`/api/integrations/${integrationId}/check`), {
        method: "POST",
      });
      const data = await res.json();

      const status = data.data?.status as
        | "connected"
        | "credentials_saved"
        | "incomplete"
        | "failed"
        | undefined;

      const tone =
        status === "connected"
          ? "success"
          : status === "credentials_saved"
            ? "warning"
            : "error";

      setConnectionResults((current) => ({
        ...current,
        [integrationId]: {
          tone,
          message:
            data.data?.message || data.error || "Connection check failed.",
        },
      }));

      if (status === "connected") {
        fetchIntegrations();
      }
    } catch (error: unknown) {
      setConnectionResults((current) => ({
        ...current,
        [integrationId]: {
          tone: "error",
          message: getErrorMessage(error) || "Connection check failed.",
        },
      }));
    } finally {
      setCheckingConnectionId(null);
    }
  };

  const getPlatformIcon = (platform: string) => {
    return <MarketplaceIcon platform={platform} />;
  };

  const supportsSync = (platform: string) =>
    platform === "shopify" || platform === "ebay" || platform === "walmart" || platform === "amazon";
  const isAdmin = isAdminLikeRole(session?.user?.role);

  const addDialogMeta = getDialogMeta(formData.platform, "add");
  const editDialogMeta = getDialogMeta(editFormData.platform, "edit");
  const activeCount = integrations.filter((integration) => integration.isActive).length;
  const syncedCount = integrations.filter((integration) => integration.lastSyncStatus === "success").length;
  const failedCount = integrations.filter((integration) => integration.lastSyncStatus === "failed").length;
  const totalOrdersSynced = integrations.reduce((sum, integration) => sum + integration.totalOrdersSynced, 0);

  const getStatusBadge = (integration: Integration) => {
    if (!integration.isActive) {
      return <Badge variant="secondary">Inactive</Badge>;
    }
    if (!integration.lastSyncStatus) {
      return <Badge variant="outline">Never Synced</Badge>;
    }
    if (integration.lastSyncStatus === "success") {
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-950/60 dark:text-green-300 dark:hover:bg-green-950/60">
          <CheckCircle className="h-3 w-3 mr-1" />
          Synced
        </Badge>
      );
    }
    return (
      <Badge variant="destructive">
        <XCircle className="h-3 w-3 mr-1" />
        Failed
      </Badge>
    );
  };

  return (
    <AppLayout>
      <section className="flex min-h-[calc(100vh-7rem)] flex-col overflow-hidden rounded-2xl border border-[#e2dfd8] bg-[#f5f4f0] text-foreground shadow-sm dark:border-slate-700 dark:bg-slate-950">
        {/* eBay re-auth result banner */}
        {reauthBanner && (
          <Alert
            variant={reauthBanner.type === "error" ? "destructive" : "default"}
            className="m-4 mb-0 bg-white dark:bg-slate-900"
          >
            {reauthBanner.type === "success" ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            <AlertDescription className="flex items-center justify-between">
              <span>{reauthBanner.message}</span>
              <button
                onClick={() => setReauthBanner(null)}
                className="ml-4 text-sm underline"
              >
                Dismiss
              </button>
            </AlertDescription>
          </Alert>
        )}

        {/* Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e2dfd8] bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start gap-2">
            <Plug className="mt-1 h-5 w-5" />
            <div>
              <h1 className="text-lg font-semibold">Marketplace APIs</h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Connect e-Commerce platform accounts to sync sales data
              </p>
            </div>
          </div>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="bg-[#1a5cdb] hover:bg-[#1650c4]">
                <Plus className="mr-2 h-4 w-4" />
                {pick("마켓플레이스 추가", "Add Market Place")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{addDialogMeta.title}</DialogTitle>
                <DialogDescription>
                  {addDialogMeta.description}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddIntegration}>
                {renderIntegrationForm({
                  formData,
                  setFormData,
                  formError,
                  mode: "add",
                  pick,
                })}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddDialogOpen(false)}
                  >
                    {pick("취소", "Cancel")}
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {pick("마켓플레이스 연결", "Connect Market Place")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog
            open={editDialogOpen}
            onOpenChange={(open) => {
              setEditDialogOpen(open);
              if (!open) {
                setEditingIntegrationId(null);
                setEditFormError(null);
                setEditFormData(initialFormState);
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editDialogMeta.title}</DialogTitle>
                <DialogDescription>
                  {editDialogMeta.description}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleUpdateIntegration}>
                {renderIntegrationForm({
                  formData: editFormData,
                  setFormData: setEditFormData,
                  formError: editFormError,
                  mode: "edit",
                  pick,
                })}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditDialogOpen(false)}
                  >
                    {pick("취소", "Cancel")}
                  </Button>
                  <Button type="submit" disabled={updating}>
                    {updating && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {pick("변경사항 저장", "Save Changes")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </header>

        <div className="grid grid-cols-2 border-b border-[#e2dfd8] bg-[#f0eee9] dark:border-slate-700 dark:bg-slate-900 md:grid-cols-4">
          <IntegrationStat label="Total APIs" value={integrations.length.toLocaleString()} sub="Marketplace connections" />
          <IntegrationStat label="Active" value={activeCount.toLocaleString()} sub="Enabled sync sources" />
          <IntegrationStat label="Synced" value={syncedCount.toLocaleString()} sub={`${failedCount.toLocaleString()} failed`} />
          <IntegrationStat label="Orders Synced" value={totalOrdersSynced.toLocaleString()} sub="All integrations" />
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto bg-white p-5 dark:bg-slate-950">
        {/* Integrations List */}
        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : integrations.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-[#cccac4] bg-[#f0eee9] dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-col items-center justify-center px-6 py-12">
              <ShoppingBag className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No integrations yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Connect Shopify, Amazon, eBay, or Walmart marketplace
                credentials to manage future sales syncs.
              </p>
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {pick("마켓플레이스 추가", "Add Market Place")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {integrations.map((integration) => (
              <Card key={integration.id} className="overflow-hidden rounded-lg border-[#e2dfd8] shadow-none dark:border-slate-700 dark:bg-slate-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-4">
                    {getPlatformIcon(integration.platform)}
                    <div>
                      <CardTitle className="text-lg">
                        {integration.name}
                      </CardTitle>
                      <CardDescription className="capitalize">
                        {integration.platform}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(integration)}
                    {!isAdmin && (
                      <Badge variant="outline">Admin only for edits</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Orders Synced
                      </p>
                      <p className="text-lg font-medium">
                        {integration.totalOrdersSynced}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Sales Records
                      </p>
                      <p className="text-lg font-medium">
                        {integration.totalRecordsSynced}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Last Sync</p>
                      <p className="text-sm font-medium">
                        {integration.lastSyncAt
                          ? new Date(integration.lastSyncAt).toLocaleString()
                          : "Never"}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Created</p>
                      <p className="text-sm font-medium">
                        {new Date(integration.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  {integration.lastSyncError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        {integration.lastSyncError}
                      </AlertDescription>
                    </Alert>
                  )}

                  {integration.tokenStatus && (
                    <div className="mb-4">
                      {integration.tokenStatus === "valid" && (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-950/60 dark:text-green-300 dark:hover:bg-green-950/60">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {pick("Access Token 유효", "Token valid")}
                        </Badge>
                      )}
                      {integration.tokenStatus === "expiring_soon" && (
                        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          {pick("곧 만료", "Expiring soon")}
                        </Badge>
                      )}
                      {integration.tokenStatus === "expired" && (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          {pick("만료됨", "Expired")}
                        </Badge>
                      )}
                      {integration.tokenStatus === "none" && (
                        <Badge variant="outline">{pick("없음", "None")}</Badge>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(integration.id)}
                      disabled={!isAdmin || loadingEditId === integration.id}
                      title={
                        !isAdmin
                          ? "You need admin access to edit marketplace integrations."
                          : undefined
                      }
                    >
                      {loadingEditId === integration.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Pencil className="mr-2 h-4 w-4" />
                      )}
                      {pick("편집", "Edit")}
                    </Button>
                    {integration.platform === "ebay" && isAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          window.location.href = apiPath(`/api/integrations/${integration.id}/ebay-auth`);
                        }}
                        title="Get a new refresh token via eBay OAuth"
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Re-authenticate
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCheckConnection(integration.id)}
                      disabled={checkingConnectionId === integration.id}
                    >
                      {checkingConnectionId === integration.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="mr-2 h-4 w-4" />
                      )}
                      Check Connection
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync(integration.id, false)}
                      disabled={
                        !isAdmin ||
                        syncing === integration.id ||
                        !supportsSync(integration.platform)
                      }
                      title={
                        !isAdmin
                          ? "You need admin or dev access to sync marketplace integrations."
                          : undefined
                      }
                    >
                      {syncing === integration.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      {pick("신규 동기화", "Sync New")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSync(integration.id, true)}
                      disabled={
                        !isAdmin ||
                        syncing === integration.id ||
                        !supportsSync(integration.platform)
                      }
                      title={
                        !isAdmin
                          ? "You need admin or dev access to sync marketplace integrations."
                          : undefined
                      }
                    >
                      {syncing === integration.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-2 h-4 w-4" />
                      )}
                      {pick("전체 동기화", "Full Sync")}
                    </Button>
                    <Dialog
                      open={deleteDialogOpen === integration.id}
                      onOpenChange={(open) =>
                        setDeleteDialogOpen(
                          open && isAdmin ? integration.id : null,
                        )
                      }
                    >
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          disabled={!isAdmin}
                          title={
                            !isAdmin
                              ? "You need admin access to remove marketplace integrations."
                              : undefined
                          }
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {pick("삭제", "Remove")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{pick("연동 삭제", "Remove Integration")}</DialogTitle>
                          <DialogDescription>
                            {pick("이 연동을 삭제하시겠습니까? 해당 스토어의 판매 데이터 동기화가 중단됩니다. 기존 판매 기록은 삭제되지 않습니다.", "Are you sure you want to remove this integration? This will stop syncing sales data from this store. Existing sales records will not be deleted.")}
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setDeleteDialogOpen(null)}
                          >
                            {pick("취소", "Cancel")}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => handleDelete(integration.id)}
                          >
                            {pick("연동 삭제", "Remove Integration")}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  {!supportsSync(integration.platform) && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Stored successfully. Automatic sync is not yet available
                      for this platform.
                    </p>
                  )}
                  {!isAdmin && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Edit, Sync, and Remove are visible for clarity, but only
                      admin or dev users can use them.
                    </p>
                  )}
                  {connectionResults[integration.id] && (
                    <div className="mt-3 flex items-start gap-2 text-sm">
                      {connectionResults[integration.id]?.tone ===
                        "success" && (
                        <CheckCircle className="mt-0.5 h-4 w-4 text-green-600" />
                      )}
                      {connectionResults[integration.id]?.tone ===
                        "warning" && (
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                      )}
                      {connectionResults[integration.id]?.tone === "error" && (
                        <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                      )}
                      <p
                        className={
                          connectionResults[integration.id]?.tone === "success"
                            ? "text-green-700 dark:text-green-300"
                            : connectionResults[integration.id]?.tone ===
                                "warning"
                              ? "text-amber-700 dark:text-amber-300"
                              : "text-destructive"
                        }
                      >
                        {connectionResults[integration.id]?.message}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Info Card */}
        <Card className="mt-5 rounded-lg border-[#e2dfd8] shadow-none dark:border-slate-700 dark:bg-slate-900">
          <CardHeader>
            <CardTitle className="text-base">How Sync Works</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Automatic Sync:</strong> Sales data is automatically
              synced every hour via background jobs.
            </p>
            <p>
              <strong>Incremental Updates:</strong> Only new orders since the
              last sync are fetched to minimize API calls.
            </p>
            <p>
              <strong>SKU Matching:</strong> Orders are matched to existing SKUs
              by SKU code. New SKUs are auto-created if not found.
            </p>
            <p>
              <strong>Current Platform Support:</strong> Shopify and Walmart
              sync are implemented. Amazon and eBay credentials can be stored
              and will be supported in a future update.
            </p>
          </CardContent>
        </Card>
        </main>
      </section>
    </AppLayout>
  );
}

function IntegrationStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="border-r border-[#e2dfd8] px-5 py-3 last:border-r-0 dark:border-slate-700">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold text-foreground">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function renderIntegrationForm({
  formData,
  setFormData,
  formError,
  mode,
  pick,
}: {
  formData: IntegrationFormState;
  setFormData: React.Dispatch<React.SetStateAction<IntegrationFormState>>;
  formError: string | null;
  mode: "add" | "edit";
  pick: (ko: string, en: string) => string;
}) {
  const isEdit = mode === "edit";

  return (
    <div className="grid gap-4 py-4">
      {formError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      {!isEdit && (
        <div className="grid gap-2">
          <Label htmlFor="platform">{pick("플랫폼", "Platform")}</Label>
          <Select
            value={formData.platform}
            onValueChange={(value: IntegrationPlatform) =>
              setFormData((current) => ({ ...current, platform: value }))
            }
          >
            <SelectTrigger id="platform">
              <SelectValue placeholder="Select platform" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shopify">Shopify</SelectItem>
              <SelectItem value="amazon">Amazon</SelectItem>
              <SelectItem value="ebay">eBay</SelectItem>
              <SelectItem value="walmart">Walmart</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor={`${mode}-name`}>Integration Name</Label>
        <Input
          id={`${mode}-name`}
          placeholder={getIntegrationNamePlaceholder(formData.platform)}
          value={formData.name}
          onChange={(e) =>
            setFormData((current) => ({ ...current, name: e.target.value }))
          }
          required
        />
      </div>
      {formData.platform === "shopify" && (
        <>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-shopDomain`}>Shop Domain</Label>
            <Input
              id={`${mode}-shopDomain`}
              placeholder="mystore.myshopify.com"
              value={formData.shopDomain}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  shopDomain: e.target.value,
                }))
              }
              required
            />
            <p className="text-xs text-muted-foreground">
              Your Shopify store URL (e.g., mystore.myshopify.com)
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-accessToken`}>
              Admin API Access Token
            </Label>
            <Input
              id={`${mode}-accessToken`}
              type="password"
              placeholder={
                isEdit
                  ? "Leave blank to keep the current access token"
                  : "shpat_xxxxxxxxxxxxx"
              }
              value={formData.accessToken}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  accessToken: e.target.value,
                }))
              }
              required={!isEdit}
            />
            <p className="text-xs text-muted-foreground">
              Create a custom app in Shopify Admin {">"} Settings {">"} Apps{" "}
              {">"} Develop apps
            </p>
          </div>
        </>
      )}
      {formData.platform === "amazon" && (
        <>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-sellerId`}>Seller ID</Label>
            <Input
              id={`${mode}-sellerId`}
              value={formData.sellerId}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  sellerId: e.target.value,
                }))
              }
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-marketplaceId`}>Marketplace ID</Label>
            <Input
              id={`${mode}-marketplaceId`}
              placeholder="ATVPDKIKX0DER"
              value={formData.marketplaceId}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  marketplaceId: e.target.value,
                }))
              }
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-lwaClientId`}>LWA Client ID</Label>
            <Input
              id={`${mode}-lwaClientId`}
              value={formData.lwaClientId}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  lwaClientId: e.target.value,
                }))
              }
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-lwaClientSecret`}>LWA Client Secret</Label>
            <Input
              id={`${mode}-lwaClientSecret`}
              type="password"
              placeholder={isEdit ? "Leave blank to keep the current secret" : undefined}
              value={formData.lwaClientSecret}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  lwaClientSecret: e.target.value,
                }))
              }
              required={!isEdit}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-lwaRefreshToken`}>LWA Refresh Token</Label>
            <Input
              id={`${mode}-lwaRefreshToken`}
              type="password"
              placeholder={isEdit ? "Leave blank to keep the current token" : undefined}
              value={formData.lwaRefreshToken}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  lwaRefreshToken: e.target.value,
                }))
              }
              required={!isEdit}
            />
          </div>
        </>
      )}
      {formData.platform === "ebay" && (
        <>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-clientId`}>Client ID</Label>
            <Input
              id={`${mode}-clientId`}
              value={formData.clientId}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  clientId: e.target.value,
                }))
              }
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-clientSecret`}>Client Secret</Label>
            <Input
              id={`${mode}-clientSecret`}
              type="password"
              placeholder={
                isEdit ? "Leave blank to keep the current secret" : undefined
              }
              value={formData.clientSecret}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  clientSecret: e.target.value,
                }))
              }
              required={!isEdit}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-ruName`}>RuName</Label>
            <Input
              id={`${mode}-ruName`}
              placeholder="e.g. YourApp__YourApp-AppName-PRD-abcdef"
              value={formData.ruName}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  ruName: e.target.value,
                }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-environment`}>Environment</Label>
            <Select
              value={formData.environment}
              onValueChange={(value: "sandbox" | "production") =>
                setFormData((current) => ({ ...current, environment: value }))
              }
            >
              <SelectTrigger id={`${mode}-environment`}>
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production">production</SelectItem>
                <SelectItem value="sandbox">sandbox</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      {formData.platform === "walmart" && (
        <>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-clientId`}>Client ID</Label>
            <Input
              id={`${mode}-clientId`}
              value={formData.clientId}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  clientId: e.target.value,
                }))
              }
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-clientSecret`}>Client Secret</Label>
            <Input
              id={`${mode}-clientSecret`}
              type="password"
              placeholder={
                isEdit ? "Leave blank to keep the current secret" : undefined
              }
              value={formData.clientSecret}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  clientSecret: e.target.value,
                }))
              }
              required={!isEdit}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-environment`}>Environment</Label>
            <Select
              value={formData.environment}
              onValueChange={(value: "sandbox" | "production") =>
                setFormData((current) => ({ ...current, environment: value }))
              }
            >
              <SelectTrigger id={`${mode}-environment`}>
                <SelectValue placeholder="Select environment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="production">production</SelectItem>
                <SelectItem value="sandbox">sandbox</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      {formData.platform !== "shopify" && (
        <Alert>
          <AlertDescription>
            Connection info can be stored now. Automatic sync is still
            implemented only for Shopify.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function getDialogMeta(platform: IntegrationPlatform, mode: "add" | "edit") {
  const action = mode === "add" ? "Connect" : "Edit";

  if (platform === "shopify") {
    return {
      title: `${action} Shopify Market Place`,
      description:
        mode === "add"
          ? "Enter your Shopify store details to sync sales data automatically."
          : "Update your Shopify marketplace details. Leave the token blank to keep the current one.",
    };
  }

  if (platform === "amazon") {
    return {
      title: `${action} Amazon Market Place`,
      description:
        mode === "add"
          ? "Store Amazon marketplace credentials so this marketplace can be connected next."
          : "Update the stored Amazon marketplace credentials. Leave the secret blank to keep the current one.",
    };
  }

  if (platform === "walmart") {
    return {
      title: `${action} Walmart Market Place`,
      description:
        mode === "add"
          ? "Enter your Walmart Marketplace API credentials to enable connection checks."
          : "Update your Walmart Marketplace credentials. Leave the secret blank to keep the current value.",
    };
  }

  return {
    title: `${action} eBay Market Place`,
    description:
      mode === "add"
        ? "Store eBay marketplace credentials so this marketplace can be connected next."
        : "Update the stored eBay marketplace credentials. Leave secret fields blank to keep the current values.",
  };
}

function getIntegrationNamePlaceholder(platform: IntegrationPlatform) {
  if (platform === "shopify") {
    return "My Shopify Store";
  }

  if (platform === "amazon") {
    return "My Amazon Marketplace";
  }

  if (platform === "walmart") {
    return "My Walmart Marketplace";
  }

  return "My eBay Shop";
}

function buildFormStateFromIntegration(
  integration: IntegrationDetail,
): IntegrationFormState {
  const config = integration.config ?? {};

  return {
    platform: integration.platform as IntegrationPlatform,
    name: integration.name ?? "",
    shopDomain: config.shopDomain ?? "",
    accessToken: "",
    sellerId: config.sellerId ?? "",
    marketplaceId: config.marketplaceId ?? "",
    lwaClientId: config.lwaClientId ?? "",
    lwaClientSecret: "",
    lwaRefreshToken: "",
    clientId: config.clientId ?? "",
    clientSecret: "",
    ruName: config.ruName ?? "",
    consumerId: "",
    privateKey: "",
    channelType: "",
    environment: config.environment === "sandbox" ? "sandbox" : "production",
  };
}

function buildIntegrationPayload(
  formData: IntegrationFormState,
  options?: { omitEmptySecrets?: boolean },
) {
  const omitEmptySecrets = options?.omitEmptySecrets ?? false;

  if (formData.platform === "shopify") {
    const config: Record<string, string> = {
      shopDomain: formData.shopDomain,
      apiVersion: "2025-01",
    };

    if (!omitEmptySecrets || formData.accessToken.trim()) {
      config.accessToken = formData.accessToken;
    }

    return {
      name: formData.name,
      ...(omitEmptySecrets ? {} : { platform: "shopify" }),
      config,
    };
  }

  if (formData.platform === "amazon") {
    const config: Record<string, string> = {
      sellerId: formData.sellerId,
      marketplaceId: formData.marketplaceId,
      lwaClientId: formData.lwaClientId,
    };

    if (!omitEmptySecrets || formData.lwaClientSecret.trim()) {
      config.lwaClientSecret = formData.lwaClientSecret;
    }
    if (!omitEmptySecrets || formData.lwaRefreshToken.trim()) {
      config.lwaRefreshToken = formData.lwaRefreshToken;
    }

    return {
      name: formData.name,
      ...(omitEmptySecrets ? {} : { platform: "amazon" }),
      config,
    };
  }

  if (formData.platform === "walmart") {
    const config: Record<string, string> = {
      clientId: formData.clientId,
      environment: formData.environment,
    };

    if (!omitEmptySecrets || formData.clientSecret.trim()) {
      config.clientSecret = formData.clientSecret;
    }

    return {
      name: formData.name,
      ...(omitEmptySecrets ? {} : { platform: "walmart" }),
      config,
    };
  }

  const config: Record<string, string> = {
    clientId: formData.clientId,
    environment: formData.environment,
  };

  if (formData.ruName.trim()) {
    config.ruName = formData.ruName;
  }

  if (!omitEmptySecrets || (formData.clientSecret.trim() && formData.clientSecret !== "********")) {
    config.clientSecret = formData.clientSecret;
  }

  return {
    name: formData.name,
    ...(omitEmptySecrets ? {} : { platform: "ebay" }),
    config,
  };
}
