"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { completeOAuthSignup } from "@/lib/account";
import { PROVIDER_LABEL, isOAuthProvider, type OAuthProvider } from "@/lib/oauth";
import { NAME_REJECTED, isCleanName } from "@/lib/name-filter";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProviderIcon } from "./OAuthButtons";

const FIELD =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Load = { status: "loading" } | { status: "missing"; error: string } | { status: "ready"; provider: OAuthProvider };

/** "Pick your trainer name": the step between a first Discord / Google sign-in and the new account. */
export function OAuthSignup() {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [username, setUsername] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/oauth/signup", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { provider?: string; suggestion?: string; error?: string };
        if (!live) return;
        if (!res.ok || !isOAuthProvider(body.provider)) {
          setLoad({ status: "missing", error: body.error ?? "That sign-in has expired — start again." });
          return;
        }
        setUsername(body.suggestion ?? "");
        setLoad({ status: "ready", provider: body.provider });
      })
      .catch(() => live && setLoad({ status: "missing", error: "Couldn't reach the server — try again." }));
    return () => {
      live = false;
    };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCleanName(username)) return setError(NAME_REJECTED);
    if (!adult) return setError("You need to be 13 or older to make an account.");
    setBusy(true);
    setError(null);
    try {
      await completeOAuthSignup(username, adult);
      router.push("/trainer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardContent className="space-y-5 p-6">
        {load.status === "loading" && <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />}
        {load.status === "missing" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">{load.error}</p>
            <Link href="/login" className={buttonVariants({ variant: "outline" })}>
              Back to sign in
            </Link>
          </div>
        )}
        {load.status === "ready" && (
          <form className="space-y-4" onSubmit={submit}>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ProviderIcon provider={load.provider} className="h-4 w-4" />
              Signed in with {PROVIDER_LABEL[load.provider]}. Choose the name other trainers will see.
            </p>
            <label className="block space-y-1">
              <span className="hud-label">Trainer name</span>
              <input
                className={FIELD}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
                minLength={3}
                maxLength={20}
                pattern="[A-Za-z0-9_\-]{3,20}"
                required
              />
              <span className="block text-xs text-muted-foreground">3–20 letters, numbers, _ or -.</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={adult} onChange={(e) => setAdult(e.target.checked)} required />
              <span>I am 13 years old or older.</span>
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Create trainer
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Your email stays private. See the{" "}
              <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                privacy policy
              </Link>
              .
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
