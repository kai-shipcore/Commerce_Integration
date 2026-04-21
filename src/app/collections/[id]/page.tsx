"use client";

/**
 * Code Guide:
 * This page renders the collections / [id] screen in the Next.js App Router.
 * Most business logic lives in child components or API routes, so this file mainly wires layout and data views together.
 */
import { useState, useEffect, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollectionFormDialog } from "@/components/collection/collection-form-dialog";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { Package, Edit, Trash2 } from "lucide-react";

interface CollectionMember {
  sku: {
    id: string;
    skuCode: string;
    name: string;
    currentStock: number;
    retailPrice: string | null;
  };
  salesLast30Days?: number;
  revenueLast30Days?: string;
}

interface CollectionDetail {
  id: string;
  name: string;
  description: string | null;
  colorCode: string | null;
  isPinned: boolean;
  members: CollectionMember[];
}

export default function CollectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [collection, setCollection] = useState<CollectionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCollection = useCallback(() => {
    setLoading(true);
    fetch(`/api/collections/${id}`)
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setCollection(result.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchCollection();
  }, [fetchCollection]);

  const handleDelete = async () => {
    const response = await fetch(`/api/collections/${id}`, { method: "DELETE" });
    const result = await response.json();

    if (result.success) {
      router.push("/collections");
    } else {
      throw new Error(result.error);
    }
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="h-96 flex items-center justify-center">
          <div className="text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto mb-4" />
            <p className="text-muted-foreground">Loading collection...</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (!collection) {
    return (
      <AppLayout>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Collection not found</p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {collection.colorCode && (
              <div
                className="w-8 h-8 rounded-lg"
                style={{ backgroundColor: collection.colorCode }}
              />
            )}
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight">
                  {collection.name}
                </h1>
                {collection.isPinned && (
                  <Badge variant="secondary">Pinned</Badge>
                )}
              </div>
              {collection.description && (
                <p className="text-muted-foreground mt-1">
                  {collection.description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CollectionFormDialog
              editData={{
                id: collection.id,
                name: collection.name,
                description: collection.description || "",
                colorCode: collection.colorCode || "#ef4444",
                isPinned: collection.isPinned,
                skuIds: collection.members.map((m) => m.sku.id),
              }}
              onSuccess={fetchCollection}
              trigger={
                <Button variant="outline">
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
              }
            />
            <DeleteDialog
              title="Delete Collection"
              description={`Are you sure you want to delete "${collection.name}"? This will not delete the SKUs themselves, only the collection.`}
              onConfirm={handleDelete}
              trigger={
                <Button variant="outline">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              }
            />
          </div>
        </div>

        {/* Collection Members */}
        <Card>
          <CardHeader>
            <CardTitle>
              SKUs in Collection ({collection.members.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {collection.members.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-lg font-medium">No SKUs in collection</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Add SKUs to this collection
                </p>
                <Button>Add SKUs</Button>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {collection.members.map((member) => (
                  <Link
                    key={member.sku.id}
                    href={`/skus/${member.sku.id}`}
                    className="p-4 rounded-lg border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <p className="font-medium">{member.sku.name}</p>
                        <Badge variant="outline">{member.sku.skuCode}</Badge>
                      </div>
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Stock:</span>
                        <span className="font-medium">
                          {member.sku.currentStock} units
                        </span>
                      </div>
                      {member.sku.retailPrice && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Price:</span>
                          <span className="font-medium">
                            ${parseFloat(member.sku.retailPrice).toFixed(2)}
                          </span>
                        </div>
                      )}
                      {member.salesLast30Days !== undefined && (
                        <div className="flex justify-between pt-2 border-t">
                          <span className="text-muted-foreground">
                            Sales (30d):
                          </span>
                          <span className="font-medium">
                            {member.salesLast30Days} units
                          </span>
                        </div>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
