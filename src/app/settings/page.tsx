"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "@/components/theme-provider";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Moon, Sun } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

export default function SettingsPage() {
  const { locale, pick } = useI18n();
  const { status, update } = useSession();
  const { resolvedTheme, setTheme } = useTheme();

  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    role: "",
    createdAt: "",
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
        const profileResponse = await fetch(apiPath("/api/settings/profile"), { cache: "no-store" });

        const profileResult = await profileResponse.json();

        if (!profileResponse.ok || !profileResult.success) {
          throw new Error(profileResult.error || "Failed to load profile");
        }

        setProfile({
          name: profileResult.data?.name || "",
          email: profileResult.data?.email || "",
          role: profileResult.data?.role || "user",
          createdAt: profileResult.data?.createdAt || "",
        });
        setError(null);
      } catch (fetchError: unknown) {
        setError(getErrorMessage(fetchError));
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
      const response = await fetch(apiPath("/api/settings/profile"), {
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
        createdAt: result.data?.createdAt || current.createdAt,
      }));

      await update({
        user: {
          name: result.data?.name,
          email: result.data?.email,
        },
      });
    } catch (saveError: unknown) {
      setError(getErrorMessage(saveError));
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{pick("설정", "Settings")}</h1>
          <p className="text-muted-foreground">
            {pick("프로필, 테마, 개인 메뉴 설정을 관리합니다.", "Manage your profile, theme, and personal navigation preferences.")}
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
                <CardTitle>{pick("프로필", "Profile")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="settings-name">{pick("이름", "Name")}</Label>
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
                    <Label htmlFor="settings-email">{pick("이메일", "Email")}</Label>
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
                    <p className="text-sm font-medium">{pick("역할", "Role")}</p>
                    <p className="text-sm text-muted-foreground">
                      {pick("접근 권한은 별도로 관리됩니다.", "Your access level is managed separately.")}
                    </p>
                  </div>
                  <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                    {profile.role}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">{pick("언어", "Language")}</p>
                    <p className="text-sm text-muted-foreground">
                      {pick("현재 사이트에 적용된 언어입니다.", "The language currently applied to the site.")}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">
                    {locale === "ko" ? "한국어 (KO)" : "English (EN)"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div>
                    <p className="text-sm font-medium">{pick("가입일", "Joined")}</p>
                    <p className="text-sm text-muted-foreground">
                      {pick("최초 계정 등록일입니다.", "First account registration date.")}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">
                    {formatJoinedDate(profile.createdAt)}
                  </span>
                </div>
                <div className="flex justify-end">
                  <Button type="button" onClick={() => void saveProfile()} disabled={savingProfile}>
                    {savingProfile ? pick("저장 중...", "Saving...") : pick("프로필 저장", "Save Profile")}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{pick("화면 설정", "Appearance")}</CardTitle>
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
                    {pick("라이트", "Light")}
                  </Button>
                  <Button
                    type="button"
                    variant={resolvedTheme === "dark" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 rounded-full px-3.5 text-xs"
                    onClick={() => setTheme("dark")}
                  >
                    <Moon className="size-4" />
                    {pick("다크", "Dark")}
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

function formatJoinedDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
