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
import { Loader2, Moon, Sun, Eye, EyeOff } from "lucide-react";
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
    hasPassword: false,
  });

  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [showPasswords, setShowPasswords] = useState({ current: false, next: false, confirm: false });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

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
          throw new Error(profileResult.error || pick("프로필을 불러오지 못했습니다.", "Failed to load profile"));
        }

        setProfile({
          name: profileResult.data?.name || "",
          email: profileResult.data?.email || "",
          role: profileResult.data?.role || "user",
          createdAt: profileResult.data?.createdAt || "",
          hasPassword: !!profileResult.data?.hasPassword,
        });
        setError(null);
      } catch (fetchError: unknown) {
        setError(getErrorMessage(fetchError));
      } finally {
        setLoading(false);
      }
    };

    void loadSettings();
  }, [pick, status]);

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
        throw new Error(result.error || pick("프로필 저장에 실패했습니다.", "Failed to save profile"));
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

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (passwords.next !== passwords.confirm) {
      setPasswordError(pick("새 비밀번호가 일치하지 않습니다.", "New passwords do not match"));
      return;
    }

    setSavingPassword(true);
    try {
      const response = await fetch(apiPath("/api/settings/password"), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: passwords.current, newPassword: passwords.next }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || pick("비밀번호 변경에 실패했습니다.", "Failed to change password"));
      }

      setPasswordSuccess(true);
      setPasswords({ current: "", next: "", confirm: "" });
    } catch (err: unknown) {
      setPasswordError(getErrorMessage(err));
    } finally {
      setSavingPassword(false);
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

            {profile.hasPassword && (
              <Card>
                <CardHeader>
                  <CardTitle>{pick("비밀번호 변경", "Change Password")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {passwordSuccess && (
                    <Alert className="mb-4 border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
                      <AlertDescription>
                        {pick("비밀번호가 성공적으로 변경되었습니다.", "Password changed successfully.")}
                      </AlertDescription>
                    </Alert>
                  )}
                  {passwordError && (
                    <Alert variant="destructive" className="mb-4">
                      <AlertDescription>{passwordError}</AlertDescription>
                    </Alert>
                  )}
                  <form onSubmit={(e) => void changePassword(e)} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="current-password">{pick("현재 비밀번호", "Current Password")}</Label>
                      <div className="relative">
                        <Input
                          id="current-password"
                          type={showPasswords.current ? "text" : "password"}
                          value={passwords.current}
                          disabled={savingPassword}
                          onChange={(e) => setPasswords((p) => ({ ...p, current: e.target.value }))}
                          required
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords((s) => ({ ...s, current: !s.current }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          tabIndex={-1}
                        >
                          {showPasswords.current ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="new-password">{pick("새 비밀번호", "New Password")}</Label>
                      <div className="relative">
                        <Input
                          id="new-password"
                          type={showPasswords.next ? "text" : "password"}
                          value={passwords.next}
                          disabled={savingPassword}
                          onChange={(e) => setPasswords((p) => ({ ...p, next: e.target.value }))}
                          required
                          minLength={8}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords((s) => ({ ...s, next: !s.next }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          tabIndex={-1}
                        >
                          {showPasswords.next ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">{pick("최소 8자 이상", "Minimum 8 characters")}</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="confirm-password">{pick("새 비밀번호 확인", "Confirm New Password")}</Label>
                      <div className="relative">
                        <Input
                          id="confirm-password"
                          type={showPasswords.confirm ? "text" : "password"}
                          value={passwords.confirm}
                          disabled={savingPassword}
                          onChange={(e) => setPasswords((p) => ({ ...p, confirm: e.target.value }))}
                          required
                          minLength={8}
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords((s) => ({ ...s, confirm: !s.confirm }))}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                          tabIndex={-1}
                        >
                          {showPasswords.confirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                        </button>
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <Button type="submit" disabled={savingPassword}>
                        {savingPassword ? (
                          <><Loader2 className="mr-2 size-4 animate-spin" />{pick("변경 중...", "Saving...")}</>
                        ) : (
                          pick("비밀번호 변경", "Change Password")
                        )}
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}
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
