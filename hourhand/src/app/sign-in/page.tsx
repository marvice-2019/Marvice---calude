import { redirect } from "next/navigation";
import { LegalLinks } from "@/components/LegalLinks";
import { SignInForm } from "@/components/SignInForm";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { authEnabled, googleEnabled, microsoftEnabled } from "@/lib/auth/auth";
import { getSignedInUser } from "@/lib/auth/session";
import { signInWithGoogle, signInWithMicrosoft } from "./actions";

export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[]; closed?: string }> }) {
  const { error, closed } = await searchParams;
  // Better Auth appends its own error code to our errorCallbackURL, so "error" can arrive more than once.
  const errors = [error ?? []].flat();
  if (authEnabled() && (await getSignedInUser())) redirect("/dashboard/event-types");

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="font-display text-2xl text-text">Sign in to Hourhand</h1>
      <p className="mt-2 text-text-muted">No password needed. We email you a link that signs you in.</p>
      {closed && (
        <p role="status" className="mt-4 rounded-md bg-surface p-3 text-sm text-text">
          Your account is closed and you&apos;ve been signed out everywhere. Your data will be deleted in 30 days.
        </p>
      )}
      {errors.length > 0 && (
        <p role="alert" className="mt-4 rounded-md bg-danger-bg p-3 text-sm text-danger">
          {errors.includes("microsoft")
            ? "We couldn't sign you in with Microsoft. If you already have a Hourhand account with that email, sign in with an email link below instead."
            : "That link didn't work. It may have expired or been used already. Ask for a new one below."}
        </p>
      )}
      <Card className="mt-6">
        {authEnabled() ? (
          <SignInForm />
        ) : (
          <p className="text-text-muted">
            This copy is running on demo data, so there is nothing to sign in to. Start it with HOURHAND_DATA=postgres to use real accounts.
          </p>
        )}
        {authEnabled() && googleEnabled() && (
          <form action={signInWithGoogle} className="mt-4 border-t border-border pt-4">
            <Button type="submit" variant="secondary" className="w-full">
              Continue with Google
            </Button>
          </form>
        )}
        {authEnabled() && microsoftEnabled() && (
          <form action={signInWithMicrosoft} className={googleEnabled() ? "mt-3" : "mt-4 border-t border-border pt-4"}>
            <Button type="submit" variant="secondary" className="w-full">
              Continue with Microsoft
            </Button>
          </form>
        )}
      </Card>
      <footer className="mt-8">
        <LegalLinks />
      </footer>
    </div>
  );
}
