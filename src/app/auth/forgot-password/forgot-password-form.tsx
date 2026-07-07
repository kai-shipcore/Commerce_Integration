"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { apiPath, authPath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

interface ForgotPasswordResult {
  success?: boolean;
  error?: string;
  message?: string;
  resetUrl?: string | null;
  emailDelivered?: boolean;
  accountType?: string | null;
  oauthProvider?: string | null;
}

function providerLabel(provider: string | null) {
  if (!provider) return "social";
  return provider === "google" ? "Google" : provider;
}

export function ForgotPasswordForm() {
  const { pick } = useI18n();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [emailDelivered, setEmailDelivered] = useState<boolean | null>(null);
  const [oauthProvider, setOauthProvider] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    setResetUrl(null);
    setEmailDelivered(null);
    setOauthProvider(null);

    try {
      const response = await fetch(apiPath("/api/auth/forgot-password"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as ForgotPasswordResult;

      if (!response.ok || !result.success) {
        throw new Error(result.error || pick("비밀번호 재설정 링크 생성에 실패했습니다.", "Failed to generate reset link"));
      }

      setMessage(result.message || pick("비밀번호 재설정 링크가 생성되었습니다.", "Password reset link generated"));
      setResetUrl(result.resetUrl || null);
      setEmailDelivered(Boolean(result.emailDelivered));
      setOauthProvider(result.accountType === "oauth" ? providerLabel(result.oauthProvider ?? null) : null);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : pick("비밀번호 재설정 링크 생성에 실패했습니다.", "Failed to generate reset link"),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="rounded-full bg-primary/10 p-3">
              <Mail className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">{pick("비밀번호 재설정", "Reset Password")}</CardTitle>
          <CardDescription>
            {pick("이메일을 입력하면 비밀번호 재설정 링크를 생성합니다.", "Enter your email to create a password reset link.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {message && oauthProvider ? (
            <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p>
                {pick(
                  `이 계정은 ${oauthProvider} 소셜 로그인으로 가입되어 있어 비밀번호가 설정되어 있지 않습니다.`,
                  `This account was created via ${oauthProvider} sign-in and has no password to reset.`,
                )}
              </p>
              <p>
                {pick(
                  "비밀번호 재설정 메일은 발송되지 않았습니다. 로그인 화면에서 소셜 로그인 버튼을 이용해주세요.",
                  "No reset email was sent. Please sign in using the social login button on the sign-in page instead.",
                )}
              </p>
            </div>
          ) : message ? (
            <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <p>{message}</p>
              {emailDelivered ? (
                <p>{pick("계정이 존재하면 해당 이메일 주소로 메일이 발송되었습니다.", "An email has been sent to the address if the account exists.")}</p>
              ) : null}
              {resetUrl ? (
                <div className="space-y-2">
                  <p className="font-medium">
                    {pick("SMTP가 설정되지 않아 아래 재설정 링크를 직접 사용하세요:", "SMTP is not configured, so use this reset link directly:")}
                  </p>
                  <a href={resetUrl} className="break-all text-emerald-800 underline">
                    {resetUrl}
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{pick("이메일", "Email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {pick("재설정 링크 생성", "Generate reset link")}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            <Link href={authPath("/auth/signin")} className="text-primary hover:underline">
              {pick("로그인으로 돌아가기", "Back to sign in")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
