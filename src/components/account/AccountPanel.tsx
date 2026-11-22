"use client";

import { useState } from "react";
import Link from "@/components/ui/Link";
import { LogOut, ShieldCheck, UserPlus } from "lucide-react";
import { newRecoveryCode, signOut, useAccount } from "@/lib/account";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RecoveryCodeCard } from "./RecoveryCodeCard";
import { ConnectedAccounts } from "./ConnectedAccounts";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import accountNs from "@/messages/account";

/** Trainer-card section: sign-in prompt, or account status and security actions. */
export function AccountPanel() {
  const t = useT(accountNs);
  const account = useAccount();
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Discord / Google-only trainers have no password, so no recovery code to renew.
  const [hasPassword, setHasPassword] = useState(true);

  if (account.status === "loading" || !account.enabled) return null;

  if (!account.user) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <p className="font-display text-lg font-bold uppercase">{t("panel.saveTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("panel.saveBody")}</p>
          </div>
          <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
            <UserPlus className="h-4 w-4" aria-hidden /> {t("panel.signIn")}
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (code) {
    return (
      <Card>
        <CardContent className="mx-auto max-w-sm p-6">
          <RecoveryCodeCard
            code={code}
            title={t("panel.newCodeTitle")}
            note={t("panel.newCodeNote")}
            onDone={() => setCode(null)}
          />
        </CardContent>
      </Card>
    );
  }

  async function regenerate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCode(await newRecoveryCode(password));
      setAsking(false);
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panel.codeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="led text-success" aria-hidden />
            <p className="text-sm">
              {t.rich("panel.signedInAs", { name: account.user.username, b: (c) => <span className="font-display font-bold">{c}</span> })}
            </p>
          </div>
          <div className="flex gap-2">
            {hasPassword && (
              <Button variant="outline" size="sm" onClick={() => setAsking((v) => !v)}>
                <ShieldCheck className="h-4 w-4" aria-hidden /> {t("panel.newCode")}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" aria-hidden /> {t("panel.signOut")}
            </Button>
          </div>
        </div>
        {asking && hasPassword && (
          <form className="flex flex-wrap gap-2" onSubmit={regenerate}>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("panel.confirmPassword")}
              autoComplete="current-password"
              required
              className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="submit" disabled={busy}>
              {t("panel.generate")}
            </Button>
            {error && (
              <p role="alert" className="w-full text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
        )}
        <ConnectedAccounts onPasswordKnown={setHasPassword} />
      </CardContent>
    </Card>
  );
}
