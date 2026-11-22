"use client";

import { useEffect } from "react";
import Link from "@/components/ui/Link";
import { RotateCcw } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { reportError } from "@/lib/report";
import { useT } from "@/i18n/client";
import errorNs from "@/messages/error";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT(errorNs);
  useEffect(() => {
    console.error(error);
    reportError(error, { source: "boundary", digest: error.digest });
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 text-center">
      <p className="hud-label flex items-center gap-2 text-destructive">
        <span className="led h-1.5 w-1.5 animate-blink text-destructive" /> {t("label")}
      </p>
      <div className="space-y-2">
        <h1 className="font-display text-3xl font-bold uppercase tracking-tight">{t("heading")}</h1>
        <p className="mx-auto max-w-sm text-muted-foreground">{t("body")}</p>
        {error.digest && <p className="font-mono text-xs text-muted-foreground">{t("ref", { digest: error.digest })}</p>}
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={reset} className={buttonVariants()}>
          <RotateCcw className="h-4 w-4" /> {t("retry")}
        </button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
