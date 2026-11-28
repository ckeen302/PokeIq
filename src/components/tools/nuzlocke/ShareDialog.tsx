"use client";

/* eslint-disable @next/next/no-img-element -- the run's own share card, drawn by the server */
import { useMemo, useState } from "react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { SITE_URL } from "@/lib/site";
import { encodeRun } from "@/lib/nuzlocke/share";
import { backupName, exportRun } from "@/lib/nuzlocke/storage";
import type { Run } from "@/lib/nuzlocke/run";
import type { GameView } from "@/lib/nuzlocke/view";
import { Modal, PillButton } from "../tier-list/ui";
import type { NuzT } from "./parts";

/** Saves a run as a .json file (its backup). */
export function downloadBackup(run: Run, done: string, toast: (text: string) => void) {
  try {
    const blob = new Blob([exportRun(run)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = backupName(run);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast(done);
  } catch {
    // A browser that won't download: nothing to do.
  }
}

/** Sharing a run: its read-only link (copy, or the phone's share sheet), its card as a picture, and its backup file. */
export function ShareDialog({ t, run, view, shareRaw, readOnly, onClose, onToast }: { t: NuzT; run: Run; view: GameView; shareRaw: string | null; readOnly: boolean; onClose(): void; onToast(text: string): void }) {
  const raw = useMemo(() => shareRaw ?? encodeRun(run), [run, shareRaw]);
  const path = `/tools/nuzlocke-tracker/run?s=${raw}`;
  const link = `${SITE_URL}${path}`;
  const image = `/tools/nuzlocke-tracker/run/og?s=${raw}`;
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      onToast(t("share.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt(t("share.link"), link);
    }
  };
  return (
    <Modal title={t("share.title")} onClose={onClose} closeLabel={t("picker.close")} wide testId="nz-share">
      <div className="space-y-6">
        <section className="space-y-2.5">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("share.link")}</h3>
          <p className="text-[14px] text-muted-foreground">{t("share.linkLead")}</p>
          <div className="flex gap-2 max-sm:flex-col">
            <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label={t("share.link")} className="h-11 min-w-0 flex-1 rounded-full border border-foreground/[0.1] bg-background px-4 text-[13.5px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="nz-share-link" />
            <PillButton primary onClick={copy} testId="nz-share-copy">
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {t("share.copy")}
            </PillButton>
            {canShare && (
              <PillButton onClick={() => navigator.share({ title: run.name, url: link }).catch(() => undefined)}>
                <Share2 className="h-4 w-4" aria-hidden /> {t("share.native")}
              </PillButton>
            )}
          </div>
        </section>
        <section className="space-y-2.5">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("share.image")}</h3>
          <img src={image} alt={run.name} width={1200} height={630} className="aspect-[1200/630] w-full rounded-2xl border border-foreground/[0.08] bg-foreground/[0.04] object-cover" data-testid="nz-share-image" />
          <a href={image} download={`${backupName(run).replace(/\.json$/, "")}.png`} className="inline-flex h-10 items-center gap-2 rounded-full bg-foreground/[0.07] px-4 text-sm font-semibold hover:bg-foreground/[0.11] max-md:h-11">
            <Download className="h-4 w-4" aria-hidden /> {t("share.download")}
          </a>
        </section>
        <section className="space-y-2.5">
          <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">{t("share.backup")}</h3>
          <p className="text-[14px] text-muted-foreground">{t("share.backupLead")}</p>
          <PillButton onClick={() => downloadBackup(run, t("share.exported"), onToast)} testId="nz-export">
            <Download className="h-4 w-4" aria-hidden /> {t("share.export")}
          </PillButton>
        </section>
      </div>
      {readOnly && <span className="sr-only">{view.name}</span>}
    </Modal>
  );
}
