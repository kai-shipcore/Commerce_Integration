"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { TrendingUp, Loader2 } from "lucide-react";
import { apiPath, authPath, withBasePath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

export default function SignUpPage() {
  const { pick } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(pick("비밀번호가 일치하지 않습니다.", "Passwords do not match"));
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(apiPath("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setError(result.error || pick("계정 생성에 실패했습니다.", "Failed to create account"));
        setLoading(false);
        return;
      }

      const csrfResponse = await fetch(apiPath("/api/auth/csrf"), {
        credentials: "same-origin",
      });
      const csrfData = (await csrfResponse.json()) as { csrfToken?: string };

      const signInResponse = await fetch(apiPath("/api/auth/callback/credentials"), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Auth-Return-Redirect": "1",
        },
        body: new URLSearchParams({
          email,
          password,
          csrfToken: csrfData.csrfToken ?? "",
          callbackUrl: withBasePath("/"),
        }),
        credentials: "same-origin",
      });
      const signInResult = (await signInResponse.json()) as { url?: string };
      const signInUrl = signInResult.url ? new URL(signInResult.url, window.location.origin) : null;

      if (!signInResponse.ok || signInUrl?.searchParams.get("error")) {
        window.location.assign(authPath("/auth/signin"));
        return;
      }

      window.location.assign(withBasePath("/"));
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error ? requestError.message : pick("계정 생성에 실패했습니다.", "Failed to create account")
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-4 flex justify-center">
            <div className="rounded-full bg-primary/10 p-3">
              <TrendingUp className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">{pick("계정 만들기", "Create Account")}</CardTitle>
          <CardDescription>
            {pick("새 Demand Pilot 계정을 등록하세요", "Register a new Demand Pilot account")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-center text-sm text-destructive">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSignUp} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">{pick("이름", "Name")}</Label>
              <Input
                id="name"
                type="text"
                placeholder={pick("이름을 입력하세요", "Your name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{pick("이메일", "Email")}</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{pick("비밀번호", "Password")}</Label>
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
              <Label htmlFor="confirmPassword">{pick("비밀번호 확인", "Confirm Password")}</Label>
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
              {pick("계정 만들기", "Create Account")}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {pick("이미 계정이 있으신가요?", "Already have an account?")}{" "}
            <Link href="/auth/signin" className="text-primary hover:underline">
              {pick("로그인", "Sign in")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
