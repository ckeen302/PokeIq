"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { useRouter } from "@/i18n/navigation";
import { Loader2 } from "lucide-react";
import { completeOAuthSignup, type SignupEmail } from "@/lib/account";
import { DailyEmailOptIn, optInError } from "@/components/email/DailyEmailOptIn";
import { PROVIDER_LABEL, isOAuthProvider, type OAuthProvider } from "@/lib/oauth";
import { isCleanName } from "@/lib/name-filter";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProviderIcon } from "./OAuthButtons";
import { useT } from "@/i18n/client";
import accountNs from "@/messages/account";

const FIELD =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type Load = { status: "loading" } | { status: "missing"; error: string } | { status: "ready"; provider: OAuthProvider };

/** "Pick your trainer name": the step between a first Discord / Google sign-in and the new account. */
export function OAuthSignup() {
  const t = useT(accountNs);
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [username, setUsername] = useState("");
  const [adult, setAdult] = useState(false);
  // Shown only while daily emails are switched on (the server sends `email` then): the provider's address, box unticked.
  const [optIn, setOptIn] = useState<SignupEmail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/oauth/signup", { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { provider?: string; suggestion?: string; email?: string; error?: string };
        if (!live) return;
        if (!res.ok || !isOAuthProvider(body.provider)) {
          setLoad({ status: "missing", error: body.error ?? t("signup.expired") });
          return;
        }
        setUsername(body.suggestion ?? "");
        if (typeof body.email === "string") setOptIn({ email: body.email, dailyEmail: false });
        setLoad({ status: "ready", provider: body.provider });
      })
      .catch(() => live && setLoad({ status: "missing", error: t("signup.unreachable") }));
    return () => {
      live = false;
    };
  }, [t]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isCleanName(username)) return setError(t("nameRejected"));
    if (!adult) return setError(t("signup.under13"));
    const emailProblem = optIn ? optInError(optIn) : null;
    if (emailProblem) return setError(t(`email.${emailProblem}`));
    setBusy(true);
    setError(null);
    try {
      await completeOAuthSignup(username, adult, optIn ?? undefined);
      router.push("/trainer");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardContent className="space-y-5 p-6">
        {load.status === "loading" && <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label={t("signup.loading")} />}
        {load.status === "missing" && (
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">{load.error}</p>
            <Link href="/login" className={buttonVariants({ variant: "outline" })}>
              {t("signup.back")}
            </Link>
          </div>
        )}
        {load.status === "ready" && (
          <form className="space-y-4" onSubmit={submit}>
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <ProviderIcon provider={load.provider} className="h-4 w-4" />
              {t("signup.signedWith", { provider: PROVIDER_LABEL[load.provider] })}
            </p>
            <label className="block space-y-1">
              <span className="hud-label">{t("name")}</span>
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
              <span className="block text-xs text-muted-foreground">{t("signup.nameHint")}</span>
            </label>
            {optIn && <DailyEmailOptIn enabled value={optIn} onChange={setOptIn} />}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4" checked={adult} onChange={(e) => setAdult(e.target.checked)} required />
              <span>{t("signup.adult")}</span>
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {t("signup.create")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {t.rich("signup.privacy", {
                link: (c) => (
                  <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                    {c}
                  </Link>
                ),
              })}
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
