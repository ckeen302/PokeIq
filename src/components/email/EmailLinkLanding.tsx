"use client";

import { useEffect, useState } from "react";
import Link from "@/components/ui/Link";
import { Loader2, MailCheck, MailX } from "lucide-react";
import { setAccountDailyEmail } from "@/lib/account";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useT } from "@/i18n/client";
import landing from "@/messages/email-landing";

type State = { status: "working" } | { status: "done" } | { status: "error"; message: string };

/**
 * The page an email's link opens: it confirms the address or unsubscribes
 * from the browser (a POST), so a mail scanner fetching the link changes
 * nothing.
 */
export function EmailLinkLanding({ kind }: { kind: "confirm" | "unsubscribe" }) {
  const t = useT(landing);
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
        setState({ status: "error", message: res.status === 429 ? t("tooMany") : t(`${kind}.error`) });
      })
      .catch(() => setState({ status: "error", message: t("unreachable") }));
  }, [kind, t]);

  const Icon = kind === "confirm" ? MailCheck : MailX;
  return (
    <Card className="mx-auto w-full max-w-sm" data-testid={`email-${kind}`} data-status={state.status}>
      <CardContent className="space-y-4 p-6 text-center">
        {state.status === "working" ? (
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" aria-label={t("busy")} />
        ) : (
          <Icon className={state.status === "done" ? "mx-auto h-8 w-8 text-screen" : "mx-auto h-8 w-8 text-muted-foreground"} aria-hidden />
        )}
        <h1 className="font-display text-2xl font-bold uppercase tracking-tight">
          {state.status === "done" ? t(`${kind}.title`) : state.status === "error" ? t("invalid") : t(`${kind}.working`)}
        </h1>
        {state.status !== "working" && (
          <p className="text-sm text-muted-foreground" role="status">
            {state.status === "done" ? t(`${kind}.body`) : state.message}
          </p>
        )}
        {state.status !== "working" && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Link href="/" className={buttonVariants({ variant: "default" })}>
              {t("play")}
            </Link>
            <Link href="/trainer#email" className={buttonVariants({ variant: "outline" })}>
              {t("settings")}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
