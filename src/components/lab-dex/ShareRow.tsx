"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@vercel/analytics";
import { Check, Clapperboard, Share2 } from "lucide-react";
import { shareOrCopy } from "@/lib/share";
import { localUrl } from "@/i18n/paths";
import { useT } from "@/i18n/client";
import labClip from "@/messages/lab-clip";
import shareNs from "@/messages/share";
import type { LabMon } from "@/lib/lab-dex/types";
import { cn } from "@/lib/utils";

/** The link that opens the lab on this Pokémon (in the full list, whatever the filters were). */
export function labLink(mon: LabMon): string {
  return `${window.location.origin}${localUrl(`/lab/pokedex?pick=${mon.id}${mon.isForm ? "&forms=1" : ""}`)}`;
}

/** Under "Open in Pokédex": share a link to this Pokémon on the holo-table, or make a short video of it. */
export function ShareRow({ mon, canVideo, onVideo, className }: { mon: LabMon; canVideo: boolean; onVideo(): void; className?: string }) {
  const t = useT(labClip);
  const ts = useT(shareNs);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const btn = "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-md border border-white/15 bg-white/[0.04] font-display text-[12px] font-semibold uppercase tracking-wider text-white/85 transition-colors hover:border-cyan-200/50 hover:text-white disabled:opacity-40";

  async function share() {
    const outcome = await shareOrCopy(t("labShare", { name: mon.name }), labLink(mon));
    if (outcome === "copied" || outcome === "shared") track("share", { kind: "lab-dex", via: outcome });
    if (outcome !== "copied") return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2200);
  }

  return (
    <div className={cn("flex gap-2", className)}>
      <button type="button" onClick={() => void share()} className={btn} data-testid="lab-share">
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Share2 className="h-4 w-4" aria-hidden />}
        {copied ? ts("button.copied") : t("shareLink")}
      </button>
      <button type="button" onClick={onVideo} disabled={!canVideo} className={btn} data-testid="lab-video">
        <Clapperboard className="h-4 w-4" aria-hidden /> {t("video")}
      </button>
    </div>
  );
}
