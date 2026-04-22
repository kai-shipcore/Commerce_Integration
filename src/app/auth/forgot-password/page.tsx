"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [emailDelivered, setEmailDelivered] = useState<boolean | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);
    setResetUrl(null);
    setEmailDelivered(null);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to generate reset link");
      }

      setMessage(result.message || "Password reset link generated");
      setResetUrl(result.resetUrl || null);
      setEmailDelivered(Boolean(result.emailDelivered));
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to generate reset link"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-primary/10 rounded-full">
              <Mail className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Reset Password</CardTitle>
          <CardDescription>
            Enter your email to create a password reset link.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-destructive text-sm text-center">
              {error}
            </div>
          ) : null}
          {message ? (
            <div className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              <p>{message}</p>
              {emailDelivered ? (
                <p>An email has been sent to the address if the account exists.</p>
              ) : null}
              {resetUrl ? (
                <div className="space-y-2">
                  <p className="font-medium">
                    SMTP is not configured, so use this reset link directly:
                  </p>
                  <a
                    href={resetUrl}
                    className="break-all text-emerald-800 underline"
                  >
                    {resetUrl}
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Generate reset link
            </Button>
          </form>

          <p className="text-sm text-center text-muted-foreground">
            <Link href="/auth/signin" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
