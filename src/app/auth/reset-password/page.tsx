"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { Loader2, LockKeyhole } from "lucide-react";
import { apiPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

function ResetPasswordContent() {
  const { pick } = useI18n();
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(apiPath("/api/auth/reset-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || pick("비밀번호 재설정에 실패했습니다.", "Failed to reset password"));
      }

      setSuccess(result.message || pick("비밀번호가 변경되었습니다.", "Password updated successfully"));
      setPassword("");
      setConfirmPassword("");
      setTimeout(() => {
        router.push("/auth/signin");
      }, 1200);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : pick("비밀번호 재설정에 실패했습니다.", "Failed to reset password")
      );
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{pick("유효하지 않은 재설정 링크", "Invalid Reset Link")}</CardTitle>
          <CardDescription>
            {pick("재설정 토큰이 없습니다. 새 비밀번호 재설정 링크를 생성하세요.", "The reset token is missing. Generate a new password reset link.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Link href="/auth/forgot-password" className="text-primary hover:underline">
            {pick("새 재설정 링크 요청", "Request a new reset link")}
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mb-4 flex justify-center">
          <div className="rounded-full bg-primary/10 p-3">
            <LockKeyhole className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl">{pick("새 비밀번호 설정", "Set New Password")}</CardTitle>
        <CardDescription>
          {pick("계정에 사용할 새 비밀번호를 입력하세요.", "Choose a new password for your account.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-center text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-center text-sm text-emerald-700">
            {success}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">{pick("새 비밀번호", "New password")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">{pick("비밀번호 확인", "Confirm password")}</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {pick("비밀번호 변경", "Update password")}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          <Link href="/auth/signin" className="text-primary hover:underline">
            {pick("로그인으로 돌아가기", "Back to sign in")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function LoadingFallback() {
  return (
    <Card className="w-full max-w-md">
      <CardContent className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>

      <Suspense fallback={<LoadingFallback />}>
        <ResetPasswordContent />
      </Suspense>
    </div>
  );
}
