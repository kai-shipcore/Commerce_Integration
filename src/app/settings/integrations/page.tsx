"use client";

/**
 * Code Guide:
 * This page renders the settings / integrations screen in the Next.js App Router.
 * Most business logic lives in child components or API routes, so this file mainly wires layout and data views together.
 */
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { AppLayout } from "@/components/layout/app-layout";
import { isAdminLikeRole } from "@/components/layout/navigation-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  RefreshCw,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  ShoppingBag,
} from "lucide-react";
import { MarketplaceIcon } from "@/components/marketplaces/marketplace-icon";

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
}

interface ConnectionCheckResult {
  tone: "success" | "warning" | "error";
  message: string;
}

type IntegrationPlatform = "shopify" | "amazon" | "ebay" | "walmart";
type SecretFieldKey =
  | "accessToken"
  | "secretAccessKey"
  | "clientSecret"
  | "refreshToken"
  | "privateKey";

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
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
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
  accessKeyId: "",
  secretAccessKey: "",
  region: "us-east-1",
  clientId: "",
  clientSecret: "",
  refreshToken: "",
  consumerId: "",
  privateKey: "",
  channelType: "",
  environment: "production",
};

export default function IntegrationsPage() {
  const { data: session } = useSession();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState<string | null>(null);
  const [formData, setFormData] = useState<IntegrationFormState>(initialFormState);
  const [editFormData, setEditFormData] = useState<IntegrationFormState>(initialFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [editFormError, setEditFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [loadingEditId, setLoadingEditId] = useState<string | null>(null);
  const [editingIntegrationId, setEditingIntegrationId] = useState<string | null>(null);
  const [checkingConnectionId, setCheckingConnectionId] = useState<string | null>(null);
  const [connectionResults, setConnectionResults] = useState<
    Record<string, ConnectionCheckResult | undefined>
  >({});

  const fetchIntegrations = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations");
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

  const handleAddIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/integrations", {
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
    } catch (error: any) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openEditDialog = async (integrationId: string) => {
    setLoadingEditId(integrationId);
    setEditFormError(null);

    try {
      const res = await fetch(`/api/integrations/${integrationId}`);
      const data = await res.json();

      if (!data.success) {
        setEditFormError(data.error);
        return;
      }

      const integration = data.data as IntegrationDetail;
      setEditingIntegrationId(integrationId);
      setEditFormData(buildFormStateFromIntegration(integration));
      setEditDialogOpen(true);
    } catch (error: any) {
      setEditFormError(error.message);
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
      const res = await fetch(`/api/integrations/${editingIntegrationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          buildIntegrationPayload(editFormData, { omitEmptySecrets: true })
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
    } catch (error: any) {
      setEditFormError(error.message);
    } finally {
      setUpdating(false);
    }
  };

  const handleSync = async (integrationId: string, fullSync: boolean = false) => {
    setSyncing(integrationId);

    try {
      const res = await fetch(`/api/integrations/${integrationId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullSync }),
      });

      const data = await res.json();

      if (data.success) {
        // Refresh to show updated status
        fetchIntegrations();
      }
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
      setSyncing(null);
    }
  };

  const handleDelete = async (integrationId: string) => {
    try {
      const res = await fetch(`/api/integrations/${integrationId}`, {
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
      const res = await fetch(`/api/integrations/${integrationId}/check`, {
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
          message: data.data?.message || data.error || "Connection check failed.",
        },
      }));
    } catch (error: any) {
      setConnectionResults((current) => ({
        ...current,
        [integrationId]: {
          tone: "error",
          message: error.message || "Connection check failed.",
        },
      }));
    } finally {
      setCheckingConnectionId(null);
    }
  };

  const getPlatformIcon = (platform: string) => {
    return <MarketplaceIcon platform={platform} />;
  };

  const supportsSync = (platform: string) => platform === "shopify";
  const isAdmin = isAdminLikeRole(session?.user?.role);

  const addDialogMeta = getDialogMeta(formData.platform, "add");
  const editDialogMeta = getDialogMeta(editFormData.platform, "edit");

  const getStatusBadge = (integration: Integration) => {
    if (!integration.isActive) {
      return <Badge variant="secondary">Inactive</Badge>;
    }
    if (!integration.lastSyncStatus) {
      return <Badge variant="outline">Never Synced</Badge>;
    }
    if (integration.lastSyncStatus === "success") {
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
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
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Marketplace APIs</h1>
            <p className="text-muted-foreground">
              Connect e-Commerce platform accounts to sync sales data
            </p>
          </div>
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Add Market Place
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{addDialogMeta.title}</DialogTitle>
                <DialogDescription>{addDialogMeta.description}</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddIntegration}>
                {renderIntegrationForm({
                  formData,
                  setFormData,
                  formError,
                  mode: "add",
                })}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setAddDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Connect Market Place
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
                <DialogDescription>{editDialogMeta.description}</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleUpdateIntegration}>
                {renderIntegrationForm({
                  formData: editFormData,
                  setFormData: setEditFormData,
                  formError: editFormError,
                  mode: "edit",
                })}
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updating}>
                    {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Changes
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Integrations List */}
        {loading ? (
          <div className="h-64 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : integrations.length === 0 ? (
            <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <ShoppingBag className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">No integrations yet</h3>
              <p className="text-muted-foreground text-center mb-4">
                Connect Shopify, Amazon, eBay, or Walmart marketplace credentials to manage future sales syncs.
              </p>
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Add Market Place
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {integrations.map((integration) => (
              <Card key={integration.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div className="flex items-center gap-4">
                    {getPlatformIcon(integration.platform)}
                    <div>
                      <CardTitle className="text-lg">{integration.name}</CardTitle>
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
                      <p className="text-sm text-muted-foreground">Orders Synced</p>
                      <p className="text-lg font-medium">{integration.totalOrdersSynced}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Sales Records</p>
                      <p className="text-lg font-medium">{integration.totalRecordsSynced}</p>
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
                      <AlertDescription>{integration.lastSyncError}</AlertDescription>
                    </Alert>
                  )}

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(integration.id)}
                      disabled={!isAdmin || loadingEditId === integration.id}
                      title={!isAdmin ? "You need admin access to edit marketplace integrations." : undefined}
                    >
                      {loadingEditId === integration.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Pencil className="mr-2 h-4 w-4" />
                      )}
                      Edit
                    </Button>
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
                      Sync New
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
                      Full Sync (All History)
                    </Button>
                    <Dialog
                      open={deleteDialogOpen === integration.id}
                      onOpenChange={(open) =>
                        setDeleteDialogOpen(open && isAdmin ? integration.id : null)
                      }
                    >
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive"
                          disabled={!isAdmin}
                          title={!isAdmin ? "You need admin access to remove marketplace integrations." : undefined}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Remove Integration</DialogTitle>
                          <DialogDescription>
                            Are you sure you want to remove this integration? This will stop
                            syncing sales data from this store. Existing sales records will not
                            be deleted.
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <Button
                            variant="outline"
                            onClick={() => setDeleteDialogOpen(null)}
                          >
                            Cancel
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => handleDelete(integration.id)}
                          >
                            Remove Integration
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                  {!supportsSync(integration.platform) && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Stored successfully. Direct sync is currently available only for Shopify.
                    </p>
                  )}
                  {!isAdmin && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Edit, Sync, and Remove are visible for clarity, but only admin or dev users can use them.
                    </p>
                  )}
                  {connectionResults[integration.id] && (
                    <div className="mt-3 flex items-start gap-2 text-sm">
                      {connectionResults[integration.id]?.tone === "success" && (
                        <CheckCircle className="mt-0.5 h-4 w-4 text-green-600" />
                      )}
                      {connectionResults[integration.id]?.tone === "warning" && (
                        <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                      )}
                      {connectionResults[integration.id]?.tone === "error" && (
                        <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
                      )}
                      <p
                        className={
                          connectionResults[integration.id]?.tone === "success"
                            ? "text-green-700"
                            : connectionResults[integration.id]?.tone === "warning"
                              ? "text-amber-700"
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How Sync Works</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              <strong>Automatic Sync:</strong> Sales data is automatically synced every hour via background jobs.
            </p>
            <p>
              <strong>Incremental Updates:</strong> Only new orders since the last sync are fetched to minimize API calls.
            </p>
            <p>
              <strong>SKU Matching:</strong> Orders are matched to existing SKUs by SKU code. New SKUs are auto-created if not found.
            </p>
            <p>
              <strong>Current Platform Support:</strong> Shopify sync is implemented today. Amazon, eBay, and Walmart credentials can now be stored from the same screen.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function renderIntegrationForm({
  formData,
  setFormData,
  formError,
  mode,
}: {
  formData: IntegrationFormState;
  setFormData: React.Dispatch<React.SetStateAction<IntegrationFormState>>;
  formError: string | null;
  mode: "add" | "edit";
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
          <Label htmlFor="platform">Platform</Label>
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
                setFormData((current) => ({ ...current, shopDomain: e.target.value }))
              }
              required
            />
            <p className="text-xs text-muted-foreground">
              Your Shopify store URL (e.g., mystore.myshopify.com)
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-accessToken`}>Admin API Access Token</Label>
            <Input
              id={`${mode}-accessToken`}
              type="password"
              placeholder={
                isEdit ? "Leave blank to keep the current access token" : "shpat_xxxxxxxxxxxxx"
              }
              value={formData.accessToken}
              onChange={(e) =>
                setFormData((current) => ({ ...current, accessToken: e.target.value }))
              }
              required={!isEdit}
            />
            <p className="text-xs text-muted-foreground">
              Create a custom app in Shopify Admin {">"} Settings {">"} Apps {">"} Develop apps
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
                setFormData((current) => ({ ...current, sellerId: e.target.value }))
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
                setFormData((current) => ({ ...current, marketplaceId: e.target.value }))
              }
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-accessKeyId`}>Access Key ID</Label>
            <Input
              id={`${mode}-accessKeyId`}
              value={formData.accessKeyId}
              onChange={(e) =>
                setFormData((current) => ({ ...current, accessKeyId: e.target.value }))
              }
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-secretAccessKey`}>Secret Access Key</Label>
            <Input
              id={`${mode}-secretAccessKey`}
              type="password"
              placeholder={isEdit ? "Leave blank to keep the current secret" : undefined}
              value={formData.secretAccessKey}
              onChange={(e) =>
                setFormData((current) => ({
                  ...current,
                  secretAccessKey: e.target.value,
                }))
              }
              required={!isEdit}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-region`}>Region</Label>
            <Input
              id={`${mode}-region`}
              placeholder="us-east-1"
              value={formData.region}
              onChange={(e) =>
                setFormData((current) => ({ ...current, region: e.target.value }))
              }
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
                setFormData((current) => ({ ...current, clientId: e.target.value }))
              }
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-clientSecret`}>Client Secret</Label>
            <Input
              id={`${mode}-clientSecret`}
              type="password"
              placeholder={isEdit ? "Leave blank to keep the current secret" : undefined}
              value={formData.clientSecret}
              onChange={(e) =>
                setFormData((current) => ({ ...current, clientSecret: e.target.value }))
              }
              required={!isEdit}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-refreshToken`}>Refresh Token</Label>
            <Input
              id={`${mode}-refreshToken`}
              type="password"
              placeholder={isEdit ? "Leave blank to keep the current token" : undefined}
              value={formData.refreshToken}
              onChange={(e) =>
                setFormData((current) => ({ ...current, refreshToken: e.target.value }))
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
      {formData.platform === "walmart" && (
        <>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-consumerId`}>Consumer ID</Label>
            <Input
              id={`${mode}-consumerId`}
              value={formData.consumerId}
              onChange={(e) =>
                setFormData((current) => ({ ...current, consumerId: e.target.value }))
              }
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-privateKey`}>Private Key</Label>
            <Input
              id={`${mode}-privateKey`}
              type="password"
              placeholder={isEdit ? "Leave blank to keep the current private key" : undefined}
              value={formData.privateKey}
              onChange={(e) =>
                setFormData((current) => ({ ...current, privateKey: e.target.value }))
              }
              required={!isEdit}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`${mode}-channelType`}>Channel Type</Label>
            <Input
              id={`${mode}-channelType`}
              placeholder="MP_ITEM"
              value={formData.channelType}
              onChange={(e) =>
                setFormData((current) => ({ ...current, channelType: e.target.value }))
              }
              required
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
            Connection info can be stored now. Automatic sync is still implemented only for Shopify.
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
          ? "Store Walmart marketplace credentials so this marketplace can be connected next."
          : "Update the stored Walmart marketplace credentials. Leave the private key blank to keep the current value.",
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

function buildFormStateFromIntegration(integration: IntegrationDetail): IntegrationFormState {
  const config = integration.config ?? {};

  return {
    platform: integration.platform as IntegrationPlatform,
    name: integration.name ?? "",
    shopDomain: config.shopDomain ?? "",
    accessToken: "",
    sellerId: config.sellerId ?? "",
    marketplaceId: config.marketplaceId ?? "",
    accessKeyId: config.accessKeyId ?? "",
    secretAccessKey: "",
    region: config.region ?? "us-east-1",
    clientId: config.clientId ?? "",
    clientSecret: "",
    refreshToken: "",
    consumerId: config.consumerId ?? "",
    privateKey: "",
    channelType: config.channelType ?? "",
    environment:
      config.environment === "sandbox" ? "sandbox" : "production",
  };
}

function buildIntegrationPayload(
  formData: IntegrationFormState,
  options?: { omitEmptySecrets?: boolean }
) {
  const omitEmptySecrets = options?.omitEmptySecrets ?? false;

  if (formData.platform === "shopify") {
    const config: Record<string, string> = {
      shopDomain: formData.shopDomain,
      apiVersion: "2024-01",
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
      accessKeyId: formData.accessKeyId,
      region: formData.region,
    };

    if (!omitEmptySecrets || formData.secretAccessKey.trim()) {
      config.secretAccessKey = formData.secretAccessKey;
    }

    return {
      name: formData.name,
      ...(omitEmptySecrets ? {} : { platform: "amazon" }),
      config,
    };
  }

  if (formData.platform === "walmart") {
    const config: Record<string, string> = {
      consumerId: formData.consumerId,
      channelType: formData.channelType,
      environment: formData.environment,
    };

    if (!omitEmptySecrets || formData.privateKey.trim()) {
      config.privateKey = formData.privateKey;
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

  for (const [field, value] of [
    ["clientSecret", formData.clientSecret],
    ["refreshToken", formData.refreshToken],
  ] as Array<[SecretFieldKey, string]>) {
    if (!omitEmptySecrets || value.trim()) {
      config[field] = value;
    }
  }

  return {
    name: formData.name,
    ...(omitEmptySecrets ? {} : { platform: "ebay" }),
    config,
  };
}
