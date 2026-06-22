import { SignInContent } from "@/components/auth/signin-content";
import { LanguageToggle } from "@/components/layout/language-toggle";

export default function SignInPage() {
  const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>
      <SignInContent googleEnabled={googleEnabled} />
    </div>
  );
}
