"use client";

import { useEffect, useState } from "react";
import { useAccount } from "@/lib/account";
import { PROVIDER_LABEL, enabledOAuthProviders, oauthErrorMessage, type OAuthProvider } from "@/lib/oauth";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ProviderIcon({ provider, className }: { provider: OAuthProvider; className?: string }) {
  if (provider === "discord") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
        <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}

export const GOOGLE_TESTING_NOTE = "Google sign-in is in testing — use Discord if it doesn't work.";

/** Reads (and tidies away) `?oauth_error=` after a failed handshake. Only known codes become text. */
export function useOAuthError(): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const url = new URL(window.location.href);
    const message = oauthErrorMessage(url.searchParams.get("oauth_error"));
    if (!url.searchParams.has("oauth_error")) return;
    setError(message ?? oauthErrorMessage("failed"));
    url.searchParams.delete("oauth_error");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }, []);
  return error;
}

/** "Continue with Discord / Google" on /login. Plain links: the handshake is server redirects. */
export function OAuthButtons() {
  const account = useAccount();
  const error = useOAuthError();
  const providers = enabledOAuthProviders();
  if (!providers.length || (account.status === "ready" && !account.enabled)) return null;

  return (
    <div className="mx-auto w-full max-w-sm space-y-3">
      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {providers.map((p) => (
        <div key={p} className="space-y-1">
          <a
            href={`/api/auth/oauth/${p}`}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full gap-2")}
          >
            <ProviderIcon provider={p} className={cn("h-5 w-5", p === "discord" && "text-[#5865F2]")} />
            Continue with {PROVIDER_LABEL[p]}
          </a>
          {p === "google" && <p className="text-center text-xs text-muted-foreground">{GOOGLE_TESTING_NOTE}</p>}
        </div>
      ))}
      <div className="flex items-center gap-3 pt-1 text-xs uppercase tracking-wide text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" /> or use a trainer name <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
