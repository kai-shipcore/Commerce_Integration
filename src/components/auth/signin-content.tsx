"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Loader2, TrendingUp } from "lucide-react";
import { apiPath, stripBasePath, withBasePath } from "@/lib/api-path";
import { useI18n } from "@/lib/i18n/i18n-provider";

interface SignInContentProps {
  googleEnabled: boolean;
}

function SignInCardContent({ googleEnabled }: SignInContentProps) {
  const { pick } = useI18n();
  const searchParams = useSearchParams();
  const rawCallbackUrl = searchParams.get("callbackUrl") || "/";
  const callbackPath = toLocalCallbackPath(rawCallbackUrl);
  const callbackUrl = withBasePath(stripBasePath(callbackPath));
  const queryError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const error = signInError ?? queryError;

  const handleCredentialsSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setSignInError(null);

    try {
      const csrfResponse = await fetch(apiPath("/api/auth/csrf"), {
        credentials: "same-origin",
      });
      const csrfData = (await csrfResponse.json()) as { csrfToken?: string };

      const response = await fetch(apiPath("/api/auth/callback/credentials"), {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Auth-Return-Redirect": "1",
        },
        body: new URLSearchParams({
          email,
          password,
          csrfToken: csrfData.csrfToken ?? "",
          callbackUrl,
        }),
        credentials: "same-origin",
      });

      const result = (await response.json()) as { url?: string };
      const resultUrl = result.url ? new URL(result.url, window.location.origin) : null;
      const error = resultUrl?.searchParams.get("error");

      if (!response.ok || error) {
        setSignInError(error ?? "CredentialsSignin");
        return;
      }

      window.location.assign(callbackUrl);
    } catch {
      setSignInError("CredentialsSignin");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    await signIn("google", { callbackUrl });
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="p-3 bg-primary/10 rounded-full">
            <TrendingUp className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl">{pick("다시 오신 것을 환영합니다", "Welcome Back")}</CardTitle>
        <CardDescription>
          {pick("Demand Pilot 계정에 로그인하세요", "Sign in to your Demand Pilot account")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm text-center">
            {error === "OAuthSignin" && pick("OAuth 로그인을 시작할 수 없습니다.", "Error starting OAuth sign in.")}
            {error === "OAuthCallback" && pick("OAuth 로그인을 완료할 수 없습니다.", "Error completing OAuth sign in.")}
            {error === "OAuthCreateAccount" && pick("OAuth 계정을 만들 수 없습니다.", "Error creating OAuth account.")}
            {error === "EmailCreateAccount" && pick("계정을 만들 수 없습니다.", "Error creating account.")}
            {error === "Callback" && pick("로그인 처리 중 오류가 발생했습니다.", "Error during callback.")}
            {error === "OAuthAccountNotLinked" && pick("이미 다른 계정에 연결된 이메일입니다.", "Email already linked to another account.")}
            {error === "CredentialsSignin" && pick("이메일 또는 비밀번호가 올바르지 않습니다.", "Invalid email or password.")}
            {error === "SessionRequired" && pick("계속하려면 로그인하세요.", "Please sign in to continue.")}
            {!["OAuthSignin", "OAuthCallback", "OAuthCreateAccount", "EmailCreateAccount", "Callback", "OAuthAccountNotLinked", "CredentialsSignin", "SessionRequired"].includes(error) && pick("로그인 중 오류가 발생했습니다.", "An error occurred during sign in.")}
          </div>
        )}

        {googleEnabled && (
          <>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
              )}
              {pick("Google로 계속", "Continue with Google")}
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <Separator />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  {pick("또는 이메일로 계속", "Or continue with")}
                </span>
              </div>
            </div>
          </>
        )}

        <form onSubmit={handleCredentialsSignIn} className="space-y-4">
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
            />
          </div>
          <div className="text-right text-sm">
            <Link href="/auth/forgot-password" className="text-primary hover:underline">
              {pick("비밀번호를 잊으셨나요?", "Forgot password?")}
            </Link>
          </div>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {pick("로그인", "Sign In")}
          </Button>
        </form>

        <p className="text-sm text-center text-muted-foreground">
          {pick("계정이 없으신가요?", "Don't have an account?")}{" "}
          <Link href="/auth/signup" className="text-primary hover:underline">
            {pick("계정 만들기", "Create one")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function toLocalCallbackPath(callbackUrl: string) {
  if (!callbackUrl.startsWith("http")) return callbackUrl;

  try {
    const url = new URL(callbackUrl);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
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

export function SignInContent(props: SignInContentProps) {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SignInCardContent {...props} />
    </Suspense>
  );
}
