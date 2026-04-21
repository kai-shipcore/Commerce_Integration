"use client";

/**
 * Code Guide:
 * This page renders the collections screen in the Next.js App Router.
 * Most business logic lives in child components or API routes, so this file mainly wires layout and data views together.
 */
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CollectionFormDialog } from "@/components/collection/collection-form-dialog";
import { FolderKanban, Package } from "lucide-react";

interface Collection {
  id: string;
  name: string;
  description: string | null;
  colorCode: string | null;
  isPinned: boolean;
  _count: {
    members: number;
  };
}

export default function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCollections = useCallback(() => {
    setLoading(true);
    fetch("/api/collections")
      .then((res) => res.json())
      .then((result) => {
        if (result.success) {
          setCollections(result.data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchCollections();
  }, [fetchCollections]);

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Collections</h1>
            <p className="text-muted-foreground">
              Organize SKUs into collections
            </p>
          </div>
          <CollectionFormDialog onSuccess={fetchCollections} />
        </div>

        {/* Collections Grid */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <div className="h-6 w-48 animate-pulse bg-muted rounded" />
                </CardHeader>
                <CardContent>
                  <div className="h-20 animate-pulse bg-muted rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : collections.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FolderKanban className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">No collections yet</p>
              <p className="text-sm text-muted-foreground mb-4">
                Create your first collection to organize SKUs
              </p>
              <CollectionFormDialog onSuccess={fetchCollections} />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <Link key={collection.id} href={`/collections/${collection.id}`}>
                <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">
                            {collection.name}
                          </CardTitle>
                          {collection.isPinned && (
                            <Badge variant="secondary" className="text-xs">
                              Pinned
                            </Badge>
                          )}
                        </div>
                        {collection.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {collection.description}
                          </p>
                        )}
                      </div>
                      {collection.colorCode && (
                        <div
                          className="w-4 h-4 rounded-full flex-shrink-0"
                          style={{ backgroundColor: collection.colorCode }}
                        />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Package className="h-4 w-4" />
                      <span>
                        {collection._count.members}{" "}
                        {collection._count.members === 1 ? "SKU" : "SKUs"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
