"use client";

import { useCallback, useEffect, useState } from "react";
import { connectedAccounts, unlinkAccount } from "@/lib/account";
import { PROVIDER_LABEL, enabledOAuthProviders, OAUTH_PROVIDERS, type OAuthProvider, type OwnIdentity } from "@/lib/oauth";
import { Button, buttonVariants } from "@/components/ui/button";
import { GOOGLE_TESTING_NOTE, ProviderIcon, useOAuthError } from "./OAuthButtons";
import { cn } from "@/lib/utils";

/** Trainer card: link / unlink Discord and Google. Emails shown here are the owner's own. */
export function ConnectedAccounts({ onPasswordKnown }: { onPasswordKnown?: (hasPassword: boolean) => void }) {
  const [identities, setIdentities] = useState<OwnIdentity[] | null>(null);
  const [hasPassword, setHasPassword] = useState(true);
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const linkError = useOAuthError();
  const enabled = enabledOAuthProviders();

  const refresh = useCallback(async () => {
    try {
      const res = await connectedAccounts();
      setIdentities(res.identities);
      setHasPassword(res.hasPassword);
      onPasswordKnown?.(res.hasPassword);
    } catch {
      setIdentities([]);
    }
  }, [onPasswordKnown]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function unlink(provider: OAuthProvider) {
    setBusy(provider);
    setError(null);
    try {
      await unlinkAccount(provider);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't unlink that account.");
    } finally {
      setBusy(null);
    }
  }

  if (!identities) return null;
  const linked = new Map(identities.map((i) => [i.provider, i]));
  const rows = OAUTH_PROVIDERS.filter((p) => linked.has(p) || enabled.includes(p));
  if (!rows.length) return null;

  return (
    <section className="space-y-2 border-t pt-4" aria-labelledby="connected-accounts">
      <h2 id="connected-accounts" className="hud-label">
        Connected accounts
      </h2>
      <ul className="space-y-2">
        {rows.map((p) => {
          const id = linked.get(p);
          const lastWayIn = Boolean(id) && !hasPassword && identities.length === 1;
          return (
            <li key={p} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-shade/10 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <ProviderIcon provider={p} className={cn("h-5 w-5 shrink-0", p === "discord" && "text-[#5865F2]")} />
                <span className="font-semibold">{PROVIDER_LABEL[p]}</span>
                <span className="truncate text-muted-foreground">{id ? (id.email ?? "Linked") : "Not linked"}</span>
              </span>
              {id ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null || lastWayIn}
                  title={lastWayIn ? "This is your only way to sign in." : undefined}
                  onClick={() => void unlink(p)}
                >
                  Unlink
                </Button>
              ) : (
                <a href={`/api/auth/oauth/${p}?intent=link`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Link {PROVIDER_LABEL[p]}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      {enabled.includes("google") && !linked.has("google") && <p className="text-xs text-muted-foreground">{GOOGLE_TESTING_NOTE}</p>}
      {(error ?? linkError) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? linkError}
        </p>
      )}
    </section>
  );
}
