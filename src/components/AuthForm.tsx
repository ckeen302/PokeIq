"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/utils";

type Mode = "login" | "register" | "recover";

const FIELD_CLASSES =
  "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-muted/50 focus:border-indigo-400/60";

/** Post-signup / post-recovery screen: the one chance to save the code. */
function RecoveryCodeReveal({
  code,
  username,
  recovered,
}: {
  code: string;
  username: string;
  recovered: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable — the code is on screen to copy by hand
    }
  }

  return (
    <Card className="mx-auto w-full max-w-sm text-center">
      <div className="text-4xl" aria-hidden>
        🔑
      </div>
      <h2 className="mt-2 text-xl font-black">
        {recovered ? `Welcome back, ${username}!` : `Welcome, ${username}!`}
      </h2>
      <p className="mt-2 text-sm text-muted">
        {recovered
          ? "Your password is reset and your old code is used up. This is your NEW recovery code:"
          : "This is your recovery code — the only way back in if you forget your trainer name or password. It's shown exactly once."}
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy recovery code"
        className="mt-4 w-full rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 font-mono text-lg font-bold tracking-wider text-amber-200 transition-colors hover:bg-amber-400/15"
      >
        {code}
      </button>
      <div className="mt-3 flex gap-2">
        <Button variant="outline" className="flex-1" onClick={() => void copy()}>
          {copied ? "Copied! ✓" : "Copy code"}
        </Button>
      </div>
      <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-sm text-muted">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="h-4 w-4 accent-indigo-500"
        />
        I saved my recovery code somewhere safe
      </label>
      <Button
        size="lg"
        className="mt-4 w-full"
        disabled={!acknowledged}
        onClick={() => window.location.assign("/")}
      >
        Let&apos;s go
      </Button>
    </Card>
  );
}

export function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<{
    code: string;
    username: string;
    recovered: boolean;
  } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const isRecover = mode === "recover";
    try {
      const res = await fetch(`/api/auth/${isRecover ? "recover" : mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isRecover
            ? { recoveryCode: recoveryInput, newPassword: password }
            : { username, password },
        ),
      });
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        user?: { username: string };
        recoveryCode?: string;
      } | null;
      if (!res.ok) {
        setError(data?.error ?? "Something went wrong");
        return;
      }
      if (data?.recoveryCode && data.user) {
        // Signup and recovery both mint a code the player must save.
        setReveal({
          code: data.recoveryCode,
          username: data.user.username,
          recovered: isRecover,
        });
        return;
      }
      // Plain login: full navigation so every session-aware component
      // (header menu, trainer card, results) re-reads the fresh cookie.
      window.location.assign("/");
    } catch {
      setError("Network error — try again");
    } finally {
      setBusy(false);
    }
  }

  if (reveal) return <RecoveryCodeReveal {...reveal} />;

  return (
    <Card className="mx-auto w-full max-w-sm">
      <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1">
        {(
          [
            ["login", "Sign in"],
            ["register", "Create account"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setMode(value);
              setError(null);
            }}
            className={cn(
              "rounded-lg py-2 text-sm font-semibold transition-colors",
              mode === value
                ? "bg-white/10 text-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "recover" && (
        <p className="mb-4 rounded-xl bg-indigo-500/10 p-3 text-sm text-indigo-200">
          Enter your recovery code — it finds your account even if you forgot
          your trainer name, and sets a new password.
        </p>
      )}

      <form onSubmit={submit} className="space-y-4">
        {mode === "recover" ? (
          <label className="block text-left">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
              Recovery code
            </span>
            <input
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value)}
              required
              minLength={10}
              maxLength={40}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              className={cn(FIELD_CLASSES, "font-mono tracking-wider")}
            />
          </label>
        ) : (
          <label className="block text-left">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
              Trainer name
            </span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z0-9_]{3,20}"
              title="3–20 characters: letters, numbers, underscores"
              placeholder="ash_ketchum"
              className={FIELD_CLASSES}
            />
          </label>
        )}
        <label className="block text-left">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-muted">
            {mode === "recover" ? "New password" : "Password"}
          </span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "login" ? 1 : 8}
            maxLength={100}
            placeholder={mode === "login" ? "••••••••" : "8+ characters"}
            className={FIELD_CLASSES}
          />
        </label>

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy
            ? "One moment…"
            : mode === "login"
              ? "Sign in"
              : mode === "register"
                ? "Start your journey"
                : "Recover my account"}
        </Button>
      </form>

      {mode === "login" ? (
        <button
          type="button"
          onClick={() => {
            setMode("recover");
            setError(null);
          }}
          className="mt-4 w-full text-center text-xs text-muted underline decoration-dotted transition-colors hover:text-foreground"
        >
          Forgot your trainer name or password? Use your recovery code
        </button>
      ) : mode === "recover" ? (
        <button
          type="button"
          onClick={() => {
            setMode("login");
            setError(null);
          }}
          className="mt-4 w-full text-center text-xs text-muted underline decoration-dotted transition-colors hover:text-foreground"
        >
          Back to sign in
        </button>
      ) : (
        <p className="mt-4 text-center text-xs text-muted">
          Progress syncs across devices · scores post under your trainer name
        </p>
      )}
    </Card>
  );
}
