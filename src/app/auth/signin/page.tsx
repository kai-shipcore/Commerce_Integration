import { SignInContent } from "@/components/auth/signin-content";

export default function SignInPage() {
  const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <SignInContent googleEnabled={googleEnabled} />
    </div>
  );
}
