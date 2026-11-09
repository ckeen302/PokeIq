"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { Loader2, MailCheck, MailX } from "lucide-react";
import { setAccountDailyEmail } from "@/lib/account";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type State = { status: "working" } | { status: "done" } | { status: "error"; message: string };

const COPY = {
  confirm: {
    done: { title: "Email confirmed", body: "You're all set. The daily email arrives when new dailies drop, if it's turned on in Settings." },
    error: "That confirmation link has expired or was replaced by a newer one. Ask for a new one in Settings.",
  },
  unsubscribe: {
    done: { title: "You're unsubscribed", body: "No more daily emails. You can turn them back on in Settings any time." },
    error: "That unsubscribe link isn't valid. You can turn the emails off in Settings instead.",
  },
};

/**
 * The page an email's link opens: it confirms the address or unsubscribes
 * from the browser (a POST), so a mail scanner fetching the link changes
 * nothing.
 */
export function EmailLinkLanding({ kind }: { kind: "confirm" | "unsubscribe" }) {
  const [state, setState] = useState<State>({ status: "working" });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    const url = kind === "confirm" ? "/api/email/confirm" : `/api/email/unsubscribe?token=${encodeURIComponent(token)}`;
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), cache: "no-store" })
      .then(async (res) => {
        if (res.ok) {
          if (kind === "unsubscribe") setAccountDailyEmail(false);
          return setState({ status: "done" });
        }
        setState({ status: "error", message: res.status === 429 ? "Too many tries: wait a minute and open the link again." : COPY[kind].error });
      })
      .catch(() => setState({ status: "error", message: "Couldn't reach the server. Open the link again in a moment." }));
  }, [kind]);

  const Icon = kind === "confirm" ? MailCheck : MailX;
  return (
    <Card className="mx-auto w-full max-w-sm" data-testid={`email-${kind}`} data-status={state.status}>
      <CardContent className="space-y-4 p-6 text-center">
        {state.status === "working" ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label="Working" />
        ) : (
          <Icon className={state.status === "done" ? "mx-auto h-8 w-8 text-screen" : "mx-auto h-8 w-8 text-muted-foreground"} aria-hidden />
        )}
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight">
          {state.status === "done" ? COPY[kind].done.title : state.status === "error" ? "Link not valid" : kind === "confirm" ? "Confirming…" : "Unsubscribing…"}
        </h1>
        {state.status !== "working" && (
          <p className="text-sm text-muted-foreground" role="status">
            {state.status === "done" ? COPY[kind].done.body : state.message}
          </p>
        )}
        {state.status !== "working" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Link href="/" className={buttonVariants({ variant: "default" })}>
              Play today&apos;s dailies
            </Link>
            <Link href="/trainer#email" className={buttonVariants({ variant: "outline" })}>
              Settings
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
