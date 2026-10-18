"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { recoverAccount, register, signIn, useAccount } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RecoveryCodeCard } from "./RecoveryCodeCard";
import { cn } from "@/lib/utils";

type Mode = "login" | "register" | "recover";

const TABS: { id: Mode; label: string }[] = [
  { id: "login", label: "Sign in" },
  { id: "register", label: "Create account" },
  { id: "recover", label: "Forgot password" },
];

const FIELD =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AuthForm({ next = "/trainer" }: { next?: string }) {
  const router = useRouter();
  const account = useAccount();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<{ code: string; recovered: boolean } | null>(null);

  if (newCode) {
    return (
      <Card className="mx-auto w-full max-w-sm">
        <CardContent className="p-6">
          <RecoveryCodeCard
            code={newCode.code}
            title={newCode.recovered ? "Password reset" : `Welcome, ${username}!`}
            note={
              newCode.recovered
                ? "Your old recovery code is used up. Save this new one — it's shown only once."
                : "This recovery code is the only way back in if you forget your password. It's shown only once."
            }
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
          <h2 className="font-display text-xl font-bold uppercase">Accounts are offline</h2>
          <p className="text-sm text-muted-foreground">
            Trainer accounts aren&apos;t switched on for this server yet. Your progress is still saved on this device.
          </p>
        </CardContent>
      </Card>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await signIn(username, password);
        router.push(next);
      } else if (mode === "register") {
        setNewCode({ code: await register(username, password), recovered: false });
      } else {
        setNewCode({ code: await recoverAccount(username, code, password), recovered: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardContent className="space-y-5 p-6">
        <div className="grid grid-cols-3 gap-1 rounded-md border bg-shade/20 p-1" role="tablist" aria-label="Account">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              onClick={() => {
                setMode(t.id);
                setError(null);
              }}
              className={cn(
                "rounded-sm px-2 py-2 font-display text-xs font-semibold uppercase tracking-wide transition-colors",
                mode === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <form className="space-y-3" onSubmit={submit}>
          <label className="block space-y-1">
            <span className="hud-label">Trainer name</span>
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
              <span className="hud-label">Recovery code</span>
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
            <span className="hud-label">{mode === "recover" ? "New password" : "Password"}</span>
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
          {mode === "register" && (
            <p className="text-xs text-muted-foreground">
              3–20 letters, numbers, _ or -. No email needed — you&apos;ll get a recovery code instead.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Reset password"}
          </Button>
        </form>
        <p className="text-center text-xs text-muted-foreground">
          Signing in saves your XP, badges, streaks and PokéIQ to your account so they follow you to any device.
        </p>
      </CardContent>
    </Card>
  );
}
