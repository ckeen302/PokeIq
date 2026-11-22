"use client";

import { useState } from "react";
import { Check, Flag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { geoShotIdOf } from "@/lib/geo-storage";
import { GEO_REPORT_NOTE_MAX, GEO_REPORT_REASONS, type GeoReportMode, type GeoReportReason } from "@/lib/geo-reports";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import geoNs from "@/messages/geo";

/** The screenshot id in its URL (src/lib/geo-storage's geoShotUrl). */
const shotId = (src: string) => geoShotIdOf(src) ?? "";

/**
 * "Report this screenshot" on a round's result: a reason (wrong place, wrong
 * game, gives the answer away…) and an optional note. Enough players
 * reporting a shot take it out of rotation until a moderator looks at it.
 */
export function ReportShot({ shot, mode, className }: { shot: string; mode: GeoReportMode; className?: string }) {
  const t = useT(geoNs);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<GeoReportReason | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!reason) return;
    setState("sending");
    setError(null);
    try {
      const res = await fetch("/api/geo/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shot: shotId(shot), reason, mode, note: note.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok && res.status !== 409) throw new Error(data.error ?? t("report.failed"));
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("report.failed"));
      setState("error");
    }
  }

  if (state === "sent") {
    return (
      <p role="status" className={cn("flex items-center justify-center gap-1.5 text-xs text-muted-foreground", className)} data-testid="geo-report-sent">
        <Check className="h-3.5 w-3.5 text-success" aria-hidden />{` ${t("report.thanks")}`}
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline", className)}
        data-testid="geo-report"
      >
        <Flag className="h-3.5 w-3.5" aria-hidden />{` ${t("report.open")}`}
      </button>
    );
  }
  return (
    <div className={cn("mx-auto max-w-xl space-y-2 rounded-md border bg-card p-3 text-left text-sm", className)} data-testid="geo-report-form">
      <p className="hud-label">{t("report.question")}</p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("report.reason")}>
        {(Object.keys(GEO_REPORT_REASONS) as GeoReportReason[]).map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={reason === id}
            onClick={() => setReason(id)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              reason === id ? "border-screen bg-screen/15 text-foreground" : "bg-background text-muted-foreground hover:border-screen/50 hover:text-foreground"
            )}
          >
            {t(`report.reasons.${id}`)}
          </button>
        ))}
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={GEO_REPORT_NOTE_MAX}
        placeholder={t("report.placeholder")}
        aria-label={t("report.note")}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={!reason || state === "sending"} onClick={() => void send()} data-testid="geo-report-send">
          {state === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Flag className="h-3.5 w-3.5" aria-hidden />}
          {t("report.send")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("report.cancel")}
        </Button>
      </div>
    </div>
  );
}
