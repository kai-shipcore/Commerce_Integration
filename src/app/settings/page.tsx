"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Moon, Sun } from "lucide-react";

export default function SettingsPage() {
  const { data: session, status, update } = useSession();
  const { resolvedTheme, setTheme } = useTheme();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    role: "",
  });

  useEffect(() => {
    const loadSettings = async () => {
      if (status === "loading") {
        return;
      }

      if (status !== "authenticated") {
        setLoading(false);
        return;
      }

      try {
        const profileResponse = await fetch("/api/settings/profile", { cache: "no-store" });

        const profileResult = await profileResponse.json();

        if (!profileResponse.ok || !profileResult.success) {
          throw new Error(profileResult.error || "Failed to load profile");
        }

        setProfile({
          name: profileResult.data?.name || "",
          email: profileResult.data?.email || "",
          role: profileResult.data?.role || "user",
        });
        setError(null);
      } catch (fetchError: any) {
        setError(fetchError.message);
      } finally {
        setLoading(false);
      }
    };

    void loadSettings();
  }, [status]);

  const saveProfile = async () => {
    setSavingProfile(true);
    setError(null);

    try {
      const response = await fetch("/api/settings/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          email: profile.email,
        }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to save profile");
      }

      setProfile((current) => ({
        ...current,
        name: result.data?.name || current.name,
        email: result.data?.email || current.email,
      }));

      await update({
        user: {
          name: result.data?.name,
          email: result.data?.email,
        },
      });
    } catch (saveError: any) {
      setError(saveError.message);
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Manage your profile, theme, and personal navigation preferences.
          </p>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <Card id="profile">
              <CardHeader>
                <CardTitle>Profile</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="settings-name">Name</Label>
                    <Input
                      id="settings-name"
                      value={profile.name}
                      disabled={savingProfile}
                      onChange={(event) =>
                        setProfile((current) => ({ ...current, name: event.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-email">Email</Label>
                    <Input
                      id="settings-email"
                      type="email"
                      value={profile.email}
                      disabled={savingProfile}
                      onChange={(event) =>
                        setProfile((current) => ({ ...current, email: event.target.value }))
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">Role</p>
                    <p className="text-sm text-muted-foreground">
                      Your access level is managed separately.
                    </p>
                  </div>
                  <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    {profile.role}
                  </span>
                </div>
                <div className="flex justify-end">
                  <Button type="button" onClick={() => void saveProfile()} disabled={savingProfile}>
                    {savingProfile ? "Saving..." : "Save Profile"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Appearance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center rounded-full border bg-background p-1 shadow-xs w-fit">
                  <Button
                    type="button"
                    variant={resolvedTheme === "dark" ? "ghost" : "secondary"}
                    size="sm"
                    className="h-8 rounded-full px-3.5 text-xs"
                    onClick={() => setTheme("light")}
                  >
                    <Sun className="size-4" />
                    Light
                  </Button>
                  <Button
                    type="button"
                    variant={resolvedTheme === "dark" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 rounded-full px-3.5 text-xs"
                    onClick={() => setTheme("dark")}
                  >
                    <Moon className="size-4" />
                    Dark
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppLayout>
  );
}
