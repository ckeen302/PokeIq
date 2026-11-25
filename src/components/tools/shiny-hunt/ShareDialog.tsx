"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, Share2 } from "lucide-react";
import { useT } from "@/i18n/client";
import { useLocale, localeHref } from "@/i18n/navigation";
import { INTL_LOCALE, formatNumber } from "@/i18n/format";
import counter from "@/messages/shiny-counter";
import { shinyChance } from "@/lib/shiny-hunt/odds";
import { clock, oneIn } from "@/lib/shiny-hunt/math";
import { encodeHunt } from "@/lib/shiny-hunt/share";
import { elapsed, type Hunt } from "@/lib/shiny-hunt/store";
import { CARD, drawCard, loadFirst } from "@/lib/shiny-hunt/render";
import { canvasBlob, fileSlug, pageFonts, saveBlob } from "@/lib/tier-list/render";
import { cn } from "@/lib/utils";
import { Modal, PillButton } from "../tier-list/ui";
import { artSources } from "./Art";
import type { Names } from "./names";

export const TOOL_PATH = "/tools/shiny-hunt-counter";

/**
 * Share a hunt: a link that carries it (copied on a computer, the share sheet on a phone) and a picture of it to
 * download. Nothing is uploaded: the link is the hunt.
 */
export function ShareDialog({ hunt, names, onClose }: { hunt: Hunt; names: Names; onClose(): void }) {
  const t = useT(counter);
  const locale = useLocale();
  const name = names.name(hunt.species);
  const found = hunt.status === "found" || !!hunt.found;
  const count = found && hunt.found ? hunt.found.count : hunt.count;
  const url = useMemo(() => `${window.location.origin}${localeHref(`${TOOL_PATH}?d=${encodeHunt(hunt)}`, locale).href}`, [hunt, locale]);
  const text = t(found ? "share.textFound" : "share.textHunting", { name, n: formatNumber(count, locale) });
  const [copied, setCopied] = useState(false);
  const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches && typeof navigator.share === "function";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.getElementById("sh-share-url") as HTMLInputElement | null;
      el?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const native = () => navigator.share({ title: text, text, url }).catch(() => undefined);

  // The picture
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setReady(false);
    void loadFirst(artSources(hunt.species, true)).then((art) => {
      const c = canvas.current;
      if (!live || !c) return;
      try {
        c.width = CARD.w;
        c.height = CARD.h;
        const p = shinyChance(hunt.game, hunt.method, hunt);
        const ms = found && hunt.found ? hunt.found.timeMs : elapsed(hunt);
        const date = new Intl.DateTimeFormat(INTL_LOCALE[locale], { dateStyle: "medium" }).format(new Date(hunt.found?.date ?? Date.now()));
        drawCard(
          c.getContext("2d")!,
          {
            eyebrow: found ? t("share.cardFound") : t("share.cardHunting"),
            title: t("found.headline", { name }),
            subtitle: `${t(`games.${hunt.game}`)} · ${t(`methods.${hunt.method}`)}${found ? ` · ${date}` : ""}`,
            stats: [
              { label: t("found.encounters"), value: formatNumber(count, locale) },
              { label: t("found.odds"), value: t("counter.odds", { n: formatNumber(oneIn(p), locale) }) },
              { label: t("found.time"), value: clock(ms) },
              ...(hunt.phases.length ? [{ label: t("found.phases"), value: formatNumber(hunt.phases.length, locale) }] : []),
            ],
            footer: `${window.location.host}${TOOL_PATH}`,
          },
          art,
          pageFonts()
        );
        setReady(true);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
    return () => {
      live = false;
    };
  }, [hunt, found, count, locale, name, t]);

  const download = async () => {
    const c = canvas.current;
    if (!c) return;
    try {
      const blob = await canvasBlob(c);
      if (!blob) throw new Error("no blob");
      saveBlob(blob, `pokeiq-shiny-${fileSlug(name)}.png`);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Modal title={t("share.title")} onClose={onClose} closeLabel={t("share.close")} wide testId="sh-share-dialog">
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative flex min-h-[240px] items-center justify-center overflow-hidden rounded-2xl bg-foreground/[0.04] p-3">
          <canvas ref={canvas} className={cn("max-h-[50vh] max-w-full rounded-xl shadow-lg", !ready && "opacity-0")} style={{ aspectRatio: `${CARD.w} / ${CARD.h}` }} data-testid="sh-share-preview" data-ready={ready ? "1" : "0"} />
          {!ready && !failed && <p className="absolute text-sm text-muted-foreground">{t("share.drawing")}</p>}
        </div>
        <div className="space-y-4">
          <p className="text-[14px] leading-relaxed text-muted-foreground">{t("share.hint")}</p>
          <input id="sh-share-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-12 w-full rounded-xl border border-foreground/[0.1] bg-background px-3 text-[16px] text-muted-foreground outline-none focus:border-primary/60" aria-label={t("share.title")} data-testid="sh-share-url" />
          <div className="grid gap-2">
            {touch && (
              <PillButton primary onClick={native} className="w-full">
                <Share2 className="h-4 w-4" aria-hidden /> {t("share.native")}
              </PillButton>
            )}
            <PillButton primary={!touch} onClick={copy} className="w-full" testId="sh-share-copy">
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? t("share.copied") : t("share.copy")}
            </PillButton>
            <PillButton onClick={download} disabled={!ready} className="w-full" testId="sh-share-png">
              <Download className="h-4 w-4" aria-hidden /> {t("share.download")}
            </PillButton>
          </div>
          {failed && <p className="text-sm text-destructive">{t("share.failed")}</p>}
        </div>
      </div>
    </Modal>
  );
}
