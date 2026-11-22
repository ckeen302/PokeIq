"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { Loader2 } from "lucide-react";
import { recoverAccount, register, signIn, useAccount, type SignupEmail } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RecoveryCodeCard } from "./RecoveryCodeCard";
import { cn } from "@/lib/utils";
import { isCleanName } from "@/lib/name-filter";
import { DailyEmailOptIn, optInError } from "@/components/email/DailyEmailOptIn";
import { useT } from "@/i18n/client";
import accountNs from "@/messages/account";

type Mode = "login" | "register" | "recover";

const TABS: Mode[] = ["login", "register", "recover"];

const FIELD =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AuthForm({ next = "/trainer" }: { next?: string }) {
  const t = useT(accountNs);
  const router = useRouter();
  const account = useAccount();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<{ code: string; recovered: boolean } | null>(null);
  const [optIn, setOptIn] = useState<SignupEmail>({ email: "", dailyEmail: false });

  // "/login?signup=1" (the dailies' "get the daily in your inbox" nudge) opens on Create account.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("signup") === "1") setMode("register");
  }, []);

  if (newCode) {
    return (
      <Card className="mx-auto w-full max-w-sm">
        <CardContent className="p-6">
          <RecoveryCodeCard
            code={newCode.code}
            title={newCode.recovered ? t("resetTitle") : t("welcome", { name: username })}
            note={newCode.recovered ? t("resetNote") : t("welcomeNote")}
            onDone={() => router.push(next)}
          />
        </CardContent>
      </Card>
    );
  }

  if (account.status === "ready" && !account.enabled) {
    return (
      <Card className="mx-auto w-full max-w-sm">
        <CardContent className="space-y-2 p-6 text-center">
          <h2 className="font-display text-xl font-bold uppercase">{t("offlineTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("offlineBody")}
          </p>
        </CardContent>
      </Card>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "register" && !isCleanName(username)) return setError(t("nameRejected"));
    const emailProblem = mode === "register" && account.emailEnabled ? optInError(optIn) : null;
    if (emailProblem) return setError(t(`email.${emailProblem}`));
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await signIn(username, password);
        router.push(next);
      } else if (mode === "register") {
        setNewCode({ code: await register(username, password, account.emailEnabled ? optIn : undefined), recovered: false });
      } else {
        setNewCode({ code: await recoverAccount(username, code, password), recovered: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardContent className="space-y-5 p-6">
        <div className="grid grid-cols-3 gap-1 rounded-md border bg-shade/20 p-1" role="tablist" aria-label={t("tablist")}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              onClick={() => {
                setMode(id);
                setError(null);
              }}
              className={cn(
                "rounded-sm px-2 py-2 font-display text-xs font-semibold uppercase tracking-wide transition-colors",
                mode === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t(`tabs.${id}`)}
            </button>
          ))}
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="hud-label">{t("name")}</span>
            <input
              className={FIELD}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={20}
              required
            />
          </label>
          {mode === "recover" && (
            <label className="block space-y-1">
              <span className="hud-label">{t("code")}</span>
              <input
                className={cn(FIELD, "font-mono uppercase tracking-wider")}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </label>
          )}
          <label className="block space-y-1">
            <span className="hud-label">{mode === "recover" ? t("newPassword") : t("password")}</span>
            <input
              className={FIELD}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength={mode === "login" ? 1 : 8}
              maxLength={128}
              required
            />
          </label>
          {mode === "register" && <DailyEmailOptIn enabled={account.emailEnabled} value={optIn} onChange={setOptIn} />}
          {mode === "register" && (
            <p className="text-xs text-muted-foreground">
              {t("nameRules")}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {mode === "login" ? t("tabs.login") : mode === "register" ? t("tabs.register") : t("reset")}
          </Button>
        </form>
        <p className="text-center text-xs text-muted-foreground">
          {t("syncNote")}
        </p>
      </CardContent>
    </Card>
  );
}
